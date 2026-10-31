/**
 * 探账号相关的 mux 流端点：哪些存在、返回什么。
 * 只开流读首帧，不发起登录。
 */
import WebSocket from 'ws';

import { DshRealClient } from '../engine/src/real/dshClient';

const baseUrl = process.argv[2] ?? 'http://127.0.0.1:8899';
const token = process.argv[3] ?? '';

const ENDPOINTS = [
  'account/watch',
  'account/login',
  'account/signIn',
  'account/startLogin',
  'account/authorize',
  'account/oauth',
  'account/session',
  'account/deviceCode',
  'account/logout',
];

async function probe(cookie: string, endpoint: string): Promise<string> {
  return new Promise((resolve) => {
    const ws = new WebSocket(baseUrl.replace('http', 'ws') + '/api/remote.mux', { headers: { cookie } } as never);
    const streamId = crypto.randomUUID();
    const items: string[] = [];
    const finish = (msg: string): void => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
      resolve(msg);
    };
    const timer = setTimeout(() => finish(items.join(' | ') || '(无响应)'), 2500);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'open', streamId, endpoint, payload: { args: {} } }));
    });
    ws.on('message', (raw) => {
      const msg = JSON.parse(String(raw)) as { streamId?: string; type?: string; value?: unknown };
      if (msg.streamId !== streamId) return;
      items.push(JSON.stringify(msg.value ?? msg).slice(0, 220));
      if (items.length >= 2) {
        clearTimeout(timer);
        finish(items.join(' | '));
      }
    });
    ws.on('error', (e) => {
      clearTimeout(timer);
      finish('WS 错误: ' + String((e as Error).message).slice(0, 80));
    });
    ws.on('close', () => {
      clearTimeout(timer);
      if (items.length === 0) resolve('(连接被关闭)');
    });
  });
}

async function main(): Promise<void> {
  const client = new DshRealClient(baseUrl, token);
  await client.login();
  const cookie = (client as unknown as { cookie: string }).cookie;

  for (const ep of ENDPOINTS) {
    const result = await probe(cookie, ep);
    console.log(`${ep.padEnd(22)} -> ${result}`);
  }
}

void main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
