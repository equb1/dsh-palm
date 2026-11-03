import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { NodeBackend } from '../app/src/engine/fs/nodeBackend';
import { createDataSandbox, createWorkspaceMount } from '../app/src/engine/fs/mount';
import { ShellRunner } from '../app/src/engine/shell/bash';
import { LightHost } from '../app/src/engine/light/host';
import { LocalEngineClient } from '../app/src/engine/light/localClient';
import type { EngineEvent } from '../app/src/protocol';

/**
 * 端到端：真 HTTP + 真 SSE + 真 LightHost，只有模型是本地假服务。
 *
 * 这条用例覆盖 fake stream 覆盖不到的部分：transport、SSE 行缓冲、
 * JSON 请求体、工具消息回灌，以及"审批通过后 bash 真的落到工作区"。
 */

const roots: string[] = [];
const servers: Array<{ close(): Promise<void> }> = [];

after(async () => {
  await Promise.all(servers.map((server) => server.close()));
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

async function tempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  roots.push(dir);
  return dir;
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

/** 第一次请求要求调 bash，第二次请求输出最终文本 */
async function startModelServer(): Promise<{ baseURL: string; bodies: string[] }> {
  const bodies: string[] = [];
  let call = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      bodies.push(body);
      call += 1;
      const write = (chunks: string[]): void => {
        res.setHeader('Content-Type', 'text/event-stream');
        res.flushHeaders?.();
        for (const chunk of chunks) res.write(chunk);
        res.end();
      };
      if (call === 1) {
        write([
          sse({ choices: [{ delta: { content: '我先建个文件。' } }] }),
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_bash_1',
                      type: 'function',
                      function: {
                        name: 'bash',
                        arguments: JSON.stringify({ command: 'echo from-e2e > hello.txt' }),
                      },
                    },
                  ],
                },
              },
            ],
          }),
          sse({ choices: [{ finish_reason: 'tool_calls' }] }),
          'data: [DONE]\n\n',
        ]);
      } else {
        write([
          sse({ choices: [{ delta: { content: '建好了：hello.txt' } }] }),
          sse({ choices: [{ finish_reason: 'stop' }] }),
          sse({ choices: [], usage: { prompt_tokens: 20, completion_tokens: 8 } }),
          'data: [DONE]\n\n',
        ]);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('拿不到端口');
  servers.push({
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  });
  return { baseURL: `http://127.0.0.1:${address.port}/v1`, bodies };
}

function nextEvent(client: LocalEngineClient, name: string): Promise<EngineEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待事件超时：${name}`)), 15_000);
    const off = client.onAny((event) => {
      if (event.event !== name) return;
      clearTimeout(timer);
      off();
      resolve(event);
    });
  });
}

describe('轻引擎 · 端到端（真 SSE 服务）', () => {
  it('流式回答 → 审批 → bash 落盘 → 工具结果回灌 → 最终回答', async () => {
    const model = await startModelServer();
    const workspaceRoot = await tempDir('dsh-palm-e2e-ws-');
    const dataRoot = await tempDir('dsh-palm-e2e-data-');

    const mount = await createWorkspaceMount({ backend: new NodeBackend({ root: workspaceRoot }) });
    const dataFs = await createDataSandbox(new NodeBackend({ root: dataRoot }));
    const shell = new ShellRunner({ fs: mount.fs, beforeRun: () => mount.workspace.refreshIndex() });
    const host = new LightHost({
      workspace: mount.workspace,
      shell,
      dataFs,
      model: { baseURL: model.baseURL, apiKey: 'e2e-key', model: 'e2e-model', providerName: 'E2E' },
      maxSteps: 4,
      approvalTimeoutMs: 10_000,
    });
    const client = new LocalEngineClient(host);
    await client.connect();

    const { session } = await client.request('sessions.create', { presetId: 'light', title: 'e2e' });

    const approval = nextEvent(client, 'approval.requested');
    const finished = nextEvent(client, 'run.finished');

    await client.request('sessions.send', { sessionId: session.id, text: '建个 hello.txt' });

    const approvalEvent = await approval;
    const card = (approvalEvent.data as { approval: { id: string; title: string; command?: string } }).approval;
    assert.equal(card.title, '执行命令');
    assert.match(card.command ?? '', /hello\.txt/);

    await client.request('approvals.resolve', { approvalId: card.id, decision: 'approve' });
    const done = await finished;
    assert.equal((done.data as { reason: string }).reason, 'done');

    // bash 真的在真实目录里建了文件
    assert.equal(existsSync(join(workspaceRoot, 'hello.txt')), true);

    const detail = await client.request('sessions.get', { sessionId: session.id });
    const text = detail.session.turns
      .flatMap((turn) => turn.blocks)
      .map((block) => (block.kind === 'text' ? block.text : ''))
      .join('');
    assert.match(text, /我先建个文件/);
    assert.match(text, /建好了：hello\.txt/);

    // 第二次请求真的带上了工具结果（role=tool）
    assert.equal(model.bodies.length, 2);
    const second = JSON.parse(model.bodies[1] ?? '{}') as {
      messages: Array<{ role: string; tool_call_id?: string; content?: string }>;
    };
    const toolMessage = second.messages.find((message) => message.role === 'tool');
    assert.ok(toolMessage, '第二次请求里应当有工具结果');
    assert.equal(toolMessage?.tool_call_id, 'call_bash_1');

    client.close();
  });
});
