/**
 * 附件命名 / 分类 / 路径（1.3 收件管线）。
 * 原生 Intake.kt 是权威实现，这里锁住 JS 侧的镜像与分类矩阵。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildRelPath,
  classify,
  formatBytes,
  hashPrefix,
  isLarge,
  sanitizeName,
} from '../app/src/lib/attachments/classify';

const HASH = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2';

describe('附件命名 sanitizeName', () => {
  it('中文 + 空格 + #/% 换成下划线，其余保持不变', () => {
    assert.equal(sanitizeName('周会 纪要 #1 100%.md'), '周会 纪要 _1 100_.md');
  });

  it('路径穿越只取最后一段文件名', () => {
    const name = sanitizeName('../../etc/passwd');
    assert.equal(name, 'passwd');
    assert.ok(!name.includes('/'));
    assert.ok(!name.includes('..'));
  });

  it('300 字符长名：主名截到 80，扩展名保留', () => {
    const name = sanitizeName(`${'a'.repeat(300)}.md`);
    assert.equal(name.length, 83);
    assert.equal(name, `${'a'.repeat(80)}.md`);
  });

  it('空名/只有点回退 file-<ts>，并按 mime 补扩展名', () => {
    assert.match(sanitizeName(''), /^file-\d+$/);
    assert.match(sanitizeName('...'), /^file-\d+$/);
    assert.match(sanitizeName('', 'image/jpeg'), /^file-\d+\.jpg$/);
  });
});

describe('附件大小与路径', () => {
  it('formatBytes 与 isLarge 边界', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(20 * 1024 * 1024), '20 MB');
    assert.equal(formatBytes(undefined), '未知大小');
    assert.equal(isLarge(20 * 1024 * 1024), false);
    assert.equal(isLarge(20 * 1024 * 1024 + 1), true);
  });

  it('hashPrefix / buildRelPath 生成 uploads/<hash16>-<name>', () => {
    assert.equal(hashPrefix(HASH), 'a1b2c3d4e5f6a7b8');
    assert.equal(
      buildRelPath(HASH, '周会 纪要 #1 100%.md'),
      'uploads/a1b2c3d4e5f6a7b8-周会 纪要 _1 100_.md',
    );
  });
});

describe('附件分类矩阵', () => {
  it('图片：kind=image，标完整（轻引擎不读图）', () => {
    const result = classify('image/jpeg', 'photo.jpg');
    assert.equal(result.kind, 'image');
    assert.equal(result.engine, 'full');
    assert.equal(result.saveOnly, false);
  });

  it('md/txt/json/csv/docx/xlsx 走轻引擎', () => {
    const cases: Array<[string, string]> = [
      ['text/markdown', '说明.md'],
      ['text/plain', 'note.txt'],
      ['application/json', 'data.json'],
      ['text/csv', '表格.csv'],
      [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        '周报.docx',
      ],
      ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', '数据.xlsx'],
    ];
    for (const [mime, name] of cases) {
      const result = classify(mime, name);
      assert.equal(result.engine, 'light', name);
      assert.equal(result.saveOnly, false, name);
    }
  });

  it('PDF 只保存 + 提示「PDF 暂不解析」', () => {
    const result = classify('application/pdf', '合同.pdf');
    assert.equal(result.engine, 'full');
    assert.equal(result.saveOnly, true);
    assert.match(result.hint ?? '', /PDF 暂不解析/);
  });

  it('pptx / doc / ppt / 音视频 / 未知格式只保存', () => {
    const cases: Array<[string, string]> = [
      [
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        '方案.pptx',
      ],
      ['application/msword', '旧文档.doc'],
      ['application/vnd.ms-powerpoint', '旧幻灯.ppt'],
      ['video/mp4', '录像.mp4'],
      ['audio/mpeg', '录音.mp3'],
      ['application/octet-stream', 'blob.bin'],
    ];
    for (const [mime, name] of cases) {
      const result = classify(mime, name);
      assert.equal(result.engine, 'full', name);
      assert.equal(result.saveOnly, true, name);
      assert.ok(result.hint, name);
    }
  });

  it('>20MB 追加「只按路径引用」提示', () => {
    const result = classify('text/plain', 'big.txt', 25 * 1024 * 1024);
    assert.equal(result.engine, 'light');
    assert.match(result.hint ?? '', /超过 20MB/);
  });
});
