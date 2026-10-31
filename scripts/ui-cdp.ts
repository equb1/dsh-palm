/**
 * 用 Chrome DevTools Protocol 驱动 web 版：连接 → 会话 → 聊天 → 审批，
 * 逐步截图，证明界面真的能用（不是"能编译"）。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const APP_URL = process.argv[2] ?? 'http://127.0.0.1:8099/';
const OUT = process.argv[3] ?? 'artifacts';
mkdirSync(OUT, { recursive: true });

interface Cdp {
  send(method: string, params?: unknown): Promise<any>;
  close(): void;
}

async function connectCdp(): Promise<Cdp> {
  let targets: any[] = [];
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch('http://127.0.0.1:9222/json/list');
      targets = (await res.json()) as any[];
      if (targets.some((t) => t.type === 'page')) break;
    } catch {
      /* chrome 还没起 */
    }
    await delay(250);
  }
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('找不到可调试的页面');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((res, rej) => {
    ws.once('open', () => res());
    ws.once('error', rej);
  });

  let id = 0;
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString()) as { id?: number; result?: any; error?: any };
    if (msg.id === undefined) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.rej(new Error(JSON.stringify(msg.error)));
    else p.res(msg.result);
  });

  return {
    send(method, params) {
      const mid = ++id;
      return new Promise((res, rej) => {
        pending.set(mid, { res, rej });
        ws.send(JSON.stringify({ id: mid, method, params: params ?? {} }));
      });
    },
    close: () => ws.close(),
  };
}

async function evalJs(cdp: Cdp, expression: string): Promise<any> {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  return r?.result?.value;
}

async function waitFor(cdp: Cdp, needle: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = (await evalJs(cdp, 'document.body ? document.body.innerText : ""')) as string;
    if (text && text.includes(needle)) return;
    await delay(250);
  }
  throw new Error(`等待文本超时：${needle}`);
}

async function waitForExpr(cdp: Cdp, expr: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evalJs(cdp, expr)) return;
    await delay(250);
  }
  throw new Error('等待条件超时：' + expr);
}

async function shot(cdp: Cdp, name: string): Promise<void> {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${OUT}/${name}.png`, Buffer.from(r.data, 'base64'));
  console.log(`  shot -> ${OUT}/${name}.png`);
}

const CLICK = (matcher: string) => `
(() => {
  const els = [...document.querySelectorAll('[role="button"]')];
  const el = els.find(e => (e.textContent || '').includes(${JSON.stringify(matcher)}));
  if (!el) return 'not-found:' + els.map(e => (e.textContent||'').trim().slice(0,12)).join('|');
  el.click();
  return 'clicked';
})()
`;

async function main(): Promise<void> {
  const cdp = await connectCdp();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 430, height: 932, deviceScaleFactor: 2, mobile: true,
  });

  console.log('1. 打开连接页');
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitFor(cdp, '装进口袋的智能体');
  await shot(cdp, '01-connect');

  console.log('2. 填引擎地址并连接');
  const setUrl = await evalJs(
    cdp,
    `(() => {
      const input = document.querySelector('input');
      if (!input) return 'no-input';
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(input, 'ws://127.0.0.1:8787/ws');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return input.value;
    })()`,
  );
  console.log('   input =', setUrl);
  await delay(200);
  console.log('   click:', await evalJs(cdp, CLICK('连接')));

  await waitFor(cdp, '收一个锦囊');
  await shot(cdp, '02-sessions');

  console.log('3. 打开一个会话');
  console.log('   click:', await evalJs(cdp, CLICK('合同金额核对')));
  await waitForExpr(cdp, "!!document.querySelector('textarea')");
  await shot(cdp, '03-chat');

  console.log('4. 发一条消息，等审批卡');
  await evalJs(
    cdp,
    `(() => {
      const input = document.querySelector('textarea') || document.querySelector('input[type="text"]') || [...document.querySelectorAll('input')].pop();
      if (!input) return 'no-input';
      const proto = input.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, 'value').set.call(input, '这份合同的金额帮我对一下');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return 'typed';
    })()`,
  );
  await delay(300);
  console.log('   send:', await evalJs(cdp, CLICK('↑')));

  await waitFor(cdp, '批准', 30_000);
  await shot(cdp, '04-approval');

  console.log('5. 批准');
  console.log('   click:', await evalJs(cdp, CLICK('批准')));
  await delay(2500);
  await shot(cdp, '05-after-approve');

  cdp.close();
  console.log('done');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
