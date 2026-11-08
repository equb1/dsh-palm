import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { WebSocketServer } from 'ws';

import { EngineClient } from '../app/src/lib/client';
import { startRealBridge, type RealBridge } from '../engine/src/real/server';

/**
 * 手机侧的锦囊 id 和电脑宿主预设不是一套（手机 `light`，电脑 `standard/ptc/minimal/cordis`）。
 * `sessions.create` 收到宿主不认识的 id 时必须落到宿主默认预设，不能把手机 id 直接塞给 `session/create`。
 */

const HOST_PRESETS = [
  { id: 'standard', order: 1, isDefault: true },
  { id: 'minimal', order: 2, isDefault: false },
];

let temp = '';
let workspace = '';
let dshHome = '';
let bridge: RealBridge;
let fake: Server;
let client: EngineClient;
const seenPresets: string[] = [];

before(async () => {
  temp = await mkdtemp(join(tmpdir(), 'dsh-bridge-preset-'));
  workspace = join(temp, 'workspace');
  dshHome = join(temp, 'dsh');
  await mkdir(workspace, { recursive: true });
  await writeFile(join(workspace, 'hello.txt'), 'hello');

  fake = createServer((req, res) => {
    if (req.url?.startsWith('/?token=')) {
      res.writeHead(303, { 'set-cookie': 'dsh-auth=test; Path=/' });
      res.end();
      return;
    }
    let body = '';
    req.on('data', (chunk) => { body += String(chunk); });
    req.on('end', () => {
      let parsed: {
        rpcId?: string;
        method?: string;
        payload?: { args?: { request?: { agentPreset?: string } } };
      } = {};
      try { parsed = JSON.parse(body) as typeof parsed; } catch { /* ignore */ }
      const method = String(parsed.method ?? '');
      const reply = (result: unknown): void => {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ type: 'server-response', rpcId: parsed.rpcId, result }));
      };
      if (method === 'agentPresets/list') {
        reply({ ok: true, value: { presets: HOST_PRESETS } });
        return;
      }
      if (method === 'session/list') {
        reply({ ok: true, value: { items: [] } });
        return;
      }
      if (method === 'session/modelCatalog') {
        reply({ ok: true, value: { groups: [] } });
        return;
      }
      if (method === 'workspace/initializeDefault') {
        reply({ ok: true, value: { workspace: { workspaceId: 'ws-test', title: 'Test', path: workspace } } });
        return;
      }
      if (method === 'session/create') {
        const preset = parsed.payload?.args?.request?.agentPreset;
        if (typeof preset === 'string') seenPresets.push(preset);
        // 真宿主遇到不认识的预设就是这条错；桥必须自己兜住
        if (preset && !HOST_PRESETS.some((p) => p.id === preset)) {
          reply({
            ok: false,
            error: { code: 'agent-preset/not-found', message: `Unknown agent preset: ${preset}` },
          });
          return;
        }
        reply({ ok: true, value: {} });
        return;
      }
      reply({ ok: true, value: {} });
    });
  });
  const wss = new WebSocketServer({ server: fake, path: '/api/remote.mux' });
  wss.on('connection', (ws) => {
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { streamId?: string; endpoint?: string };
      if (!msg.streamId) return;
      if (msg.endpoint === '$events') {
        ws.send(JSON.stringify({ streamId: msg.streamId, value: { type: 'ready', clientId: 'test-client' } }));
      } else if (msg.endpoint === 'workspace/follow') {
        ws.send(JSON.stringify({
          streamId: msg.streamId,
          value: {
            type: 'baseline',
            value: { items: [], archivedSessionIds: [], pinnedSessionIds: [] },
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

describe('真桥建会话：手机锦囊 id 落到宿主预设', () => {
  it('宿主认识的预设原样透传', async () => {
    const created = await client.request('sessions.create', { presetId: 'minimal', title: 'known' });
    assert.equal(created.session.presetId, 'minimal');
    assert.equal(seenPresets.at(-1), 'minimal');
  });

  it('手机专属的 light 落到宿主默认预设，不再报 agent-preset/not-found', async () => {
    const created = await client.request('sessions.create', { presetId: 'light', title: 'from phone' });
    assert.equal(seenPresets.at(-1), 'standard');
    assert.equal(created.session.presetId, 'standard');
    assert.equal(created.session.title, 'from phone');
  });
});
