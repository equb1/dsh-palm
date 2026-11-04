import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { after, describe, it } from 'node:test';

import { completionsUrl, streamChat } from '../app/src/engine/light/provider';
import type { LightModelConfig } from '../app/src/engine/light/types';
import { LightRequestError, humanizeError } from '../app/src/lib/errors';

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

const servers: Array<{ close(): Promise<void> }> = [];

after(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

async function startServer(handler: Handler): Promise<string> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString('utf8');
    });
    req.on('end', () => handler(req, res, body));
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
  return `http://127.0.0.1:${address.port}/v1`;
}

/** 把一段 SSE 按任意位置切开写，验证我们自己的行缓冲 */
function writeChunked(res: ServerResponse, chunks: string[]): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.flushHeaders?.();
  for (const chunk of chunks) res.write(chunk);
  res.end();
}

function sse(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

const MODEL: LightModelConfig = {
  baseURL: '',
  apiKey: 'test-key',
  model: 'fake-model',
  providerName: 'Fake',
};

describe('provider · OpenAI 兼容 SSE', () => {
  it('解析文本 / 思考 / 工具调用分片 / usage，并切在任意字节边界', async () => {
    let receivedBody = '';
    let receivedAuth = '';
    const baseURL = await startServer((req, res, body) => {
      receivedBody = body;
      receivedAuth = String(req.headers.authorization ?? '');
      const frames = [
        sse({ choices: [{ delta: { reasoning_content: '先想' } }] }),
        sse({ choices: [{ delta: { content: '你' } }] }),
        sse({ choices: [{ delta: { content: '好' } }] }),
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{"comm' } },
                ],
              },
            },
          ],
        }),
        sse({
          choices: [
            { delta: { tool_calls: [{ index: 0, function: { arguments: 'and":"ls"}' } }] } },
          ],
        }),
        sse({ choices: [{ finish_reason: 'tool_calls' }] }),
        sse({ choices: [], usage: { prompt_tokens: 12, completion_tokens: 7 } }),
        'data: [DONE]\n\n',
      ].join('');
      // 故意在 JSON 中间切开
      const chunks: string[] = [];
      for (let i = 0; i < frames.length; i += 17) chunks.push(frames.slice(i, i + 17));
      writeChunked(res, chunks);
    });

    const deltas: string[] = [];
    const thinking: string[] = [];
    const result = await streamChat(
      { ...MODEL, baseURL },
      {
        messages: [{ role: 'user', content: 'hi' }],
        tools: [
          {
            name: 'bash',
            description: 'run',
            parameters: { type: 'object', properties: {} },
            execute: async () => '',
          },
        ],
      },
      { onText: (delta) => deltas.push(delta), onThinking: (delta) => thinking.push(delta) },
    );

    assert.equal(receivedAuth, 'Bearer test-key');
    const sent = JSON.parse(receivedBody) as {
      stream: boolean;
      tools: Array<{ function: { name: string } }>;
      stream_options: { include_usage: boolean };
    };
    assert.equal(sent.stream, true);
    assert.equal(sent.stream_options.include_usage, true);
    assert.equal(sent.tools[0]?.function.name, 'bash');

    assert.equal(result.text, '你好');
    assert.equal(result.thinking, '先想');
    assert.deepEqual(deltas, ['你', '好']);
    assert.deepEqual(thinking, ['先想']);
    assert.equal(result.toolCalls.length, 1);
    assert.equal(result.toolCalls[0]?.function.name, 'bash');
    assert.deepEqual(JSON.parse(result.toolCalls[0]?.function.arguments ?? '{}'), { command: 'ls' });
    assert.equal(result.toolCalls[0]?.id, 'call_1');
    assert.equal(result.finishReason, 'tool_calls');
    assert.deepEqual(result.usage, { inputTokens: 12, outputTokens: 7 });
  });

  it('401 / 404 给出人话错误', async () => {
    const base401 = await startServer((_req, res) => {
      res.statusCode = 401;
      res.end(JSON.stringify({ error: { message: 'invalid api key' } }));
    });
    await assert.rejects(
      streamChat({ ...MODEL, baseURL: base401 }, { messages: [{ role: 'user', content: 'x' }] }),
      /API Key 无效/,
    );

    const base404 = await startServer((_req, res) => {
      res.statusCode = 404;
      res.end('not found');
    });
    await assert.rejects(
      streamChat({ ...MODEL, baseURL: base404 }, { messages: [{ role: 'user', content: 'x' }] }),
      /接口或模型不存在/,
    );
  });

  it('空响应要被当成错误，而不是"成功但没内容"', async () => {
    const base = await startServer((_req, res) => {
      writeChunked(res, ['data: [DONE]\n\n']);
    });
    await assert.rejects(
      streamChat({ ...MODEL, baseURL: base }, { messages: [{ role: 'user', content: 'x' }] }),
      /没有返回任何内容/,
    );
  });

  it('空闲超时：没有新分片就报 timeout，而不是一直挂着', async () => {
    const base = await startServer((_req, res) => {
      res.setHeader('Content-Type', 'text/event-stream');
      res.flushHeaders?.();
      // 故意不回任何数据，也不 end
    });
    const started = Date.now();
    await assert.rejects(
      streamChat(
        { ...MODEL, baseURL: base },
        { messages: [{ role: 'user', content: 'x' }], idleTimeoutMs: 120 },
      ),
      (error: unknown) =>
        error instanceof LightRequestError &&
        error.kind === 'timeout' &&
        /没有新响应/.test(error.message),
    );
    assert.ok(Date.now() - started < 3_000, '应当远早于 45s 的默认值');
  });

  it('只有 tool_calls 的流也会触发首包回调（ttft 不能只统计正文）', async () => {
    const base = await startServer((_req, res) => {
      writeChunked(res, [
        sse({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'call_1', type: 'function', function: { name: 'bash', arguments: '{}' } },
                ],
              },
            },
          ],
        }),
        sse({ choices: [{ finish_reason: 'tool_calls' }] }),
        'data: [DONE]\n\n',
      ]);
    });
    let firstToolCall = 0;
    let text = 0;
    const result = await streamChat(
      { ...MODEL, baseURL: base },
      { messages: [{ role: 'user', content: 'x' }] },
      { onToolCallDelta: () => (firstToolCall += 1), onText: () => (text += 1) },
    );
    assert.equal(firstToolCall, 1);
    assert.equal(text, 0);
    assert.equal(result.text, '');
    assert.equal(result.toolCalls.length, 1);
  });

  it('429 / 401 带分类和状态码，humanizeError 能给出中文建议', async () => {
    const base429 = await startServer((_req, res) => {
      res.statusCode = 429;
      res.end(JSON.stringify({ error: { message: 'rate limited' } }));
    });
    await assert.rejects(
      streamChat({ ...MODEL, baseURL: base429 }, { messages: [{ role: 'user', content: 'x' }] }),
      (error: unknown) =>
        error instanceof LightRequestError &&
        error.kind === 'rate_limited' &&
        error.status === 429 &&
        /额度不足|太频繁/.test(humanizeError(error)),
    );

    // 已经是中文的错误原样透传，不再按英文关键字二次翻译
    assert.equal(humanizeError(new Error('请求太频繁（429），稍后再试')), '请求太频繁（429），稍后再试');
    assert.equal(
      humanizeError(new LightRequestError('timeout', '模型服务 45 秒没有新响应')),
      '模型服务 45 秒没有新响应',
    );
  });

  it('URL 拼接：带不带 /chat/completions 都对', () => {
    assert.equal(completionsUrl('https://api.deepseek.com/v1'), 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(completionsUrl('https://api.deepseek.com/v1/'), 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(
      completionsUrl('https://api.example.com/chat/completions'),
      'https://api.example.com/chat/completions',
    );
  });
});
