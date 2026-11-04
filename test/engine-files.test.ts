/**
 * 轻引擎的附件路径引用（1.3）：files 拼进模型消息、非法 relPath 拒绝、回执式附件仍不支持。
 */
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { NodeBackend } from '../app/src/engine/fs/nodeBackend';
import { createDataSandbox, createWorkspaceMount } from '../app/src/engine/fs/mount';
import { ShellRunner } from '../app/src/engine/shell/bash';
import { LightHost } from '../app/src/engine/light/host';
import { LocalEngineClient } from '../app/src/engine/light/localClient';
import type { LightModelConfig } from '../app/src/engine/light/types';
import type { EngineEvent, FileRef } from '../app/src/protocol';
import type {
  StreamHandlers,
  StreamOptions,
  StreamResult,
} from '../app/src/engine/light/provider';

const roots: string[] = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const MODEL: LightModelConfig = {
  baseURL: 'https://example.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
  providerName: 'Fake',
};

const FILE: FileRef = {
  path: '/data/user/0/cool.cnb.dshpalm/files/workspace/uploads/abc-x.md',
  relPath: 'uploads/abc-x.md',
  name: 'x.md',
  displayName: '说明.md',
  mime: 'text/markdown',
  bytes: 2048,
  hash: 'abc',
};

interface Harness {
  host: LightHost;
  client: LocalEngineClient;
  events: EngineEvent[];
  calls: StreamOptions['messages'][];
}

async function makeHost(): Promise<Harness> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-files-ws-'));
  const dataRoot = await mkdtemp(join(tmpdir(), 'dsh-files-data-'));
  roots.push(workspaceRoot, dataRoot);

  const mount = await createWorkspaceMount({ backend: new NodeBackend({ root: workspaceRoot }) });
  const dataFs = await createDataSandbox(new NodeBackend({ root: dataRoot }));
  const shell = new ShellRunner({ fs: mount.fs, beforeRun: () => mount.workspace.refreshIndex() });
  const calls: StreamOptions['messages'][] = [];
  const stream = async (
    _config: LightModelConfig,
    options: StreamOptions,
    handlers: StreamHandlers,
  ): Promise<StreamResult> => {
    calls.push(options.messages);
    handlers.onText?.('收到');
    return { text: '收到', thinking: '', toolCalls: [] };
  };
  const host = new LightHost({
    workspace: mount.workspace,
    shell,
    dataFs,
    model: MODEL,
    maxSteps: 2,
    approvalTimeoutMs: 5_000,
    questionTimeoutMs: 5_000,
    stream: stream as unknown as (typeof import('../app/src/engine/light/provider'))['streamChat'],
  });
  const events: EngineEvent[] = [];
  host.onEvent((event) => events.push(event));
  const client = new LocalEngineClient(host);
  await client.connect();
  return { host, client, events, calls };
}

function nextEvent(harness: Harness, name: string): Promise<EngineEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待事件超时：${name}`)), 10_000);
    const off = harness.host.onEvent((event) => {
      if (event.event !== name) return;
      clearTimeout(timer);
      off();
      resolve(event);
    });
  });
}

async function createSession(harness: Harness): Promise<string> {
  const { session } = await harness.client.request('sessions.create', {
    presetId: 'light',
    title: '附件测试',
  });
  return session.id;
}

describe('轻引擎 · 附件路径引用', () => {
  it('sessions.send 带 files：用户消息含 /workspace/uploads 路径，且没有回执附件', async () => {
    const harness = await makeHost();
    const sessionId = await createSession(harness);
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', {
      sessionId,
      text: '看一下这个文件',
      files: [FILE],
    });
    await finished;

    const messages = harness.calls[0] ?? [];
    const system = messages.find((message) => message.role === 'system');
    assert.match(String(system?.content ?? ''), /\/workspace\/uploads/);
    const user = [...messages].reverse().find((message) => message.role === 'user');
    assert.ok(user, '缺少用户消息');
    assert.match(String(user.content), /- \/workspace\/uploads\/abc-x\.md \(text\/markdown, 2\.0 KB, 未解析\)/);
    assert.match(String(user.content), /看一下这个文件/);
    // 没有回执式 file 块：轻引擎只读路径
    assert.equal(messages.some((message) => message.role === 'tool'), false);
  });

  it('relPath 带 .. 或不在 uploads 里 → bad_request', async () => {
    const harness = await makeHost();
    const sessionId = await createSession(harness);
    for (const relPath of ['../secret', 'uploads/../secret', '/etc/passwd', 'etc/passwd']) {
      await assert.rejects(
        () =>
          harness.client.request('sessions.send', {
            sessionId,
            text: '读这个',
            files: [{ ...FILE, relPath }],
          }),
        (error: { code?: string }) => error.code === 'bad_request',
        relPath,
      );
    }
  });

  it('旧客户端的 attachments 回执仍然 unsupported', async () => {
    const harness = await makeHost();
    const sessionId = await createSession(harness);
    await assert.rejects(
      () =>
        harness.client.request('sessions.send', {
          sessionId,
          text: '看附件',
          attachments: ['receipt-1'],
        }),
      (error: { code?: string }) => error.code === 'unsupported',
    );
  });
});
