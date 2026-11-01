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
  Block,
  Preset,
  ProtocolError,
  RequestParams,
  SessionDetail,
  SessionSummary,
  Turn,
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

  /* ---------------- 实时流：把 assistant-stream 帧翻成我们的事件 ---------------- */

  let followDispose: (() => void) | null = null;
  let followSessionId: string | null = null;
  let liveTurn: Turn | null = null;
  let liveRunId = '';
  const blockIdByIndex = new Map<number, string>();

  function startFollow(sessionId: string): void {
    if (followSessionId === sessionId) return;
    followDispose?.();
    followDispose = null;
    followSessionId = sessionId;
    liveTurn = null;
    blockIdByIndex.clear();

    followDispose = client.follow(sessionId, (value) => {
      try {
        handleFollowValue(sessionId, value);
      } catch {
        /* 单帧出错不影响整条流 */
      }
    });
  }

  function handleFollowValue(sessionId: string, value: Record<string, unknown>): void {
    // 真引擎的事件（turn/end 之类）
    if (value.type === 'event') {
      const ev = (value as { event?: { type?: string; data?: Record<string, unknown> } }).event;
      if (ev?.type === 'turn/end' && liveTurn) {
        liveTurn.status = 'done';
        liveTurn.meta = { steps: liveTurn.blocks.length };
        broadcast('block.appended', { sessionId, runId: liveRunId, turn: liveTurn });
        broadcast('run.finished', { sessionId, runId: liveRunId, reason: 'done', usage: liveTurn.usage });
        liveTurn = null;
      }
      return;
    }

    if (value.type !== 'assistant-stream') return;
    const frame = (value as { frame?: Record<string, any> }).frame;
    if (!frame) return;

    if (frame.type === 'start') {
      liveRunId = String(frame.attemptId ?? crypto.randomUUID());
      liveTurn = {
        id: 'turn-' + liveRunId,
        role: 'assistant',
        createdAt: Date.now(),
        blocks: [],
        status: 'streaming',
      };
      blockIdByIndex.clear();
      broadcast('run.started', { sessionId, runId: liveRunId, turnId: liveTurn.id });
      broadcast('block.appended', { sessionId, runId: liveRunId, turn: liveTurn });
      return;
    }

    if (frame.type !== 'chunk' || !liveTurn) return;
    const chunk = (frame.chunk ?? {}) as Record<string, any>;
    const index = typeof chunk.index === 'number' ? chunk.index : 0;

    if (chunk.type === 'block-start') {
      const kind = chunk.blockType === 'reasoning' ? 'thinking' : 'text';
      const id = liveRunId + '-b' + index;
      blockIdByIndex.set(index, id);
      liveTurn.blocks.push({ kind, id, text: '' } as Block);
      broadcast('block.appended', { sessionId, runId: liveRunId, turn: liveTurn });
      return;
    }

    if (chunk.type === 'reasoning-delta' || chunk.type === 'text-delta') {
      const text = typeof chunk.text === 'string' ? chunk.text : '';
      if (!text) return;
      const blockId = blockIdByIndex.get(index);
      if (!blockId) return;
      const block = liveTurn.blocks.find((b) => b.id === blockId);
      if (block && (block.kind === 'text' || block.kind === 'thinking')) block.text += text;
      broadcast('block.delta', {
        sessionId,
        runId: liveRunId,
        turnId: liveTurn.id,
        blockId,
        op: 'append',
        text,
      });
      return;
    }

    if (chunk.type === 'block-end' && chunk.block) {
      const blockId = blockIdByIndex.get(index);
      const block = liveTurn.blocks.find((b) => b.id === blockId);
      if (block && (block.kind === 'text' || block.kind === 'thinking')) {
        const finalText = typeof chunk.block.text === 'string' ? chunk.block.text : '';
        if (finalText) block.text = finalText;
        broadcast('block.updated', { sessionId, runId: liveRunId, turnId: liveTurn.id, block });
      }
    }
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

      // 打开（或切换）这个会话的实时流，之后的新回合会以事件形式推给客户端
      startFollow(sessionId);
      return { session: detail };
    },

    // 真引擎建会话：先拿默认工作区，再提交一个客户端生成的 sessionId
    'sessions.create': async ({ presetId, title }) => {
      const ws = await client.rpc<{ workspace: { workspaceId: string; title?: string } }>(
        'workspace/initializeDefault',
        {},
      );
      const sessionId = 'session-' + crypto.randomUUID();
      await client.rpc('session/create', {
        request: { workspaceId: ws.workspace.workspaceId, sessionId, agentPreset: presetId },
      });
      const session: SessionSummary = {
        id: sessionId,
        title: title ?? '新会话',
        presetId,
        workspaceId: ws.workspace.title ?? ws.workspace.workspaceId,
        hostId: HOST_ID,
        status: 'idle',
        updatedAt: Date.now(),
        unread: 0,
        preview: '',
      };
      broadcast('session.created', { session });
      return { session };
    },

    // 真引擎的发消息：session/prompt。mode=queue 排队，steer 立刻插入当前回合。
    'sessions.send': async ({ sessionId, text }) => {
      await client.rpc('session/prompt', {
        request: {
          requestId: crypto.randomUUID(),
          sessionId,
          mode: 'queue',
          content: [{ type: 'text', text }],
        },
      });
      return { accepted: true as const, runId: crypto.randomUUID() };
    },

    'sessions.steer': async ({ sessionId, text }) => {
      await client.rpc('session/prompt', {
        request: {
          requestId: crypto.randomUUID(),
          sessionId,
          mode: 'steer',
          content: [{ type: 'text', text }],
        },
      });
      return { accepted: true as const };
    },
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
        followDispose?.();
        followDispose = null;
        for (const ws of clients) ws.close();
        wss.close();
        http.close(() => resolve());
      }),
  };
}
