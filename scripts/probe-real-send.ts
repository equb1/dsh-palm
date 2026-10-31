/**
 * 在真 dsh UI 里发一条消息，把 WS 帧和 /api 调用全抓下来。
 * 目的：搞清「发消息」和「流式增量」的真实形状（哪怕模型没配好，错误事件也有价值）。
 */
import { writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const URL_ARG = process.argv[2] ?? 'http://127.0.0.1:8899/';
const OUT = process.argv[3] ?? 'artifacts/real-send-frames.json';

async function main(): Promise<void> {
  const list = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as any[];
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((r) => ws.once('open', () => r()));

  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  const frames: Array<{ t: string; dir: string; data: string }> = [];
  const apiCalls: Array<{ method: string; url: string; body?: string }> = [];

  ws.on('message', (raw) => {
    const m = JSON.parse(String(raw)) as { id?: number; method?: string; params?: any };
    if (m.id !== undefined) {
      pending.get(m.id)?.(m);
      return;
    }
    if (m.method === 'Network.webSocketFrameSent' || m.method === 'Network.webSocketFrameReceived') {
      const p = m.params.response ?? m.params;
      frames.push({
        t: new Date().toISOString().slice(11, 23),
        dir: m.method === 'Network.webSocketFrameSent' ? '→' : '←',
        data: String(p.payloadData ?? ''),
      });
    }
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      if (r.url.includes('/api/') && r.method === 'POST') {
        apiCalls.push({ method: 'POST', url: r.url, body: r.postData });
      }
    }
  });

  const send = (method: string, params?: unknown): Promise<any> =>
    new Promise((res) => {
      const mid = ++id;
      pending.set(mid, (m) => res(m.result));
      ws.send(JSON.stringify({ id: mid, method, params: params ?? {} }));
    });

  await send('Network.enable');
  await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440, height: 900, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url: URL_ARG });
  await delay(9000);

  const probe = await send('Runtime.evaluate', {
    expression: `(() => {
      const ta = document.querySelector('textarea');
      const ce = document.querySelector('[contenteditable="true"]');
      return JSON.stringify({
        textarea: !!ta,
        contenteditable: !!ce,
        placeholder: (ta && ta.placeholder) || (ce && ce.getAttribute('data-placeholder')) || '',
      });
    })()`,
    returnByValue: true,
  });
  console.log('composer:', probe.result.value);

  const hasTextarea = String(probe.result.value).includes('"textarea":true');

  // 聚焦输入框
  await send('Runtime.evaluate', {
    expression: hasTextarea
      ? `(() => { const el = document.querySelector('textarea'); el.focus(); return 'focused'; })()`
      : `(() => { const el = document.querySelector('[contenteditable="true"]'); el.focus(); return 'focused'; })()`,
    returnByValue: true,
  });

  await send('Input.insertText', { text: '用一句话自我介绍' });
  await delay(500);

  const beforeCount = frames.length;
  console.log('typing done, frames so far:', beforeCount);

  // 回车发送
  for (const type of ['keyDown', 'char', 'keyUp']) {
    await send('Input.dispatchKeyEvent', {
      type,
      key: 'Enter',
      code: 'Enter',
      windowsVirtualKeyCode: 13,
      nativeVirtualKeyCode: 13,
      text: type === 'char' ? '\r' : undefined,
    });
  }
  await delay(9000);

  const after = frames.slice(beforeCount);
  console.log(`\n--- 发送后新增帧 ${after.length} 条 ---`);
  for (const f of after.slice(0, 20)) {
    console.log(`${f.dir} ${f.data.slice(0, 400).replace(/\s+/g, ' ')}`);
  }

  console.log('\n--- 发送后的 /api 调用 ---');
  for (const c of apiCalls.slice(-8)) {
    console.log(`${c.method} ${c.url.replace(URL_ARG.replace(/\/$/, ''), '')}  body=${(c.body ?? '').slice(0, 160)}`);
  }

  writeFileSync(OUT, JSON.stringify({ frames, apiCalls }, null, 2));
  console.log('\nsaved ->', OUT);
  ws.close();
}

void main();
