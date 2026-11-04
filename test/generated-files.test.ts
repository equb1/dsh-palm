/**
 * 生成文件面板解析（P0 1.5）：从工具结果里拿 relPath/name/mime/kind，
 * 去重、跳过失败/被截断的结果，中文/空格/#/% 路径都要能认。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Block, Turn } from '../app/src/protocol';
import { collectGeneratedFiles } from '../app/src/lib/generatedFiles';

type ToolBlock = Extract<Block, { kind: 'tool' }>;

let blockSeq = 0;

function tool(name: string, detail: string | undefined, state: ToolBlock['state'] = 'done'): ToolBlock {
  blockSeq += 1;
  return {
    kind: 'tool',
    id: `tool-${blockSeq}`,
    name,
    summary: name,
    state,
    ...(detail !== undefined ? { detail } : {}),
  };
}

function turn(blocks: Block[]): Turn {
  return {
    id: `turn-${blockSeq}`,
    role: 'assistant',
    createdAt: blockSeq,
    status: 'done',
    blocks,
  };
}

describe('collectGeneratedFiles', () => {
  it('解析 docx / xlsx / image / write_file，保留中文/空格/#/% 路径', () => {
    const files = collectGeneratedFiles([
      turn([
        tool(
          'create_docx',
          '已生成 Word 文档 /workspace/docs/会议 纪要 _1 100_.docx（3 个块，2.1 KB）',
        ),
        tool(
          'create_xlsx',
          '已生成 Excel /workspace/docs/报销 单 #2 50%.xlsx（1 个工作表，3 行，4.0 KB）',
        ),
        tool(
          'generate_image',
          '已生成图片 /workspace/images/猫 图 #1 90%.jpg（512×512，12.5 KB；渠道改写后的 prompt：a cat）',
        ),
        tool('write_file', '已写入 /workspace/notes/会议 记录 #1 100%.md（120 字符）'),
      ]),
    ]);

    assert.deepEqual(
      files.map((file) => [file.relPath, file.kind]),
      [
        ['docs/会议 纪要 _1 100_.docx', 'docx'],
        ['docs/报销 单 #2 50%.xlsx', 'xlsx'],
        ['images/猫 图 #1 90%.jpg', 'image'],
        ['notes/会议 记录 #1 100%.md', 'file'],
      ],
    );
    assert.equal(files[0]?.name, '会议 纪要 _1 100_.docx');
    assert.equal(files[0]?.mime, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    assert.equal(files[2]?.mime, 'image/jpeg');
    assert.equal(files[3]?.mime, 'text/markdown');
  });

  it('同一路径只留一次（后生成的覆盖前一条）', () => {
    const files = collectGeneratedFiles([
      turn([
        tool('create_docx', '已生成 Word 文档 /workspace/docs/周报.docx（1 个块，1.0 KB）'),
        tool('create_docx', '已生成 Word 文档 /workspace/docs/周报.docx（2 个块，1.5 KB）'),
      ]),
      turn([
        tool('create_docx', '已生成 Word 文档 /workspace/docs/周报.docx（3 个块，2.0 KB）'),
      ]),
    ]);
    assert.equal(files.length, 1);
    assert.equal(files[0]?.relPath, 'docs/周报.docx');
  });

  it('失败 / 被拒绝的工具块跳过', () => {
    const files = collectGeneratedFiles([
      turn([
        tool('create_docx', '[错误] blocks 为空', 'error'),
        tool('generate_image', '[已拒绝] 用户拒绝了这次操作', 'error'),
        tool('create_xlsx', '已生成 Excel /workspace/docs/好.xlsx（1 个工作表，1 行，2 KB）', 'running'),
        tool('create_xlsx', '已生成 Excel /workspace/docs/成功.xlsx（1 个工作表，1 行，2 KB）'),
      ]),
    ]);
    assert.deepEqual(files.map((file) => file.relPath), ['docs/成功.xlsx']);
  });

  it('结果被 clip 且路径不完整时跳过（没有 `（` 边界）', () => {
    const clipped = `已生成 Word 文档 /workspace/docs/${'很长的文件名'.repeat(30)}…`;
    const files = collectGeneratedFiles([
      turn([tool('create_docx', clipped)]),
      turn([
        // detail 被截断，但路径在 `（` 之前完整：仍可保留
        tool(
          'create_xlsx',
          `已生成 Excel /workspace/docs/完整.xlsx（1 个工作表，${'数据'.repeat(200)}…`,
        ),
      ]),
    ]);
    assert.deepEqual(files.map((file) => file.relPath), ['docs/完整.xlsx']);
  });

  it('忽略非生成工具、缺 detail 和越界路径', () => {
    const files = collectGeneratedFiles([
      turn([
        tool('bash', '已写入 /workspace/evil.txt（1 字符）'),
        tool('create_docx', undefined),
        tool('create_docx', '已生成 Word 文档 /workspace/../evil.docx（1 个块）'),
        tool('create_docx', '已生成 Word 文档 /tmp/outside.docx（1 个块）'),
      ]),
    ]);
    assert.deepEqual(files, []);
  });
});
