/**
 * 假模型服务：给真机 / 模拟器验证轻引擎用（不花 API Key）。
 *
 *   node --import tsx scripts/mock-model-server.ts [port]
 *
 * 行为（按 messages 里出现了哪些工具结果推进）：
 *   1. 没有 ask_user_question 的结果 → 先问用户选格式（验证提问卡）
 *   2. 没有 bash 的结果 → 要求执行 bash（验证审批卡 + 真实工作区）
 *   3. 都有 → 流式输出最终回答，并把 bash 的输出回显出来（验证真实文件内容）
 *
 * SSE 帧之间故意留 30–60ms，Hermes 上能观察到增量而不是一次性到达。
 */
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';

const PORT = Number(process.argv[2] ?? process.env.PORT ?? 8799);

/** 1x1 透明 PNG：生图接口回这个，验证落盘和尺寸解析 */
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

interface ChatMessage {
  role: string;
  content?: string | null;
  name?: string;
  tool_calls?: Array<{ function?: { name?: string } }>;
  tool_call_id?: string;
}

interface Plan {
  kind: 'question' | 'bash' | 'final' | 'xlsx' | 'docx' | 'image' | 'read-xlsx' | 'read-docx' | 'final-docs';
  answer?: string;
}

/** docs 模式：专门验证 create/read_xlsx、create/read_docx、generate_image */
const DOCS_MODE = process.env.MOCK_PLAN === 'docs';

function planFor(messages: ChatMessage[]): Plan {
  const toolMessages = messages.filter((message) => message.role === 'tool');
  const has = (name: string): boolean => toolMessages.some((message) => message.name === name);

  if (DOCS_MODE) {
    if (!has('create_xlsx')) return { kind: 'xlsx' };
    if (!has('create_docx')) return { kind: 'docx' };
    if (!has('generate_image')) return { kind: 'image' };
    if (!has('read_xlsx')) return { kind: 'read-xlsx' };
    if (!has('read_docx')) return { kind: 'read-docx' };
    return { kind: 'final-docs' };
  }

  const answerMessage = toolMessages.find((message) => message.name === 'ask_user_question');
  let answer = '';
  try {
    answer = JSON.parse(answerMessage?.content ?? '{}')?.answers?.[0]?.selected?.[0] ?? '';
  } catch {
    answer = '';
  }
  if (!has('ask_user_question')) return { kind: 'question' };
  if (!has('bash')) return { kind: 'bash' };
  return { kind: 'final', answer };
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

function contentChunks(text: string, size = 3): string[] {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += size) chunks.push(text.slice(i, i + size));
  return chunks;
}

async function writePlan(
  res: import('node:http').ServerResponse,
  plan: Plan,
  messages: ChatMessage[],
): Promise<void> {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  const emit = async (chunk: string, wait = 35): Promise<void> => {
    res.write(chunk);
    await delay(wait);
  };

  if (plan.kind === 'question') {
    await emit(sse({ choices: [{ delta: { reasoning_content: '先问清楚用户要什么格式。' } }] }), 40);
    await emit(sse({ choices: [{ delta: { content: '好的，先确认一下。' } }] }), 30);
    await emit(
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_ask_1',
                  type: 'function',
                  function: {
                    name: 'ask_user_question',
                    arguments: JSON.stringify({
                      questions: [
                        {
                          id: 'format',
                          header: '选个格式',
                          question: '纪要要什么格式？',
                          options: [
                            { label: 'Markdown', description: '纯文本，手机上最好读' },
                            { label: 'Word', description: '需要 docx 时再选' },
                          ],
                        },
                      ],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    await emit(sse({ choices: [{ finish_reason: 'tool_calls' }] }));
  } else if (plan.kind === 'bash') {
    const command = 'mkdir -p demo && printf "device-e2e ok\\n" > demo/hello.txt && cat demo/hello.txt';
    await emit(sse({ choices: [{ delta: { content: '选好了，我建个文件验证工作区。\n' } }] }), 25);
    await emit(
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_bash_1',
                  type: 'function',
                  function: { name: 'bash', arguments: JSON.stringify({ command }) },
                },
              ],
            },
          },
        ],
      }),
    );
    await emit(sse({ choices: [{ finish_reason: 'tool_calls' }] }));
  } else if (plan.kind === 'xlsx') {
    await emit(sse({ choices: [{ delta: { content: '先做表格。\n' } }] }), 20);
    await emit(
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_xlsx_1',
                  type: 'function',
                  function: {
                    name: 'create_xlsx',
                    arguments: JSON.stringify({
                      path: 'docs/device.xlsx',
                      sheets: [
                        {
                          name: '真机表',
                          rows: [
                            ['项目', '数值', '备注'],
                            ['工作区自检', '47ms', '真机'],
                            ['xlsx', 'OK', 'SheetJS'],
                          ],
                        },
                      ],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    await emit(sse({ choices: [{ finish_reason: 'tool_calls' }] }));
  } else if (plan.kind === 'docx') {
    await emit(sse({ choices: [{ delta: { content: '表格好了，再写文档。\n' } }] }), 20);
    await emit(
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_docx_1',
                  type: 'function',
                  function: {
                    name: 'create_docx',
                    arguments: JSON.stringify({
                      path: 'docs/device.docx',
                      title: '真机文档',
                      blocks: [
                        { type: 'heading', text: '验证', level: 2 },
                        { type: 'paragraph', text: '这份 docx 是手机上的轻引擎生成的。' },
                        { type: 'bullet', text: '中文正常' },
                        { type: 'table', rows: [['模块', '状态'], ['docx', 'OK']] },
                      ],
                    }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    await emit(sse({ choices: [{ finish_reason: 'tool_calls' }] }));
  } else if (plan.kind === 'image') {
    await emit(sse({ choices: [{ delta: { content: '文档好了，再生成一张图。\n' } }] }), 20);
    await emit(
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_image_1',
                  type: 'function',
                  function: {
                    name: 'generate_image',
                    arguments: JSON.stringify({ prompt: 'a tiny pixel', path: 'images/device.png' }),
                  },
                },
              ],
            },
          },
        ],
      }),
    );
    await emit(sse({ choices: [{ finish_reason: 'tool_calls' }] }));
  } else if (plan.kind === 'read-xlsx') {
    await emit(sse({ choices: [{ delta: { content: '读回表格核对一下。\n' } }] }), 20);
    await emit(
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_read_xlsx_1',
                  type: 'function',
                  function: { name: 'read_xlsx', arguments: JSON.stringify({ path: 'docs/device.xlsx' }) },
                },
              ],
            },
          },
        ],
      }),
    );
    await emit(sse({ choices: [{ finish_reason: 'tool_calls' }] }));
  } else if (plan.kind === 'read-docx') {
    await emit(sse({ choices: [{ delta: { content: '再读回文档。\n' } }] }), 20);
    await emit(
      sse({
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_read_docx_1',
                  type: 'function',
                  function: { name: 'read_docx', arguments: JSON.stringify({ path: 'docs/device.docx' }) },
                },
              ],
            },
          },
        ],
      }),
    );
    await emit(sse({ choices: [{ finish_reason: 'tool_calls' }] }));
  } else if (plan.kind === 'final-docs') {
    const resultOf = (name: string): string =>
      (messages.find((message) => message.role === 'tool' && message.name === name)?.content ?? '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
    const text = [
      '文档链路全部完成：',
      '1) Excel 生成：' + resultOf('create_xlsx'),
      '2) Word 生成：' + resultOf('create_docx'),
      '3) 图片：' + resultOf('generate_image'),
      '4) 读回 Excel：' + resultOf('read_xlsx'),
      '5) 读回 Word：' + resultOf('read_docx'),
    ].join('\n');
    for (const chunk of contentChunks(text)) {
      await emit(sse({ choices: [{ delta: { content: chunk } }] }), 30);
    }
    await emit(sse({ choices: [{ finish_reason: 'stop' }] }), 10);
    await emit(sse({ choices: [], usage: { prompt_tokens: 200, completion_tokens: 60 } }), 0);
  } else {
    const bashResult =
      messages.find((message) => message.role === 'tool' && message.name === 'bash')?.content ?? '';
    const text = [
      '真机链路跑通了：',
      '1) 问题卡收到了你的选择（' + (plan.answer || '未选') + '）；',
      '2) 审批通过后 bash 在 /workspace 里真实写入了 demo/hello.txt；',
      '3) bash 返回：' + bashResult.replace(/\s+/g, ' ').trim().slice(0, 120),
      '4) 这条回答本身就是流式过来的。',
    ].join('\n');
    for (const chunk of contentChunks(text)) {
      await emit(sse({ choices: [{ delta: { content: chunk } }] }), 30);
    }
    await emit(sse({ choices: [{ finish_reason: 'stop' }] }), 10);
    await emit(sse({ choices: [], usage: { prompt_tokens: 120, completion_tokens: 40 } }), 0);
  }

  res.write('data: [DONE]\n\n');
  res.end();
}

const server = createServer((req, res) => {
  const url = req.url ?? '/';
  if (req.method === 'GET' && url.startsWith('/health')) {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.method === 'POST' && url.includes('/images/generations')) {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => {
      console.log(`[mock] image ${url} body=${body.replace(/\s+/g, ' ').slice(0, 160)}`);
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ data: [{ b64_json: TINY_PNG, revised_prompt: 'a tiny pixel' }] }));
    });
    return;
  }
  if (!url.includes('/chat/completions')) {
    res.statusCode = 404;
    res.end(JSON.stringify({ error: { message: 'not found: ' + url } }));
    return;
  }

  let body = '';
  req.on('data', (chunk: Buffer) => {
    body += chunk.toString('utf8');
  });
  req.on('end', () => {
    let payload: { messages?: ChatMessage[]; model?: string } = {};
    try {
      payload = JSON.parse(body) as typeof payload;
    } catch {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: { message: 'bad json' } }));
      return;
    }
    const messages = payload.messages ?? [];
    const plan = planFor(messages);
    console.log(
      `[mock] ${new Date().toISOString()} model=${payload.model} messages=${messages.length} ` +
        `roles=${messages.map((message) => message.role).join(',')} -> ${plan.kind}`,
    );
    void writePlan(res, plan, messages).catch((error: unknown) => {
      console.error('[mock] write failed', error);
      res.destroy();
    });
  });
});

server.listen(PORT, '0.0.0.0', () => {
  const addresses: string[] = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) addresses.push(net.address);
    }
  }
  console.log(`[mock] listening on :${PORT}`);
  console.log(`[mock] 手机里填 Base URL：http://<PC-IP>:${PORT}/v1，或 adb reverse 后用 127.0.0.1`);
  for (const address of addresses) console.log(`[mock]   http://${address}:${PORT}/v1`);
});
