import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { NodeBackend } from '../app/src/engine/fs/nodeBackend';
import { createWorkspaceMount } from '../app/src/engine/fs/mount';
import { ShellRunner } from '../app/src/engine/shell/bash';
import { buildDocx, extractDocxText } from '../app/src/engine/docs/docx';
import { buildXlsx, extractXlsxText } from '../app/src/engine/docs/xlsx';
import { generateImage, pngSize } from '../app/src/engine/light/image';
import { toolByName, toolsForPermission } from '../app/src/engine/light/tools';
import type { ToolContext } from '../app/src/engine/light/types';

const roots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

after(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-palm-docs-'));
  roots.push(dir);
  return dir;
}

/** 1x1 透明 PNG */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

async function context(): Promise<{ ctx: ToolContext; root: string }> {
  const root = await tempDir();
  const mount = await createWorkspaceMount({ backend: new NodeBackend({ root }) });
  const ctx: ToolContext = {
    fs: mount.workspace,
    bash: new ShellRunner({ fs: mount.fs }),
    permission: 'workspace-write',
    signal: new AbortController().signal,
    requestApproval: async () => 'approve',
    askUser: async () => ({ id: 'q', selected: [] }),
  };
  return { ctx, root };
}

describe('docx', () => {
  it('生成后能读回中文、表格和列表', async () => {
    const bytes = await buildDocx({
      title: '周会纪要',
      blocks: [
        { type: 'heading', text: '本周进展', level: 2 },
        { type: 'paragraph', text: '完成了轻引擎 MVP，真机验证通过。' },
        { type: 'bullet', text: '工作区自检 47ms' },
        { type: 'numbered', text: '下一步做文档工具' },
        { type: 'table', rows: [['模块', '状态'], ['docx', '完成'], ['xlsx', '完成']] },
        { type: 'code', text: 'echo hello > a.txt' },
        { type: 'pageBreak' },
        { type: 'paragraph', text: '第二页' },
      ],
    });
    assert.equal(Buffer.from(bytes.subarray(0, 2)).toString('utf8'), 'PK');

    const text = extractDocxText(bytes);
    assert.match(text, /周会纪要/);
    assert.match(text, /本周进展/);
    assert.match(text, /完成了轻引擎 MVP/);
    assert.match(text, /工作区自检 47ms/);
    assert.match(text, /模块\t状态/);
    assert.match(text, /docx\t完成/);
    assert.match(text, /第二页/);
  });

  it('不是 docx 的字节要报错', () => {
    assert.throws(() => extractDocxText(Uint8Array.from([1, 2, 3])), /不是有效的 docx/);
  });
});

describe('xlsx', () => {
  it('多工作表 + 中文 + 数字往返', async () => {
    const bytes = await buildXlsx([
      {
        name: '发票',
        rows: [
          ['日期', '项目', '金额'],
          ['2026-11-02', '打车', 56.5],
          ['2026-11-02', '餐费', 88],
        ],
      },
      { name: '汇总', rows: [['合计', 144.5]] },
    ]);
    assert.equal(Buffer.from(bytes.subarray(0, 2)).toString('utf8'), 'PK');

    const text = await extractXlsxText(bytes);
    assert.match(text, /工作表：发票/);
    assert.match(text, /日期 \| 项目 \| 金额/);
    assert.match(text, /打车/);
    assert.match(text, /56\.5/);
    assert.match(text, /工作表：汇总/);

    const only = await extractXlsxText(bytes, { sheet: '汇总' });
    assert.match(only, /合计 \| 144\.5/);
    assert.doesNotMatch(only, /打车/);
  });
});

describe('文档工具（走 ToolContext）', () => {
  it('create_docx 落盘，read_docx 读回', async () => {
    const { ctx, root } = await context();
    const create = toolByName('create_docx');
    const read = toolByName('read_docx');
    assert.ok(create && read);

    const created = await create.execute(
      {
        path: 'docs/会议纪要',
        title: '会议纪要',
        blocks: [
          { type: 'heading', text: '结论', level: 2 },
          { type: 'paragraph', text: '下周上线灰度。' },
        ],
      },
      ctx,
    );
    assert.match(created, /已生成 Word 文档 \/workspace\/docs\/会议纪要\.docx/);
    const saved = await read.execute({ path: 'docs/会议纪要.docx' }, ctx);
    assert.match(saved, /会议纪要/);
    assert.match(saved, /下周上线灰度/);

    // 文件真的在真实目录里
    const { readFile } = await import('node:fs/promises');
    const onDisk = await readFile(join(root, 'docs/会议纪要.docx'));
    assert.equal(onDisk.subarray(0, 2).toString('utf8'), 'PK');
  });

  it('create_xlsx 落盘，read_xlsx 读回；非法 blocks 给人话错误', async () => {
    const { ctx } = await context();
    const create = toolByName('create_xlsx');
    const read = toolByName('read_xlsx');
    const docx = toolByName('create_docx');
    assert.ok(create && read && docx);

    const created = await create.execute(
      {
        path: 'docs/报销单.xlsx',
        sheets: [{ name: '11 月', rows: [['项目', '金额'], ['打车', 56.5]] }],
      },
      ctx,
    );
    assert.match(created, /已生成 Excel/);
    const saved = await read.execute({ path: 'docs/报销单.xlsx' }, ctx);
    assert.match(saved, /11 月/);
    assert.match(saved, /打车 \| 56\.5/);

    const bad = await docx.execute({ path: 'x.docx', blocks: [{ type: 'wat', text: 'x' }] }, ctx);
    assert.match(bad, /\[错误\] 不支持的 block 类型/);
  });

  it('read-only 工具表里没有写操作，但有读文档', () => {
    const names = toolsForPermission('read-only').map((tool) => tool.name);
    assert.ok(names.includes('read_docx'));
    assert.ok(names.includes('read_xlsx'));
    assert.ok(!names.includes('create_docx'));
    assert.ok(!names.includes('create_xlsx'));
    assert.ok(!names.includes('generate_image'));
    assert.ok(!names.includes('bash'));
  });
});

describe('generate_image', () => {
  it('没配渠道时明确报错，而不是假装生成了', async () => {
    const { ctx } = await context();
    const tool = toolByName('generate_image');
    assert.ok(tool);
    const result = await tool.execute({ prompt: '一只猫' }, ctx);
    assert.match(result, /\[错误\] 没有配置生图渠道/);
  });

  it('b64_json 落到工作区，能读出尺寸', async () => {
    let requestedBody = '';
    const server = createServer((req, res) => {
      let body = '';
      req.on('data', (chunk: Buffer) => {
        body += chunk.toString('utf8');
      });
      req.on('end', () => {
        requestedBody = body;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG, revised_prompt: 'a tiny pixel' }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push({
      close: () =>
        new Promise((resolve) => {
          server.closeAllConnections?.();
          server.close(() => resolve());
        }),
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('拿不到端口');
    const baseURL = `http://127.0.0.1:${address.port}/v1`;

    const image = await generateImage(
      { baseURL, apiKey: 'test-key', model: 'fake-image', size: '512x512' },
      '一只猫',
    );
    assert.deepEqual(pngSize(image.bytes), { width: 1, height: 1 });
    assert.equal(image.mime, 'image/png');
    assert.equal(image.revisedPrompt, 'a tiny pixel');
    const body = JSON.parse(requestedBody) as { prompt: string; size: string; response_format?: string };
    assert.equal(body.prompt, '一只猫');
    assert.equal(body.size, '512x512');
    // 1.5 起默认 auto：不传 response_format，两种返回都接受
    assert.equal(body.response_format, undefined);

    const { ctx, root } = await context();
    ctx.image = { baseURL, apiKey: 'test-key', model: 'fake-image' };
    const tool = toolByName('generate_image');
    assert.ok(tool);
    const result = await tool.execute({ prompt: '一只猫', path: 'images/cat' }, ctx);
    assert.match(result, /已生成图片 \/workspace\/images\/cat\.png/);
    assert.match(result, /1×1/);
    const { readFile } = await import('node:fs/promises');
    const onDisk = await readFile(join(root, 'images/cat.png'));
    assert.equal(onDisk.subarray(1, 4).toString('utf8'), 'PNG');
  });
});
