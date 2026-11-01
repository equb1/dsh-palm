import { createServer, type Server } from 'node:http';
import { networkInterfaces } from 'node:os';
import { WebSocketServer, WebSocket } from 'ws';

import type {
  Approval,
  ApprovalDecision,
  Block,
  CapabilityContract,
  Capabilities,
  EventPayloads,
  Method,
  ProtocolError,
  RequestParams,
  SessionDetail,
  SessionSummary,
  Turn,
} from '../../app/src/protocol';
import { PROTOCOL_VERSION } from '../../app/src/protocol';
import { PRESETS, SCRIPTS, WORKSPACES, presetById } from './presets';

/* ------------------------------------------------------------------ *
 * 内存状态
 * ------------------------------------------------------------------ */

interface SessionState {
  summary: SessionSummary;
  turns: Turn[];
  contract: CapabilityContract;
}

const HOST_ID = 'host-mock-phone';
const sessions = new Map<string, SessionState>();
const pendingApprovals = new Map<
  string,
  { approval: Approval; decide: (d: ApprovalDecision) => void }
>();
const cancelledRuns = new Set<string>();
/** mock 的凭据库：只活在内存里，重启即清空 */
const mockCredentials = new Map<string, string>();

/** 每个会话当前在跑的 run，用于 stop */
const activeRuns = new Map<string, string>();

let seq = 0;
let idCounter = 0;

function newId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}${idCounter.toString(36)}`;
}

/* ------------------------------------------------------------------ *
 * 预置数据（让第一次打开不是空屏）
 * ------------------------------------------------------------------ */

function seedSessions(): void {
  const now = Date.now();
  const seed = [
    {
      id: 's_welcome',
      presetId: 'doc',
      title: '合同金额核对',
      preview: '金额核对表在 金额核对.xlsx，差异在第 3 行',
      turns: [
        {
          id: 't_w1', role: 'user' as const, createdAt: now - 3_600_000, status: 'done' as const,
          blocks: [{ kind: 'text' as const, id: 'b_w1', text: '这份合同的金额帮我对一下' }],
        },
        {
          id: 't_w2', role: 'assistant' as const, createdAt: now - 3_580_000, status: 'done' as const,
          meta: { durationMs: 42_000, steps: 4 },
          usage: { inputTokens: 1204, outputTokens: 388 },
          blocks: [
            { kind: 'thinking' as const, id: 'b_w2', text: '先读合同，再读附件里的报价表，逐行比对。' },
            { kind: 'text' as const, id: 'b_w3', text: '对完了，有一处不一致：报价单 ¥128,000，正文写 ¥126,000。\n\n其余 11 项一致。' },
          ],
        },
      ],
    },
    {
      id: 's_week',
      presetId: 'receipt',
      title: '本周票据整理',
      preview: '已记 27 笔，合计 ¥31,204',
      turns: [
        {
          id: 't_e1', role: 'user' as const, createdAt: now - 86_400_000, status: 'done' as const,
          blocks: [{ kind: 'text' as const, id: 'b_e1', text: '把这周的发票都记一下' }],
        },
        {
          id: 't_e2', role: 'assistant' as const, createdAt: now - 86_390_000, status: 'done' as const,
          meta: { durationMs: 65_000, steps: 9 },
          blocks: [{ kind: 'text' as const, id: 'b_e2', text: '记好了，共 5 张，合计 ¥1,286.00，已追加到 2026-10 台账。' }],
        },
      ],
    },
  ];

  for (const s of seed) {
    const last = s.turns[s.turns.length - 1];
    sessions.set(s.id, {
      summary: {
        id: s.id,
        title: s.title,
        presetId: s.presetId,
        workspaceId: 'ws-docs',
        hostId: HOST_ID,
        status: 'idle',
        updatedAt: last?.createdAt ?? now,
        unread: 0,
        preview: s.preview,
      },
      turns: s.turns as Turn[],
      contract: presetById(s.presetId).contract,
    });
  }
}

seedSessions();

/* ------------------------------------------------------------------ *
 * 工具
 * ------------------------------------------------------------------ */

/** 测试时用 DSH_MOCK_SPEED 把整段脚本加速，默认 1 倍速 */
function speed(): number {
  const v = Number(process.env.DSH_MOCK_SPEED);
  return Number.isFinite(v) && v > 0 ? v : 1;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, Math.max(1, ms * speed())));

const clients = new Set<WebSocket>();

function send(ws: WebSocket, payload: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
}

function broadcast<K extends keyof EventPayloads>(event: K, data: EventPayloads[K]): void {
  seq += 1;
  const msg = { type: 'event', v: PROTOCOL_VERSION, event, seq, data };
  for (const ws of clients) send(ws, msg);
}

/* ------------------------------------------------------------------ *
 * 能力
 * ------------------------------------------------------------------ */

function capabilities(): Capabilities {
  return {
    protocol: PROTOCOL_VERSION,
    host: {
      id: HOST_ID,
      kind: 'phone',
      name: 'Mock 手机宿主',
      platform: 'android-mock',
      engineVersion: '0.0.1-mock',
    },
    events: [
      'engine.status',
      'session.created',
      'session.updated',
      'run.started',
      'block.appended',
      'block.delta',
      'block.updated',
      'run.finished',
      'approval.requested',
      'approval.resolved',
      'job.progress',
      'job.done',
    ],
    actions: ['approve', 'reject', 'steer', 'stop', 'switch_preset', 'create_session'],
    presets: PRESETS,
    workspaces: WORKSPACES,
    limits: { maxAttachmentMB: 20, maxFetchFileMB: 50 },
  };
}

/* ------------------------------------------------------------------ *
 * 运行一轮
 * ------------------------------------------------------------------ */

function upsertTurn(session: SessionState, turn: Turn): void {
  const i = session.turns.findIndex((t) => t.id === turn.id);
  if (i >= 0) session.turns[i] = turn;
  else session.turns.push(turn);
}

function touch(session: SessionState, patch: Partial<SessionSummary>): void {
  session.summary = { ...session.summary, ...patch, updatedAt: Date.now() };
  broadcast('session.updated', { session: session.summary });
}

function chunkText(text: string, size: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length; i += size) out.push(text.slice(i, i + size));
  return out;
}

function waitApproval(approval: Approval): Promise<ApprovalDecision> {
  return new Promise((resolve) => {
    pendingApprovals.set(approval.id, { approval, decide: resolve });
  });
}

async function runScript(session: SessionState, userText: string, runId: string): Promise<void> {
  const sessionId = session.summary.id;
  const turnId = newId('turn');
  const script = SCRIPTS[session.summary.presetId] ?? SCRIPTS.doc ?? [];

  const turn: Turn = {
    id: turnId,
    role: 'assistant',
    createdAt: Date.now(),
    blocks: [],
    status: 'streaming',
  };

  activeRuns.set(sessionId, runId);
  touch(session, { status: 'running', runningSince: Date.now(), preview: userText.slice(0, 40) });
  broadcast('run.started', { sessionId, runId, turnId });
  upsertTurn(session, turn);
  broadcast('block.appended', { sessionId, runId, turn: structuredClone(turn) });

  const cancelled = () => cancelledRuns.has(runId);

  try {
    for (const step of script) {
      if (cancelled()) break;

      if (step.kind === 'wait') {
        await sleep(step.ms ?? 100);
        continue;
      }

      if (step.kind === 'thinking' || step.kind === 'text') {
        const block: Extract<Block, { kind: 'thinking' | 'text' }> =
          step.kind === 'thinking'
            ? { kind: 'thinking', id: newId('b'), text: '' }
            : { kind: 'text', id: newId('b'), text: '' };
        turn.blocks.push(block);
        broadcast('block.appended', { sessionId, runId, turn: structuredClone(turn) });

        const size = step.kind === 'thinking' ? 2 : 4;
        for (const piece of chunkText(step.text ?? '', size)) {
          if (cancelled()) break;
          await sleep(step.kind === 'thinking' ? 8 : 10);
          block.text += piece;
          broadcast('block.delta', { sessionId, runId, turnId, blockId: block.id, op: 'append', text: piece });
        }
        await sleep(step.ms ?? 200);
        continue;
      }

      if (step.kind === 'tool' && step.tool) {
        const block: Extract<Block, { kind: 'tool' }> = {
          kind: 'tool',
          id: newId('b'),
          name: step.tool.name,
          summary: step.tool.summary,
          state: 'running',
          detail: step.tool.detail,
        };
        turn.blocks.push(block);
        broadcast('block.appended', { sessionId, runId, turn: structuredClone(turn) });
        await sleep(step.ms ?? 400);
        block.state = 'done';
        broadcast('block.updated', { sessionId, runId, turnId, block: structuredClone(block) });
        continue;
      }

      if (step.kind === 'approval' && step.approval) {
        const approval: Approval = {
          id: newId('ap'),
          sessionId,
          runId,
          createdAt: Date.now(),
          title: step.approval.title,
          command: step.approval.command,
          risk: step.approval.risk,
          summary: step.approval.summary,
          diff: step.approval.diff,
          actions: ['approve', 'reject'],
        };

        turn.blocks.push({ kind: 'approval', id: newId('b'), approvalId: approval.id });
        broadcast('block.appended', { sessionId, runId, turn: structuredClone(turn) });

        touch(session, { status: 'waiting_approval' });

        // 先注册 waiter，再广播。
        // 反过来写会有竞态：客户端可能在 await 之前就把 decision 发回来，
        // 这时 pendingApprovals 里还没有这条，会被当成「审批不存在」。
        const decisionPromise = waitApproval(approval);
        broadcast('approval.requested', { approval });

        const decision = await decisionPromise;
        pendingApprovals.delete(approval.id);
        broadcast('approval.resolved', { approvalId: approval.id, decision, by: 'user' });

        if (decision === 'reject') {
          turn.status = 'stopped';
          turn.blocks.push({ kind: 'text', id: newId('b'), text: '好，这次不写入了。原文件没有改动。' });
          broadcast('block.appended', { sessionId, runId, turn: structuredClone(turn) });
          finishRun(session, runId, turn, 'stopped');
          return;
        }

        touch(session, { status: 'running' });
        continue;
      }
    }

    turn.status = cancelled() ? 'stopped' : 'done';
    turn.meta = { durationMs: Date.now() - turn.createdAt, steps: turn.blocks.length };
    turn.usage = {
      inputTokens: 1200 + turn.blocks.length * 37,
      outputTokens: 320 + turn.blocks.length * 19,
    };
    finishRun(session, runId, turn, turn.status === 'stopped' ? 'stopped' : 'done');
  } catch (err) {
    turn.status = 'error';
    turn.blocks.push({ kind: 'text', id: newId('b'), text: `出错了：${String(err)}` });
    finishRun(session, runId, turn, 'error');
  }
}

function finishRun(
  session: SessionState,
  runId: string,
  turn: Turn,
  reason: 'done' | 'stopped' | 'error',
): void {
  const sessionId = session.summary.id;
  upsertTurn(session, turn);

  // 把最终状态（status / 用时 / token）回传，否则客户端永远停在 streaming，光标不会消失
  broadcast('block.appended', { sessionId, runId, turn: structuredClone(turn) });

  const lastText = [...turn.blocks].reverse().find((b) => b.kind === 'text');
  touch(session, {
    status: reason === 'error' ? 'error' : 'idle',
    runningSince: undefined,
    preview: lastText && lastText.kind === 'text' ? lastText.text.slice(0, 40) : session.summary.preview,
  });
  broadcast('run.finished', { sessionId, runId, reason, usage: turn.usage });

  cancelledRuns.delete(runId);
  if (activeRuns.get(sessionId) === runId) activeRuns.delete(sessionId);
}

/* ------------------------------------------------------------------ *
 * 请求处理
 * ------------------------------------------------------------------ */

type Handler<M extends Method> = (params: RequestParams[M]) => unknown;

function requireSession(id: string): SessionState {
  const s = sessions.get(id);
  if (!s) throw Object.assign(new Error('会话不存在'), { code: 'not_found' satisfies ProtocolError['code'] });
  return s;
}

const handlers: { [M in Method]: Handler<M> } = {
  'capabilities.get': () => capabilities(),

  'sessions.list': ({ limit }) => {
    const list = [...sessions.values()]
      .map((s) => s.summary)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit ?? 50);
    return { sessions: list };
  },

  'sessions.get': ({ sessionId }) => {
    const s = requireSession(sessionId);
    const detail: SessionDetail = { ...s.summary, turns: s.turns, contract: s.contract };
    return { session: detail };
  },

  'sessions.create': ({ presetId, title }) => {
    const preset = presetById(presetId);
    const id = newId('s');
    const state: SessionState = {
      summary: {
        id,
        title: title ?? `新${preset.name}会话`,
        presetId: preset.id,
        workspaceId: 'ws-docs',
        hostId: HOST_ID,
        status: 'idle',
        updatedAt: Date.now(),
        unread: 0,
        preview: '',
      },
      turns: [],
      contract: preset.contract,
    };
    sessions.set(id, state);
    broadcast('session.created', { session: state.summary });
    return { session: state.summary };
  },

  'sessions.send': ({ sessionId, text }) => {
    const s = requireSession(sessionId);
    const userTurn: Turn = {
      id: newId('turn'),
      role: 'user',
      createdAt: Date.now(),
      status: 'done',
      blocks: [{ kind: 'text', id: newId('b'), text }],
    };
    s.turns.push(userTurn);
    broadcast('block.appended', { sessionId, runId: 'pending', turn: userTurn });
    touch(s, { preview: text.slice(0, 40) });
    const runId = newId('run');
    void runScript(s, text, runId);
    return { accepted: true as const, runId };
  },

  'sessions.steer': ({ sessionId, text }) => {
    const s = requireSession(sessionId);
    const turn: Turn = {
      id: newId('turn'),
      role: 'user',
      createdAt: Date.now(),
      status: 'done',
      blocks: [{ kind: 'text', id: newId('b'), text }],
    };
    s.turns.push(turn);
    broadcast('block.appended', { sessionId, runId: 'steer', turn });
    touch(s, { preview: text.slice(0, 40) });
    return { accepted: true as const };
  },

  'sessions.stop': ({ sessionId }) => {
    const s = requireSession(sessionId);

    // 卡在审批上时，先让它以「拒绝」收尾
    for (const entry of pendingApprovals.values()) {
      if (entry.approval.sessionId === sessionId) entry.decide('reject');
    }

    const running = activeRuns.get(sessionId);
    if (running) cancelledRuns.add(running);

    touch(s, { status: 'idle', runningSince: undefined });
    return { accepted: true as const };
  },

  'sessions.setPreset': ({ sessionId, presetId }) => {
    const s = requireSession(sessionId);
    const preset = presetById(presetId);
    s.contract = preset.contract;
    s.summary = { ...s.summary, presetId: preset.id, updatedAt: Date.now() };
    broadcast('session.updated', { session: s.summary });
    const detail: SessionDetail = { ...s.summary, turns: s.turns, contract: s.contract };
    return { session: detail };
  },

  'approvals.list': ({ sessionId }) => {
    const list = [...pendingApprovals.values()]
      .map((p) => p.approval)
      .filter((a) => !sessionId || a.sessionId === sessionId);
    return { approvals: list };
  },

  'questions.answer': ({ callId }) => {
    pendingApprovals.delete(callId);
    return { accepted: true as const };
  },

  'approvals.resolve': ({ approvalId, decision }) => {
    const entry = pendingApprovals.get(approvalId);
    if (!entry) {
      throw Object.assign(new Error('审批不存在或已过期'), {
        code: 'not_found' satisfies ProtocolError['code'],
      });
    }
    entry.decide(decision);
    return { accepted: true as const };
  },

  'presets.list': () => ({ presets: PRESETS }),

  'workspaces.list': () => ({ workspaces: WORKSPACES }),

  'credentials.describe': ({ refs }) => ({
    credentials: Object.fromEntries(
      refs.map((r) => [r, { configured: mockCredentials.has(r), writable: true }]),
    ),
  }),

  'credentials.set': ({ ref, value }) => {
    if (value.trim().length === 0) mockCredentials.delete(ref);
    else mockCredentials.set(ref, value.trim());
    return { ok: true as const };
  },

  'credentials.unset': ({ ref }) => {
    mockCredentials.delete(ref);
    return { ok: true as const };
  },
};

/* ------------------------------------------------------------------ *
 * HTTP + WS
 * ------------------------------------------------------------------ */

function lanAddresses(): string[] {
  const out: string[] = [];
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(net.address);
    }
  }
  return out;
}

export interface EngineServer {
  server: Server;
  port: number;
  close(): Promise<void>;
}

export async function startEngine(port = 8787): Promise<EngineServer> {
  const http = createServer((req, res) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, host: HOST_ID, protocol: PROTOCOL_VERSION, sessions: sessions.size }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(
      `<h1>dsh-palm mock engine</h1><p>WS: <code>ws://&lt;本机IP&gt;:${port}/ws</code></p><p><a href="/health">/health</a></p>`,
    );
  });

  const wss = new WebSocketServer({ server: http, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
    ws.on('message', (raw) => {
      let msg: { type?: string; id?: string; method?: string; params?: unknown };
      try {
        msg = JSON.parse(raw.toString()) as typeof msg;
      } catch {
        return;
      }
      if (msg.type !== 'req' || !msg.id) return;

      const id = msg.id;
      const method = msg.method as Method;
      if (!(method in handlers)) {
        send(ws, {
          type: 'res', v: PROTOCOL_VERSION, id, ok: false,
          error: { code: 'unsupported', message: `不支持的方法：${String(method)}` } satisfies ProtocolError,
        });
        return;
      }

      try {
        const handler = handlers[method] as (p: unknown) => unknown;
        const result = handler(msg.params ?? {});
        send(ws, { type: 'res', v: PROTOCOL_VERSION, id, ok: true, result });
      } catch (err) {
        const e = err as { code?: ProtocolError['code']; message?: string };
        send(ws, {
          type: 'res', v: PROTOCOL_VERSION, id, ok: false,
          error: { code: e.code ?? 'internal', message: e.message ?? '内部错误' } satisfies ProtocolError,
        });
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(port, '0.0.0.0', () => resolve());
  });

  const addr = http.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;

  return {
    server: http,
    port: actualPort,
    close: () =>
      new Promise<void>((resolve) => {
        for (const ws of clients) ws.close();
        wss.close();
        http.close(() => resolve());
      }),
  };
}

export function printBanner(port: number): void {
  const ips = lanAddresses();
  console.log('');
  console.log('  dsh-palm mock engine');
  console.log(`  HTTP   http://localhost:${port}/health`);
  console.log(`  WS     ws://localhost:${port}/ws`);
  for (const ip of ips) console.log(`  LAN    ws://${ip}:${port}/ws   <- 手机里填这个`);
  if (ips.length === 0) console.log('  (没检测到局域网 IP，手机可能连不上)');
  console.log('');
}
