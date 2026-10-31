/**
 * 用 Chrome DevTools Protocol 驱动 web 版：
 * 连接 → 首页 → + 抽屉 → 选锦囊 → 发消息 → 审批 → 批准
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

async function waitForText(cdp: Cdp, needle: string, timeoutMs = 20_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const text = (await evalJs(cdp, 'document.body ? document.body.innerText : ""')) as string;
    if (text && text.includes(needle)) return;
    await delay(250);
  }
  throw new Error('等待文本超时：' + needle);
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

const clickLabel = (label: string) => `
(() => {
  const el = document.querySelector('[aria-label=${JSON.stringify(label)}]');
  if (!el) return 'not-found:${label}';
  el.click();
  return 'clicked:${label}';
})()
`;

/** 往输入框里写值（React 受控组件要走原生 setter + input 事件） */
const typeInto = (value: string) => `
(() => {
  const el = document.querySelector('textarea') || document.querySelector('input');
  if (!el) return 'no-input';
  const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return 'typed';
})()
`;

async function main(): Promise<void> {
  const cdp = await connectCdp();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 430, height: 932, deviceScaleFactor: 2, mobile: true,
  });

  console.log('1. 连接页');
  await cdp.send('Page.navigate', { url: APP_URL });
  await waitForText(cdp, '装进口袋的智能体');
  await shot(cdp, '01-connect');

  console.log('2. 填地址并连接');
  await evalJs(cdp, typeInto('ws://127.0.0.1:8787/ws'));
  await delay(200);
  console.log('   ', await evalJs(cdp, clickLabel('连接')));

  await waitForText(cdp, '需要我做点什么');
  await shot(cdp, '02-home');

  console.log('3. 打开 + 抽屉');
  console.log('   ', await evalJs(cdp, clickLabel('选择锦囊')));
  await waitForText(cdp, '收一个锦囊');
  await shot(cdp, '03-sheet');

  console.log('4. 选「文档助手」');
  console.log('   ', await evalJs(cdp, clickLabel('文档助手')));
  await delay(400);

  console.log('5. 发消息');
  await evalJs(cdp, typeInto('这份合同的金额帮我对一下'));
  await delay(300);
  console.log('   ', await evalJs(cdp, clickLabel('发送')));

  await waitForExpr(cdp, "!!document.querySelector('textarea')");
  await delay(1200);
  await shot(cdp, '04-chat');

  console.log('6. 等审批卡并批准');
  await waitForText(cdp, '批准', 30_000);
  await shot(cdp, '05-approval');
  console.log('   ', await evalJs(cdp, clickLabel('批准')));
  await delay(2500);
  await shot(cdp, '06-after-approve');

  cdp.close();
  console.log('done');
}

main().catch((err) => {
  console.error('FAILED:', err.message);
  process.exit(1);
});
