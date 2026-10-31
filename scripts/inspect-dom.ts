/** 排查用：打印指定坐标上的元素信息 */
import WebSocket from 'ws';

const X = Number(process.argv[2] ?? 278);
const Y = Number(process.argv[3] ?? 905);

async function main(): Promise<void> {
  const list = (await (await fetch('http://127.0.0.1:9222/json/list')).json()) as any[];
  const page = list.find((t) => t.type === 'page');
  if (!page) throw new Error('no page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise<void>((r) => ws.once('open', () => r()));

  let id = 0;
  const send = (method: string, params: unknown): Promise<any> =>
    new Promise((res) => {
      const mid = ++id;
      const onMsg = (raw: unknown): void => {
        const m = JSON.parse(String(raw)) as { id?: number; result?: any };
        if (m.id === mid) {
          ws.off('message', onMsg);
          res(m.result);
        }
      };
      ws.on('message', onMsg);
      ws.send(JSON.stringify({ id: mid, method, params: params ?? {} }));
    });

  const expr = `(() => {
    const el = document.elementFromPoint(${X}, ${Y});
    if (!el) return 'none';
    const cs = getComputedStyle(el);
    return [el.tagName, typeof el.className === 'string' ? el.className : '', el.getAttribute('aria-label') || '', cs.backgroundColor, cs.borderRightWidth, cs.width, el.textContent && el.textContent.slice(0, 20)].join(' | ');
  })()`;

  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true });
  console.log(r.result.value);
  ws.close();
}

void main();
