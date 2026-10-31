/**
 * 真引擎桥：对外说「我们的协议」，对内调真 dsh 的 HTTP/WS。
 *
 * 这一层就是 docs/02-architecture.md 里的"桥接层"——
 * UI 永远只连这里，dsh 换版本时改的是桥，不是界面。
 */
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';

import type {
  Capabilities,
  Method,
  Preset,
  ProtocolError,
  RequestParams,
  SessionDetail,
  SessionSummary,
} from '../../../app/src/protocol';
import { PROTOCOL_VERSION } from '../../../app/src/protocol';
import { DshRealClient, type RealSessionListItem } from './dshClient';
import { projectRecords, type RealRecord } from './project';

export interface RealBridgeOptions {
  /** 真 dsh 的根地址，例如 http://127.0.0.1:8899 */
  baseUrl: string;
  /** 启动时打印的那个 token */
  token: string;
  port?: number;
  /** 手机配对码；传空字符串表示关闭鉴权（只在本机调试时用） */
  pairCode?: string;
}

const HOST_ID = 'host-real-dsh';

let seq = 0;
const clients = new Set<WebSocket>();

function broadcast<K extends string>(event: K, data: unknown): void {
  seq += 1;
  const msg = { type: 'event', v: PROTOCOL_VERSION, event, seq, data };
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }
}

function presetFromId(id: string, isDefault?: boolean): Preset {
  const known: Record<string, { name: string; glyph: string; tagline: string }> = {
    standard: { name: '标准', glyph: '标', tagline: '宿主预设 · standard' },
    minimal: { name: '精简', glyph: '简', tagline: '宿主预设 · minimal' },
    ptc: { name: 'PTC', glyph: 'P', tagline: '宿主预设 · ptc' },
    cordis: { name: 'Cordis', glyph: 'C', tagline: '宿主预设 · cordis' },
  };
  const meta = known[id] ?? { name: id, glyph: id.slice(0, 1).toUpperCase(), tagline: '宿主预设' };
  return {
    id,
    name: meta.name,
    glyph: meta.glyph,
    tagline: isDefault ? `${meta.tagline}（默认）` : meta.tagline,
    version: 'host',
    builtin: true,
    // 真宿主的工具面我们不知道，也没有工具白名单的概念 —— 如实留空，别假装知道
    contract: { tools: [], net: 'allow' },
    modelPolicy: {},
  };
}

function basename(p: string | undefined): string {
  if (!p) return '';
  const parts = p.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? '';
}

function toSummary(item: RealSessionListItem): SessionSummary {
  const v = item.projections?.values;
  const title = v?.title?.trim();
  const stats = v?.sessionStats;
  const bits: string[] = [];
  if (stats?.turns) bits.push(`${stats.turns} 轮`);
  if (stats?.steps) bits.push(`${stats.steps} 步`);
  const preview = bits.length > 0 ? bits.join(' · ') : basename(v?.workingDirectory ?? item.cwd);
  return {
    id: item.sessionId,
    title: title && title.length > 0 ? title : '(未命名会话)',
    presetId: v?.agentPreset ?? 'standard',
    workspaceId: basename(v?.workingDirectory ?? item.cwd) || 'workspace',
    hostId: HOST_ID,
    status: item.running ? 'running' : 'idle',
    updatedAt: item.updatedAt,
    unread: 0,
    preview,
  };
}

export interface RealBridge {
  port: number;
  close(): Promise<void>;
}

export async function startRealBridge(options: RealBridgeOptions): Promise<RealBridge> {
  const client = new DshRealClient(options.baseUrl, options.token);
  await client.login();

  const [presetList, sessionList] = await Promise.all([
    client.listAgentPresets().catch(() => ({ presets: [] as Array<{ id: string; isDefault?: boolean }> })),
    client.listSessions().catch(() => ({ items: [] as RealSessionListItem[] })),
  ]);

  console.log(
    `  已连上真 dsh：${sessionList.items.length} 个会话，${presetList.presets.length} 个宿主预设`,
  );

  const presets = presetList.presets.map((p) => presetFromId(p.id, p.isDefault));

  function capabilities(): Capabilities {
    return {
      protocol: PROTOCOL_VERSION,
      host: {
        id: HOST_ID,
        kind: 'desktop',
        name: '真 dsh（桌面）',
        platform: 'dsh-web',
        engineVersion: '0.2.1-rc.5',
      },
      events: ['engine.status', 'session.created', 'session.updated'],
      actions: ['create_session'],
      presets,
      workspaces: [],
      limits: { maxAttachmentMB: 20, maxFetchFileMB: 50 },
    };
  }

  type Handler<M extends Method> = (params: RequestParams[M]) => Promise<unknown>;
  const unsupported = (name: string): never => {
    throw Object.assign(new Error(`${name} 在真引擎桥上还没实现`), {
      code: 'unsupported' satisfies ProtocolError['code'],
    });
  };

  const handlers: { [M in Method]: Handler<M> } = {
    'capabilities.get': async () => capabilities(),

    'sessions.list': async () => {
      const { items } = await client.listSessions();
      const sessions = items
        .map(toSummary)
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return { sessions };
    },

    'sessions.get': async ({ sessionId }) => {
      const { items } = await client.listSessions();
      const item = items.find((s) => s.sessionId === sessionId);
      if (!item) throw Object.assign(new Error('会话不存在'), { code: 'not_found' satisfies ProtocolError['code'] });

      const snap = await client.snapshot(sessionId);
      const records = (snap?.records ?? []) as RealRecord[];
      const proj = projectRecords(records);

      const detail: SessionDetail = {
        ...toSummary(item),
        turns: proj.turns,
        contract: { tools: [], net: 'allow' },
      };
      if (snap?.header?.agentPreset) detail.presetId = snap.header.agentPreset;
      if (proj.title) detail.title = proj.title;
      return { session: detail };
    },

    'sessions.create': async () => unsupported('sessions.create'),
    'sessions.send': async () => unsupported('sessions.send'),
    'sessions.steer': async () => unsupported('sessions.steer'),
    'sessions.stop': async () => unsupported('sessions.stop'),
    'sessions.setPreset': async () => unsupported('sessions.setPreset'),
    'approvals.list': async () => ({ approvals: [] }),
    'approvals.resolve': async () => unsupported('approvals.resolve'),
    'presets.list': async () => ({ presets }),

    'credentials.describe': async ({ refs }) => {
      const raw = await client.rpc<Record<string, { configured?: boolean; writable?: boolean }>>(
        'credentials/describe',
        { refs },
      );
      return {
        credentials: Object.fromEntries(
          Object.entries(raw).map(([k, v]) => [k, { configured: v.configured === true, writable: v.writable !== false }]),
        ),
      };
    },

    'credentials.set': async ({ ref, value }) => {
      // 真引擎拒绝空值（schema 要求 value 至少 1 个字符），清除走 unset
      if (value.trim().length === 0) {
        await client.rpc('credentials/unset', { ref });
        return { ok: true as const };
      }
      await client.rpc('credentials/set', { ref, value });
      return { ok: true as const };
    },

    'credentials.unset': async ({ ref }) => {
      await client.rpc('credentials/unset', { ref });
      return { ok: true as const };
    },
    'workspaces.list': async () => ({ workspaces: [] }),
  };

  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, bridge: 'real', host: HOST_ID }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<h1>dsh-palm real bridge</h1><p>WS: <code>ws://&lt;host&gt;:${options.port ?? 0}/ws</code></p>`);
  });

  const wss = new WebSocketServer({ server: http, path: '/ws' });

  wss.on('connection', (ws, req) => {
    // 配对：/ws?pair=123456
    // MVP 只认配对码；正式版要改成「一次配对换设备密钥，之后每设备一把」
    const url = new URL(req.url ?? '/ws', 'http://localhost');
    const expected = options.pairCode ?? '';
    if (expected.length > 0) {
      const pair = url.searchParams.get('pair') ?? '';
      if (pair !== expected) {
        ws.close(4001, '需要配对码');
        return;
      }
    }

    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    broadcast('engine.status', { state: 'ready' });

    ws.on('message', (raw) => {
      let msg: { type?: string; id?: string; method?: string; params?: unknown };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type !== 'req' || !msg.id) return;
      const id = msg.id;
      const method = msg.method as Method;
      const send = (payload: unknown): void => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
      };

      if (!(method in handlers)) {
        send({
          type: 'res', v: PROTOCOL_VERSION, id, ok: false,
          error: { code: 'unsupported', message: `不支持的方法：${String(method)}` } satisfies ProtocolError,
        });
        return;
      }

      const handler = handlers[method] as (p: unknown) => Promise<unknown>;
      handler(msg.params ?? {})
        .then((result) => send({ type: 'res', v: PROTOCOL_VERSION, id, ok: true, result }))
        .catch((err: { code?: ProtocolError['code']; message?: string }) =>
          send({
            type: 'res', v: PROTOCOL_VERSION, id, ok: false,
            error: { code: err.code ?? 'internal', message: err.message ?? '内部错误' } satisfies ProtocolError,
          }),
        );
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(options.port ?? 8788, '0.0.0.0', () => resolve());
  });

  const addr = http.address();
  const port = typeof addr === 'object' && addr ? addr.port : (options.port ?? 8788);

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of clients) ws.close();
        wss.close();
        http.close(() => resolve());
      }),
  };
}
