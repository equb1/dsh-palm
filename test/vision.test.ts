import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FileRef } from '../app/src/protocol';
import { buildFileLines, promptWithFiles } from '../app/src/lib/attachments/prompt';
import {
  MAX_VISION_IMAGE_BYTES,
  MAX_VISION_IMAGES,
  normalizeVisionMime,
  selectVisionFiles,
  supportsVisionModel,
  visionFileRef,
} from '../app/src/engine/light/vision';

function file(overrides: Partial<FileRef> = {}): FileRef {
  return {
    path: '/data/local/tmp/a.png',
    relPath: 'uploads/a.png',
    name: 'a.png',
    mime: 'image/png',
    bytes: 100,
    ...overrides,
  };
}

describe('轻引擎 · 图片视觉（M2.4）', () => {
  it('视觉模型名识别；未知模型按不支持', () => {
    assert.equal(supportsVisionModel('gpt-4o'), true);
    assert.equal(supportsVisionModel('DeepSeek-V4.1-Flash'), false);
    assert.equal(supportsVisionModel('qwen2.5-vl-72b'), true);
    assert.equal(supportsVisionModel('claude-3-5-sonnet'), true);
    assert.equal(supportsVisionModel('deepseek-chat'), false);
  });

  it('非视觉模型：图片全部降级并给一句人话', () => {
    const selection = selectVisionFiles([file()], false);
    assert.equal(selection.hasImages, true);
    assert.equal(selection.accepted.length, 0);
    assert.equal(selection.rejected, 1);
    assert.match(selection.note ?? '', /未声明视觉能力/);
  });

  it('视觉模型：最多 4 张，单张 8MB，超限降级', () => {
    const five = Array.from({ length: 5 }, (_, i) =>
      file({ relPath: `uploads/${i}.png`, name: `${i}.png` }),
    );
    const selection = selectVisionFiles(five, true);
    assert.equal(selection.accepted.length, MAX_VISION_IMAGES);
    assert.equal(selection.rejected, 1);
    assert.match(selection.note ?? '', /视觉上限/);

    const huge = selectVisionFiles([file({ bytes: MAX_VISION_IMAGE_BYTES + 1 })], true);
    assert.equal(huge.accepted.length, 0);
    assert.equal(huge.rejected, 1);
    assert.match(huge.note ?? '', /8MB/);

    const total = selectVisionFiles(
      Array.from({ length: 3 }, (_, i) =>
        file({ relPath: `uploads/${i}.png`, name: `${i}.png`, bytes: 6 * 1024 * 1024 }),
      ),
      true,
    );
    assert.equal(total.accepted.length, 2);
    assert.equal(total.rejected, 1);
  });

  it('附件清单区分「视觉输入」和「未解析」，降级说明接在清单后', () => {
    const files = [file(), file({ relPath: 'uploads/notes.md', name: 'notes.md', mime: 'text/markdown' })];
    const lines = buildFileLines(files, '/workspace', {
      visionPaths: new Set(['uploads/a.png']),
      visionNote: '当前模型未声明视觉能力，图片只保留路径。',
    });
    assert.match(lines[0] ?? '', /视觉输入/);
    assert.match(lines[1] ?? '', /未解析/);
    const prompt = promptWithFiles('看图', files, '/workspace', {
      visionNote: '当前模型未声明视觉能力，图片只保留路径。',
    });
    assert.match(prompt, /\[附件\]/);
    assert.match(prompt, /当前模型未声明视觉能力/);
    assert.ok(prompt.indexOf('当前模型未声明视觉能力') < prompt.indexOf('看图'));
  });

  it('历史引用只存工作区路径，不存 base64；MIME 规整', () => {
    assert.deepEqual(visionFileRef(file({ relPath: 'uploads/a.jpg', mime: 'image/jpg' })), {
      path: '/uploads/a.jpg',
      mime: 'image/jpeg',
    });
    assert.equal(normalizeVisionMime('image/svg+xml'), undefined);
  });
});
