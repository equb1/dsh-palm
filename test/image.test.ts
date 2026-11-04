/**
 * 生图渠道加固（P0 1.5）：b64_json / url 两种返回的边界。
 *
 * 用本地 HTTP server 模拟渠道，不依赖真实生图 API。
 */
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { after, describe, it } from 'node:test';

import { base64ToBytes, bytesToBase64 } from '../app/src/engine/fs/encoding';
import { extensionForImageMime, generateImage, pngSize } from '../app/src/engine/light/image';
import { LightRequestError } from '../app/src/lib/errors';
import type { LightImageConfig } from '../app/src/engine/light/types';

const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const servers: Array<{ close(): Promise<void> }> = [];

interface ServerInfo {
  /** 例如 http://127.0.0.1:1234 */
  origin: string;
  /** 例如 http://127.0.0.1:1234/v1 */
  baseURL: string;
}

type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void;

async function startServer(handler: Handler): Promise<ServerInfo> {
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
  const origin = `http://127.0.0.1:${address.port}`;
  return { origin, baseURL: `${origin}/v1` };
}

after(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

function json(res: ServerResponse, payload: unknown, status = 200): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function imageOk(res: ServerResponse): void {
  const bytes = Buffer.from(TINY_PNG, 'base64');
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Content-Length', String(bytes.byteLength));
  res.end(bytes);
}

function config(baseURL: string): LightImageConfig {
  return { baseURL, apiKey: 'test-image-key', model: 'fake-image', size: '512x512' };
}

async function expectError(promise: Promise<unknown>): Promise<LightRequestError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof LightRequestError, `期望 LightRequestError，实际是 ${String(error)}`);
    return error;
  }
  throw new Error('期望抛错，但调用成功了');
}

describe('生图 · b64_json', () => {
  it('接受 data: 前缀和 URL-safe base64，默认不传 response_format', async () => {
    const bodies: string[] = [];
    const rawBytes = new Uint8Array([...base64ToBytes(TINY_PNG), 0xfb, 0xff, 0xbf]);
    const urlSafe = bytesToBase64(rawBytes).replace(/\+/g, '-').replace(/\//g, '_');
    assert.ok(/[-_]/.test(urlSafe), '构造的样例应当包含 URL-safe 字符');
    const server = await startServer((_req, res, body) => {
      bodies.push(body);
      json(res, {
        data: [{ b64_json: `data:image/png;base64,${urlSafe}`, revised_prompt: '一只猫（改写）' }],
      });
    });

    const image = await generateImage(config(server.baseURL), '一只猫');
    assert.equal(image.mime, 'image/png');
    assert.equal(image.revisedPrompt, '一只猫（改写）');
    assert.deepEqual(pngSize(image.bytes), { width: 1, height: 1 });
    assert.equal(image.bytes.length, rawBytes.length);

    const sent = JSON.parse(bodies[0] ?? '{}') as Record<string, unknown>;
    assert.equal(sent.prompt, '一只猫');
    assert.equal(sent.size, '512x512');
    assert.equal('response_format' in sent, false, 'auto 不应发送 response_format');
  });

  it('显式 responseFormat=b64_json 时发送字段', async () => {
    let received = '';
    const server = await startServer((_req, res, body) => {
      received = body;
      json(res, { data: [{ b64_json: TINY_PNG }] });
    });
    await generateImage({ ...config(server.baseURL), responseFormat: 'b64_json' }, '猫');
    assert.equal((JSON.parse(received) as { response_format?: string }).response_format, 'b64_json');
  });

  it('400 且提到 response_format：去掉字段重试一次', async () => {
    const bodies: string[] = [];
    const server = await startServer((_req, res, body) => {
      bodies.push(body);
      if (bodies.length === 1) {
        json(res, { error: { message: 'response_format is not supported' } }, 400);
        return;
      }
      json(res, { data: [{ b64_json: TINY_PNG }] });
    });

    const image = await generateImage(
      { ...config(server.baseURL), responseFormat: 'b64_json' },
      '猫',
    );
    assert.equal(image.mime, 'image/png');
    assert.equal(bodies.length, 2);
    const first = JSON.parse(bodies[0] ?? '{}') as Record<string, unknown>;
    const second = JSON.parse(bodies[1] ?? '{}') as Record<string, unknown>;
    assert.equal(first.response_format, 'b64_json');
    assert.equal('response_format' in second, false);
  });

  it('损坏的 base64 给中文错误', async () => {
    const server = await startServer((_req, res) => {
      json(res, { data: [{ b64_json: '!!!not-base64!!!' }] });
    });
    const error = await expectError(generateImage(config(server.baseURL), '猫'));
    assert.equal(error.kind, 'bad_request');
    assert.match(error.message, /base64 数据损坏/);
  });

  it('解码超过 20MB 上限时给中文错误', async () => {
    const server = await startServer((_req, res) => {
      // 28M 个 base64 字符约解码成 21MB，超过 20MB 上限；不会真的解码
      json(res, { data: [{ b64_json: 'A'.repeat(28_000_000) }] });
    });
    const error = await expectError(generateImage(config(server.baseURL), '猫'));
    assert.match(error.message, /20MB 上限/);
  });
});

describe('生图 · url', () => {
  it('相对 URL 下载，同源请求带 Key，按真实 MIME 落盘', async () => {
    let downloadAuth = '';
    const server = await startServer((req, res) => {
      if (req.method === 'POST') {
        json(res, { data: [{ url: '/mock/image.png', revised_prompt: '相对地址' }] });
        return;
      }
      downloadAuth = String(req.headers.authorization ?? '');
      imageOk(res);
    });

    const image = await generateImage(config(server.baseURL), '猫');
    assert.equal(image.mime, 'image/png');
    assert.equal(image.bytes.length, Buffer.from(TINY_PNG, 'base64').byteLength);
    assert.equal(downloadAuth, 'Bearer test-image-key');
    assert.equal(extensionForImageMime(image.mime), 'png');
  });

  it('跨域下载绝不转发 API Key', async () => {
    const cdnAuths: string[] = [];
    const cdn = await startServer((req, res) => {
      cdnAuths.push(String(req.headers.authorization ?? ''));
      imageOk(res);
    });
    // 用另一个端口当“CDN”，和生图渠道不同源
    const api = await startServer((_req, res) => {
      json(res, { data: [{ url: `${cdn.origin}/pic.png` }] });
    });

    const image = await generateImage(config(api.baseURL), '猫');
    assert.equal(image.mime, 'image/png');
    assert.deepEqual(cdnAuths, ['']);
  });

  it('data: URL 直接解码，不发二次请求', async () => {
    let gets = 0;
    const server = await startServer((req, res) => {
      if (req.method === 'GET') {
        gets += 1;
        imageOk(res);
        return;
      }
      json(res, { data: [{ url: `data:image/png;base64,${TINY_PNG}` }] });
    });
    const image = await generateImage(config(server.baseURL), '猫');
    assert.equal(image.mime, 'image/png');
    assert.equal(gets, 0);
  });

  it('content-type 不是 image/* 时拒绝', async () => {
    const server = await startServer((req, res) => {
      if (req.method === 'POST') {
        json(res, { data: [{ url: '/mock/image.png' }] });
        return;
      }
      res.setHeader('Content-Type', 'text/html');
      res.end('<html>not an image</html>');
    });
    const error = await expectError(generateImage(config(server.baseURL), '猫'));
    assert.match(error.message, /不是图片/);
  });

  it('content-type=image/png 但魔数不匹配也要拒绝', async () => {
    const server = await startServer((req, res) => {
      if (req.method === 'POST') {
        json(res, { data: [{ url: '/mock/image.png' }] });
        return;
      }
      res.setHeader('Content-Type', 'image/png');
      res.end('definitely not a png');
    });
    const error = await expectError(generateImage(config(server.baseURL), '猫'));
    assert.match(error.message, /文件头不匹配/);
  });

  it('下载超时给中文错误', async () => {
    const server = await startServer((req, res) => {
      if (req.method === 'POST') {
        json(res, { data: [{ url: '/slow.png' }] });
        return;
      }
      // 一直不响应，交给下载超时
    });
    const error = await expectError(
      generateImage(config(server.baseURL), '猫', { downloadTimeoutMs: 60 }),
    );
    assert.equal(error.kind, 'timeout');
    assert.match(error.message, /秒没有新响应/);
  });
});

describe('生图 · 失败路径', () => {
  it('200 但不是 JSON（HTML 网关）', async () => {
    const server = await startServer((_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end('<html>gateway</html>');
    });
    const error = await expectError(generateImage(config(server.baseURL), '猫'));
    assert.match(error.message, /不是 JSON/);
  });

  it('401 / 429 / 404 分别给中文建议', async () => {
    const unauthorized = await startServer((_req, res) => {
      json(res, { error: { message: 'invalid api key' } }, 401);
    });
    const error401 = await expectError(generateImage(config(unauthorized.baseURL), '猫'));
    assert.equal(error401.kind, 'unauthorized');
    assert.match(error401.message, /Key 无效/);

    const limited = await startServer((_req, res) => {
      json(res, { error: { message: 'rate limited' } }, 429);
    });
    const error429 = await expectError(generateImage(config(limited.baseURL), '猫'));
    assert.equal(error429.kind, 'rate_limited');
    assert.match(error429.message, /额度不足|太频繁/);

    const missing = await startServer((_req, res) => {
      json(res, { error: { message: 'not found' } }, 404);
    });
    const error404 = await expectError(generateImage(config(missing.baseURL), '猫'));
    assert.equal(error404.kind, 'not_found');
    assert.match(error404.message, /接口不存在/);
  });

  it('连不上渠道（离线/端口不通）给中文错误', async () => {
    const error = await expectError(
      generateImage(
        { baseURL: 'http://127.0.0.1:9/v1', apiKey: 'k', model: 'fake' },
        '猫',
        { requestTimeoutMs: 2_000 },
      ),
    );
    assert.equal(error.kind, 'offline');
    assert.match(error.message, /连不上生图服务|连不上网络/);
  });

  it('扩展名按 MIME 推导', () => {
    assert.equal(extensionForImageMime('image/jpeg'), 'jpg');
    assert.equal(extensionForImageMime('image/webp'), 'webp');
    assert.equal(extensionForImageMime('image/gif'), 'gif');
    assert.equal(extensionForImageMime('image/png; charset=binary'), 'png');
    assert.equal(extensionForImageMime(undefined), 'png');
  });
});
