import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { WebSocketServer } from 'ws';

import { EngineClient } from '../app/src/lib/client';
import { startRealBridge, type RealBridge } from '../engine/src/real/server';
import { encodeSegment, projectKey } from '../engine/src/real/sessionFs';

let temp = '';
let workspace = '';
let dshHome = '';
let bridge: RealBridge;
let fake: Server;
let client: EngineClient;
let itemDeleted = false;

function jsonl(events: Array<Record<string, unknown>>): string {
  return events.map((event) => JSON.stringify({ type: 'event', event })).join('\n') + '\n';
}

before(async () => {
  temp = await mkdtemp(join(tmpdir(), 'dsh-bridge-parity-'));
  workspace = join(temp, 'workspace');
  dshHome = join(temp, 'dsh');
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, 'hello.txt'), 'hello workspace');
  const sessionDir = join(dshHome, 'sessions', projectKey(workspace), encodeSegment('session-parity'));
  await mkdir(sessionDir, { recursive: true });
  await writeFile(
    join(sessionDir, 'session.v4.jsonl'),
    jsonl([
      {
        type: 'user/message',
        seq: 1,
        time: 100,
        data: {
          source: { kind: 'user' },
          content: [{ type: 'text', text: 'hello searchable parity' }],
        },
      },
    ]),
  );

  fake = createServer((req, res) => {
    if (req.url?.startsWith('/?token=')) {
      res.writeHead(303, { 'set-cookie': 'dsh-auth=test; Path=/' });
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += String(chunk); });
    req.on('end', () => {
      let parsed: { rpcId?: string; method?: string } = {};
      try { parsed = JSON.parse(body) as typeof parsed; } catch { /* ignore */ }
      const method = String(parsed.method ?? '');
      let value: unknown = {};
      if (method === 'agentPresets/list') value = { presets: [] };
      else if (method === 'session/list') {
        value = {
          items: itemDeleted
            ? []
            : [{
                sessionId: 'session-parity',
                updatedAt: 123,
                running: false,
                cwd: workspace,
                projections: {
                  values: {
                    title: 'Parity session',
                    workingDirectory: workspace,
                    agentPreset: 'standard',
                  },
                },
              }],
        };
      } else if (method === 'session/modelCatalog') value = { groups: [] };
      else if (method === 'workspace/initializeDefault') {
        value = { workspace: { workspaceId: 'ws-test', title: 'Test', path: workspace } };
      } else if (method === 'workspace/create') {
        value = { workspace: { workspaceId: 'ws-test', title: 'Test', path: workspace } };
      } else if (method === 'session/create') value = {};
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        type: 'server-response',
        rpcId: parsed.rpcId,
        result: { ok: true, value },
      }));
    });
  });
  const wss = new WebSocketServer({ server: fake, path: '/api/remote.mux' });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { streamId?: string; endpoint?: string };
      if (!msg.streamId) return;
      if (msg.endpoint === '$events') {
        ws.send(JSON.stringify({
          streamId: msg.streamId,
          value: { type: 'ready', clientId: 'test-client' },
        }));
      } else if (msg.endpoint === 'workspace/follow') {
        ws.send(JSON.stringify({
          streamId: msg.streamId,
          value: {
            type: 'baseline',
            value: {
              items: [{
                workspaceId: 'ws-test',
                path: workspace,
                title: 'Test Workspace',
                sessionIds: ['session-parity'],
              }],
              archivedSessionIds: [],
              pinnedSessionIds: [],
            },
          },
        }));
      }
    });
  });
  await new Promise<void>((resolve) => fake.listen(0, '127.0.0.1', resolve));
  const address = fake.address();
  const port = typeof address === 'object' && address ? address.port : 0;

  bridge = await startRealBridge({
    baseUrl: `http://127.0.0.1:${port}`,
    token: 'test',
    port: 0,
    pairCode: '',
    devicesFile: join(temp, 'devices.json'),
    identityFile: join(temp, 'identity.json'),
    workspaceRoot: workspace,
    dshHome,
    advertise: false,
  });
  client = new EngineClient({ url: `ws://127.0.0.1:${bridge.port}/ws` });
  await client.connect();
});

after(async () => {
  client?.close();
  await bridge?.close();
  await new Promise<void>((resolve) => fake?.close(() => resolve()));
  await rm(temp, { recursive: true, force: true });
});

describe('真桥平权：完整引擎 delete/search/shell/workspace', () => {
  it('shell.run 在只读工作区执行，写操作被拒绝', async () => {
    const pwd = await client.request('shell.run', { command: 'pwd' });
    assert.equal(pwd.stdout.trim(), '/workspace');
    const echo = await client.request('shell.run', { command: 'echo parity-ok' });
    assert.equal(echo.stdout.trim(), 'parity-ok');
    const write = await client.request('shell.run', { command: 'touch /workspace/nope.txt' });
    assert.notEqual(write.exitCode, 0);
    assert.match(write.stderr, /EACCES|read-only|permission/i);
  });

  it('sessions.search 读本地日志并返回片段', async () => {
    const result = await client.request('sessions.search', { query: 'SEARCHABLE' });
    assert.equal(result.results.length, 1);
    assert.equal(result.results[0]?.sessionId, 'session-parity');
    assert.match(result.results[0]?.snippet ?? '', /searchable/i);
    assert.equal(result.results[0]?.matches, 1);
  });

  it('workspaces.list 返回真实 workspaceId；create 可指定', async () => {
    const list = await client.request('workspaces.list', {});
    assert.equal(list.workspaces[0]?.id, 'ws-test');
    assert.equal(list.workspaces[0]?.root, workspace);
    const created = await client.request('sessions.create', {
      presetId: 'standard',
      workspaceId: 'ws-test',
      title: '新会话',
    });
    assert.equal(created.session.workspaceId, 'ws-test');
  });

  it('sessions.delete 删目录并从列表/搜索隐藏', async () => {
    const before = await client.request('sessions.list', {});
    assert.equal(before.sessions.length, 1);
    await client.request('sessions.delete', { sessionId: 'session-parity' });
    itemDeleted = true;
    const afterList = await client.request('sessions.list', {});
    assert.equal(afterList.sessions.length, 0);
    const afterSearch = await client.request('sessions.search', { query: 'searchable' });
    assert.equal(afterSearch.results.length, 0);
  });
});
