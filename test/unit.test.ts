/**
 * 单元测试：协议判别 + 真引擎事件投影。
 * 这些是纯函数，不连网络、不碰原生。
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { eventSessionId, isEvent, isResponse, PROTOCOL_VERSION } from '../app/src/protocol';
import { projectRecords, titleFromRecords, type RealRecord } from '../engine/src/real/project';

test('协议版本与事件/响应判别', () => {
  assert.equal(PROTOCOL_VERSION, 1);
  assert.equal(isEvent({ type: 'event', v: 1, event: 'session.updated', seq: 1, data: {} } as never), true);
  assert.equal(isEvent({ type: 'res', v: 1, id: 'x', ok: true, result: {} } as never), false);
  assert.equal(isResponse({ type: 'res', v: 1, id: 'x', ok: true, result: {} } as never), true);
});

test('eventSessionId 兼容直接字段与嵌套 session.id', () => {
  assert.equal(eventSessionId({ sessionId: 'a' }), 'a');
  assert.equal(eventSessionId({ session: { id: 'b' } }), 'b');
  assert.equal(eventSessionId({ foo: 1 }), undefined);
});

test('标题取最后一条 session/title', () => {
  const records = [
    { event: { type: 'session/title', data: { title: '旧标题' } } },
    { event: { type: 'session/title', data: { title: ' 新标题 ' } } },
  ] as RealRecord[];
  assert.equal(titleFromRecords(records), '新标题');
  assert.equal(titleFromRecords([]), null);
});

test('用户消息投影成回合，系统注入的 user/message 被忽略', () => {
  const records = [
    {
      event: {
        type: 'user/message',
        time: 1,
        data: { id: 'u1', source: { kind: 'user' }, content: [{ type: 'text', text: '你好' }] },
      },
    },
    {
      event: {
        type: 'user/message',
        time: 2,
        data: { id: 'u2', source: { kind: 'runtime' }, content: [{ type: 'text', text: '系统注入' }] },
      },
    },
  ] as RealRecord[];
  const projection = projectRecords(records);
  assert.equal(projection.turns.length, 1);
  assert.equal(projection.turns[0]!.role, 'user');
  assert.equal(projection.turns[0]!.status, 'done');
});

test('用户消息中的 file 与 image 附件块被投影为可读标签，turn/end error 状态正确映射', () => {
  const records = [
    {
      event: {
        type: 'user/message',
        time: 1,
        data: {
          id: 'u1',
          source: { kind: 'user' },
          content: [
            { type: 'text', text: '看看这个文件' },
            { type: 'file', attachment: { attachmentId: 'sha256:123', name: 'report.pdf', bytes: 100 } },
            { type: 'image', attachment: { attachmentId: 'sha256:456', name: 'photo.jpg', bytes: 200 } },
          ],
        },
      },
    },
    {
      event: {
        type: 'turn/end',
        time: 2,
        data: { reason: { kind: 'error', message: 'API Key 无效' } },
      },
    },
  ] as RealRecord[];
  const projection = projectRecords(records);
  assert.equal(projection.turns.length, 2);
  assert.equal(projection.turns[0]!.blocks.length, 3);
  assert.deepEqual(
    projection.turns[0]!.blocks.map((b) => (b.kind === 'text' ? b.text : '')),
    ['看看这个文件', '[附件: report.pdf]', '[图片: photo.jpg]'],
  );
  assert.equal(projection.turns[1]!.role, 'assistant');
  assert.equal(projection.turns[1]!.status, 'error');
});

test('fs-link-fallback 在硬链接被禁时保留源文件并在目标已存在时抛 EEXIST', async () => {
  const fs = await import('node:fs');
  const fsp = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const { createRequire } = await import('node:module');
  const req = createRequire(import.meta.url);
  const patch = req('../app/android/app/src/main/assets/patch/fs-link-fallback.cjs') as {
    original: { link: typeof fsp.link };
    linkAsync: typeof fsp.link;
  };

  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'dsh-link-test-'));
  const staged = path.join(dir, 'staged.tmp');
  const objectPath = path.join(dir, 'object');
  const aliasPath = path.join(dir, 'alias.txt');
  await fsp.writeFile(staged, 'hello-attachment');

  // 模拟 Android EACCES
  const orig = patch.original.link;
  patch.original.link = async () => {
    throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
  };
  try {
    // 1. 模拟 publishStagedObject: link(staged, objectPath) -> unlink(staged) -> chmod(0o400)
    await patch.linkAsync(staged, objectPath);
    await fsp.unlink(staged);
    await fsp.chmod(objectPath, 0o400);
    assert.equal(await fsp.readFile(objectPath, 'utf8'), 'hello-attachment');

    // 2. 模拟 publishImmutableAlias: link(objectPath, aliasPath)
    await patch.linkAsync(objectPath, aliasPath);
    assert.equal(await fsp.readFile(objectPath, 'utf8'), 'hello-attachment');
    assert.equal(await fsp.readFile(aliasPath, 'utf8'), 'hello-attachment');

    // 3. 模拟重复上传同一文件：目标已存在且只读 (0o400)，应抛 EEXIST
    const staged2 = path.join(dir, 'staged2.tmp');
    await fsp.writeFile(staged2, 'hello-attachment');
    await assert.rejects(
      () => patch.linkAsync(staged2, objectPath),
      (err: { code?: string }) => err.code === 'EEXIST',
    );
  } finally {
    patch.original.link = orig;
    await fsp.chmod(objectPath, 0o600).catch(() => {});
    await fsp.rm(dir, { recursive: true, force: true });
  }
});
