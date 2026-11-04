/**
 * 预路由单测（纯函数）：规则顺序、粘性、忙时降级、前缀覆盖。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { routeNeedsFullPermission, routeTurn, stripRouteOverride } from '../app/src/state/router';

describe('预路由 · 规则顺序', () => {
  it('「python 是什么」只是提问 → 轻引擎', () => {
    const result = routeTurn({ text: 'python 是什么？和 JavaScript 有什么区别' });
    assert.equal(result.target, 'light');
    assert.equal(result.signals.includes('code_exec'), false);
  });

  it('动作词 + 解释器 → 完整引擎', () => {
    const result = routeTurn({ text: '帮我运行 python 脚本处理这个表格' });
    assert.equal(result.target, 'full');
    assert.ok(result.signals.includes('code_exec'));
    assert.deepEqual(result.missing, ['python']);
    assert.equal(routeNeedsFullPermission(result.signals), true);
  });

  it('只有一段代码块、没有动作词 → 轻引擎', () => {
    const result = routeTurn({ text: '```python\nprint("hi")\n```' });
    assert.equal(result.target, 'light');
    assert.equal(result.signals.includes('code_exec'), false);
  });

  it('后台/锁屏 → 完整引擎', () => {
    for (const text of ['这个任务要在后台跑', '锁屏后继续运行这个任务', '帮我挂后台']) {
      const result = routeTurn({ text });
      assert.equal(result.target, 'full', text);
      assert.ok(result.signals.includes('background'));
    }
  });

  it('PDF 转换 / 渲染 / 重算 / 旧格式 → blocked，不路由', () => {
    for (const text of ['把这个 PDF 转换一下', '帮我渲染这个文档', '重新计算公式', '打开旧版 .doc 文件']) {
      const result = routeTurn({ text });
      assert.equal(result.target, 'blocked-unsupported', text);
      assert.ok(result.missing && result.missing.length > 0);
    }
  });

  it('pptx / 压缩包 / 视频 / >10MB 附件 → 完整引擎', () => {
    for (const attachment of [
      { name: 'deck.pptx' },
      { name: 'archive.zip' },
      { name: 'clip.mp4', kind: 'video' },
      { name: 'big.txt', bytes: 11 * 1024 * 1024 },
    ]) {
      const result = routeTurn({ text: '看一下这个附件', attachments: [attachment] });
      assert.equal(result.target, 'full', JSON.stringify(attachment));
      assert.ok(result.signals.some((signal) => signal.startsWith('attachment:')));
    }
  });

  it('编辑现有 docx / xlsx → 完整引擎；创建/读取仍走轻引擎', () => {
    const edit = routeTurn({
      text: '编辑这个文档，把第二段改成总结',
      attachments: [{ name: 'report.docx' }],
    });
    assert.equal(edit.target, 'full');
    assert.ok(edit.signals.includes('office_edit'));

    const create = routeTurn({ text: '生成一份周报 docx' });
    assert.equal(create.target, 'light');
    const read = routeTurn({
      text: '总结这个文档',
      attachments: [{ name: 'report.docx' }],
    });
    assert.equal(read.target, 'light');
  });

  it('pptx 文本请求也走完整引擎', () => {
    const result = routeTurn({ text: '帮我生成一份产品介绍 pptx' });
    assert.equal(result.target, 'full');
    assert.ok(result.signals.includes('office_edit'));
  });
});

describe('预路由 · pin / 粘性 / 忙', () => {
  it('手动 pin 轻引擎优先于 python 命中', () => {
    const result = routeTurn({ text: '运行 python 脚本', manualPin: 'light' });
    assert.equal(result.target, 'light');
    assert.ok(result.signals.includes('manual_pin:light'));
  });

  it('手动 pin 完整引擎优先于默认轻引擎', () => {
    const result = routeTurn({ text: '总结一下这段话', manualPin: 'full' });
    assert.equal(result.target, 'full');
    assert.ok(result.signals.includes('manual_pin:full'));
  });

  it('已在完整引擎：短追问继续完整，且 pin 轻仍然优先', () => {
    const follow = routeTurn({ text: '继续', activeFull: true });
    assert.equal(follow.target, 'full');
    assert.ok(follow.signals.includes('sticky_full'));

    const pinned = routeTurn({ text: '继续', activeFull: true, manualPin: 'light' });
    assert.equal(pinned.target, 'light');
  });

  it('忙 / 待审批 / 正在启动 proot：不自动切，降级轻引擎', () => {
    for (const engine of [
      { mode: 'light' as const, busy: true },
      { mode: 'light' as const, pendingApprovals: 1 },
      { mode: 'starting-proot' as const },
    ]) {
      const result = routeTurn({ text: '运行 python 脚本', engine });
      assert.equal(result.target, 'light', JSON.stringify(engine));
      assert.ok(result.signals.includes('engine_busy'));
    }
  });

  it('autoRoute=false 时先走轻引擎；明确不支持仍然 blocked', () => {
    assert.equal(routeTurn({ text: '运行 python 脚本', autoRoute: false }).target, 'light');
    assert.equal(
      routeTurn({ text: '把 PDF 转成图片', autoRoute: false }).target,
      'blocked-unsupported',
    );
  });
});

describe('预路由 · 消息前缀覆盖', () => {
  it('完整 / 用完整引擎 / 全 前缀会剥掉', () => {
    for (const text of ['完整 运行 python', '用完整引擎 跑一下', '全 帮我编译', '完整模式 后台跑']) {
      const parsed = stripRouteOverride(text);
      assert.equal(parsed.override, 'full', text);
      assert.equal(parsed.text.includes('完整'), false);
    }
  });

  it('轻 / 留在轻引擎 前缀会剥掉', () => {
    for (const text of ['轻，帮我跑 python', '留在轻引擎 运行脚本', '轻模式 继续']) {
      const parsed = stripRouteOverride(text);
      assert.equal(parsed.override, 'light', text);
    }
  });

  it('正常句子里的「完整文档」「轻松」不误伤', () => {
    assert.equal(stripRouteOverride('完整文档发我一份').override, null);
    assert.equal(stripRouteOverride('轻松一点回答').override, null);
    assert.equal(stripRouteOverride('全部重来').override, null);
  });

  it('前缀进入 routeTurn 结果，text 是剥掉后的正文', () => {
    const full = routeTurn({ text: '完整 运行 python 脚本' });
    assert.equal(full.target, 'full');
    assert.equal(full.text, '运行 python 脚本');
    assert.equal(full.override, 'full');

    const light = routeTurn({ text: '留在轻引擎 运行 python 脚本' });
    assert.equal(light.target, 'light');
    assert.equal(light.text, '运行 python 脚本');
  });
});
