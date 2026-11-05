import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { extractXlsxText } from '../app/src/engine/docs/xlsx';
import { NodeBackend } from '../app/src/engine/fs/nodeBackend';
import { createDataSandbox, createWorkspaceMount } from '../app/src/engine/fs/mount';
import { ShellRunner } from '../app/src/engine/shell/bash';
import { LightHost } from '../app/src/engine/light/host';
import { LocalEngineClient } from '../app/src/engine/light/localClient';
import type { LightModelConfig, ToolCall } from '../app/src/engine/light/types';
import type { EngineEvent } from '../app/src/protocol';
import type { StreamHandlers, StreamOptions, StreamResult } from '../app/src/engine/light/provider';

const roots: string[] = [];

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-palm-light-'));
  roots.push(dir);
  return dir;
}

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

interface FakeStep {
  text?: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  error?: Error;
  /** 一直挂着，直到 abort（测试停止/插话） */
  waitForAbort?: boolean;
}

function call(name: string, args: Record<string, unknown>, id = `call_${name}`): ToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

/** 按顺序吐出预设的响应；用完之后重复最后一个 */
function fakeStream(steps: FakeStep[]) {
  let index = 0;
  const calls: Array<{ messages: StreamOptions['messages']; tools: string[] }> = [];
  const fn = async (
    _config: LightModelConfig,
    options: StreamOptions,
    handlers: StreamHandlers,
  ): Promise<StreamResult> => {
    const step = steps[Math.min(index, steps.length - 1)] as FakeStep;
    index += 1;
    calls.push({
      messages: options.messages,
      tools: (options.tools ?? []).map((tool) => tool.name),
    });
    if (step.waitForAbort) {
      await new Promise<void>((_resolve, reject) => {
        if (options.signal?.aborted) {
          reject(new Error('aborted'));
          return;
        }
        options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
      throw new Error('aborted');
    }
    if (step.error) throw step.error;
    if (step.thinking) handlers.onThinking?.(step.thinking);
    if (step.text) handlers.onText?.(step.text);
    return { text: step.text ?? '', thinking: step.thinking ?? '', toolCalls: step.toolCalls ?? [] };
  };
  return { fn: fn as unknown as (typeof import('../app/src/engine/light/provider'))['streamChat'], calls };
}

const MODEL: LightModelConfig = {
  baseURL: 'https://example.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
  providerName: 'Fake',
};

interface Harness {
  host: LightHost;
  workspaceRoot: string;
  dataRoot: string;
  client: LocalEngineClient;
  events: EngineEvent[];
}

async function makeHost(steps: FakeStep[], options: { hostName?: string; dataRoot?: string; workspaceRoot?: string } = {}): Promise<Harness> {
  const workspaceRoot = options.workspaceRoot ?? (await tempDir());
  const dataRoot = options.dataRoot ?? (await tempDir());
  const mount = await createWorkspaceMount({ backend: new NodeBackend({ root: workspaceRoot }) });
  const dataFs = await createDataSandbox(new NodeBackend({ root: dataRoot }));
  const shell = new ShellRunner({ fs: mount.fs, beforeRun: () => mount.workspace.refreshIndex() });
  const host = new LightHost({
    workspace: mount.workspace,
    shell,
    dataFs,
    model: MODEL,
    ...(options.hostName ? { hostName: options.hostName } : {}),
    maxSteps: 4,
    approvalTimeoutMs: 5_000,
    questionTimeoutMs: 5_000,
    stream: fakeStream(steps).fn,
  });
  const events: EngineEvent[] = [];
  host.onEvent((event) => events.push(event));
  const client = new LocalEngineClient(host);
  await client.connect();
  return { host, workspaceRoot, dataRoot, client, events };
}

function nextEvent(harness: Harness, name: string): Promise<EngineEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`等待事件超时：${name}`)), 10_000);
    const off = harness.host.onEvent((event) => {
      if (event.event !== name) return;
      clearTimeout(timer);
      off();
      resolve(event);
    });
  });
}

async function createSession(harness: Harness, presetId = 'light'): Promise<string> {
  const { session } = await harness.client.request('sessions.create', { presetId, title: '测试会话' });
  return session.id;
}

describe('轻引擎 · 协议与流式', () => {
  it('capabilities 形状和真宿主一致', async () => {
    const harness = await makeHost([{ text: 'hi' }]);
    const caps = harness.client.caps;
    assert.ok(caps);
    assert.equal(caps.protocol, 1);
    assert.equal(caps.host.kind, 'phone');
    assert.ok(caps.actions.includes('steer'));
    assert.ok(caps.presets.some((preset) => preset.id === 'light'));
    assert.equal(caps.workspaces[0]?.root, '/workspace');
  });

  it('send：用户回合 + 流式文本 + run.finished(done)', async () => {
    const harness = await makeHost([{ thinking: '想一想…', text: '你好，我是轻引擎' }]);
    const sessionId = await createSession(harness);

    const finished = nextEvent(harness, 'run.finished');
    const accepted = await harness.client.request('sessions.send', { sessionId, text: '在吗' });
    assert.equal(accepted.accepted, true);
    const done = await finished;
    assert.equal((done.data as { reason: string }).reason, 'done');

    const { session } = await harness.client.request('sessions.get', { sessionId });
    assert.equal(session.turns[0]?.role, 'user');
    assert.match(JSON.stringify(session.turns[0]?.blocks), /在吗/);
    const assistantText = session.turns
      .filter((turn) => turn.role === 'assistant')
      .flatMap((turn) => turn.blocks)
      .map((block) => (block.kind === 'text' ? block.text : ''))
      .join('');
    assert.match(assistantText, /你好，我是轻引擎/);
    assert.equal(session.permission, 'workspace-write');
    assert.equal(session.contract.fs?.[0]?.path, '/workspace');
  });

  it('会话落盘：换一个 host 还能读到', async () => {
    const first = await makeHost([{ text: '记住了' }]);
    const sessionId = await createSession(first);
    const finished = nextEvent(first, 'run.finished');
    await first.client.request('sessions.send', { sessionId, text: '写点东西' });
    await finished;

    const second = await makeHost([{ text: 'x' }], { dataRoot: first.dataRoot, workspaceRoot: first.workspaceRoot });
    const { sessions } = await second.client.request('sessions.list', {});
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0]?.id, sessionId);
    const detail = await second.client.request('sessions.get', { sessionId });
    assert.ok(detail.session.turns.length >= 2);
  });
});

describe('轻引擎 · 工具与审批', () => {
  it('bash 工具：先弹审批，批准后真的在工作区执行', async () => {
    const harness = await makeHost([
      { toolCalls: [call('bash', { command: 'mkdir -p out && echo from-bash > out/a.txt' })] },
      { text: '写好了' },
    ]);
    const sessionId = await createSession(harness);

    const approval = nextEvent(harness, 'approval.requested');
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '建个文件' });

    const requested = await approval;
    const card = requested.data as { approval: { id: string; title: string; command?: string } };
    assert.equal(card.approval.title, '执行命令');
    assert.match(card.approval.command ?? '', /from-bash/);

    // 还没批准：文件不应该存在
    assert.equal(existsSync(join(harness.workspaceRoot, 'out/a.txt')), false);

    await harness.client.request('approvals.resolve', { approvalId: card.approval.id, decision: 'approve' });
    const done = await finished;
    assert.equal((done.data as { reason: string }).reason, 'done');

    const fs = await createWorkspaceMount({ backend: new NodeBackend({ root: harness.workspaceRoot }) });
    assert.equal(await fs.workspace.readFile('/out/a.txt'), 'from-bash\n');

    const { session } = await harness.client.request('sessions.get', { sessionId });
    const toolBlocks = session.turns.flatMap((turn) => turn.blocks).filter((block) => block.kind === 'tool');
    assert.equal(toolBlocks.length, 1);
    const toolBlock = toolBlocks[0] as { state: string; detail?: string };
    assert.equal(toolBlock.state, 'done');
  });

  it('文档工具：批准后生成 xlsx，工具结果回灌给模型', async () => {
    const harness = await makeHost([
      {
        toolCalls: [
          call('create_xlsx', {
            path: 'docs/真机表.xlsx',
            sheets: [{ name: '真机表', rows: [['项目', '数值'], ['自检', 47]] }],
          }),
        ],
      },
      { text: '表格好了' },
    ]);
    const sessionId = await createSession(harness);

    const approval = nextEvent(harness, 'approval.requested');
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '做个表' });
    const requested = await approval;
    const card = requested.data as { approval: { id: string; title: string; command?: string } };
    assert.equal(card.approval.title, '生成 Excel 表格');
    assert.match(card.approval.command ?? '', /真机表\.xlsx/);

    await harness.client.request('approvals.resolve', { approvalId: card.approval.id, decision: 'approve' });
    const done = await finished;
    assert.equal((done.data as { reason: string }).reason, 'done');

    const bytes = await readFile(join(harness.workspaceRoot, 'docs/真机表.xlsx'));
    assert.equal(bytes.subarray(0, 2).toString('utf8'), 'PK');
    const text = await extractXlsxText(new Uint8Array(bytes));
    assert.match(text, /真机表/);
    assert.match(text, /自检 \| 47/);

    const { session } = await harness.client.request('sessions.get', { sessionId });
    const toolMessage = session.turns
      .flatMap((turn) => turn.blocks)
      .find((block) => block.kind === 'tool' && block.name === 'create_xlsx');
    assert.equal((toolMessage as { state: string }).state, 'done');
  });

  it('拒绝审批：工具不执行，模型收到的是拒绝', async () => {
    const harness = await makeHost([
      { toolCalls: [call('bash', { command: 'echo should-not-run > blocked.txt' })] },
      { text: '好，那我不写了' },
    ]);
    const sessionId = await createSession(harness);

    const approval = nextEvent(harness, 'approval.requested');
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '写文件' });
    const requested = await approval;
    const approvalId = (requested.data as { approval: { id: string } }).approval.id;
    await harness.client.request('approvals.resolve', { approvalId, decision: 'reject' });
    await finished;

    const { session } = await harness.client.request('sessions.get', { sessionId });
    const toolMessages = session.turns.flatMap((turn) => turn.blocks).filter((block) => block.kind === 'tool');
    assert.equal((toolMessages[0] as { state: string }).state, 'error');

    const mount = await createWorkspaceMount({ backend: new NodeBackend({ root: harness.workspaceRoot }) });
    assert.equal(await mount.workspace.exists('/blocked.txt'), false);
  });

  it('ask_user_question：问题卡片 → 回答进入工具结果', async () => {
    const harness = await makeHost([
      {
        toolCalls: [
          call('ask_user_question', {
            questions: [
              {
                id: 'q1',
                header: '选个格式',
                question: '纪要要什么格式？',
                options: [{ label: 'Markdown' }, { label: 'Word' }],
              },
            ],
          }),
        ],
      },
      { text: '好的，用 Markdown' },
    ]);
    const sessionId = await createSession(harness);

    const requested = nextEvent(harness, 'approval.requested');
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '写个纪要' });
    const event = await requested;
    const approval = (event.data as { approval: { id: string; kind: string; questionId?: string; options?: unknown[] } })
      .approval;
    assert.equal(approval.kind, 'question');
    assert.equal(approval.questionId, 'q1');
    assert.equal(approval.options?.length, 2);

    await harness.client.request('questions.answer', {
      sessionId,
      callId: approval.id,
      answers: [{ id: 'q1', selected: ['Markdown'] }],
    });
    const done = await finished;
    assert.equal((done.data as { reason: string }).reason, 'done');

    const { session } = await harness.client.request('sessions.get', { sessionId });
    const toolMessage = session.turns
      .flatMap((turn) => turn.blocks)
      .find((block) => block.kind === 'tool' && block.name === 'ask_user_question');
    assert.ok(toolMessage);
    assert.match(JSON.stringify(session.turns), /Markdown/);
  });

  it('read-only 预设：工具表里没有 bash，模型硬要调用会报错', async () => {
    const harness = await makeHost([
      { toolCalls: [call('bash', { command: 'echo nope' })] },
      { text: '权限不允许' },
    ]);
    const sessionId = await createSession(harness, 'reader');

    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '跑个命令' });
    const done = await finished;
    assert.equal((done.data as { reason: string }).reason, 'done');

    const { session } = await harness.client.request('sessions.get', { sessionId });
    assert.equal(session.permission, 'read-only');
    const toolBlock = session.turns.flatMap((turn) => turn.blocks).find((block) => block.kind === 'tool');
    assert.equal((toolBlock as { state: string }).state, 'error');
    assert.match((toolBlock as { detail?: string }).detail ?? '', /没有这个工具/);
  });
});

describe('轻引擎 · 停止与插话', () => {
  it('stop：中断模型调用，run.finished(stopped)', async () => {
    const harness = await makeHost([{ waitForAbort: true }]);
    const sessionId = await createSession(harness);
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '慢慢想' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await harness.client.request('sessions.stop', { sessionId });
    const done = await finished;
    assert.equal((done.data as { reason: string }).reason, 'stopped');
  });

  it('steer：打断当前一步，带着新消息继续同一个 run', async () => {
    const harness = await makeHost([{ waitForAbort: true }, { text: '按你说的改' }]);
    const sessionId = await createSession(harness);
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '先写一版' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    await harness.client.request('sessions.steer', { sessionId, text: '换成英文' });
    const done = await finished;
    assert.equal((done.data as { reason: string }).reason, 'done');

    const { session } = await harness.client.request('sessions.get', { sessionId });
    const userTexts = session.turns
      .filter((turn) => turn.role === 'user')
      .map((turn) => (turn.blocks[0] as { kind: string; text?: string }).text ?? '');
    assert.deepEqual(userTexts, ['先写一版', '换成英文']);
    const assistantText = session.turns
      .filter((turn) => turn.role === 'assistant')
      .flatMap((turn) => turn.blocks)
      .map((block) => (block.kind === 'text' ? block.text : ''))
      .join('');
    assert.match(assistantText, /按你说的改/);
  });

  it('停止时挂着的审批会被拒绝，agent 不会卡死', async () => {
    const harness = await makeHost([
      { toolCalls: [call('bash', { command: 'echo x' })] },
      { text: '好' },
    ]);
    const sessionId = await createSession(harness);
    const approval = nextEvent(harness, 'approval.requested');
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '执行' });
    await approval;
    await harness.client.request('sessions.stop', { sessionId });
    const done = await finished;
    assert.equal((done.data as { reason: string }).reason, 'stopped');
    const { approvals } = await harness.client.request('approvals.list', { sessionId });
    assert.equal(approvals.length, 0);
  });
});

describe('LocalEngineClient', () => {
  it('connect / request / 事件 / 关闭', async () => {
    const harness = await makeHost([{ text: 'ok' }]);
    const sessionId = await createSession(harness);
    const seen: string[] = [];
    const off = harness.client.on('run.finished', () => seen.push('finished'));
    const anyOff = harness.client.onAny((event) => {
      if (event.event === 'run.started') seen.push('started');
    });
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: 'hi' });
    await finished;
    off();
    anyOff();
    assert.deepEqual(seen, ['started', 'finished']);
    assert.equal(harness.client.connectionState, 'connected');
    harness.client.close();
    assert.equal(harness.client.connectionState, 'closed');
    await assert.rejects(harness.client.request('sessions.list', {}), /还没连上/);
  });

  it('providers.list 显示单渠道；discover 用当前 Key 拉 /models（M2.5）', async () => {
    const harness = await makeHost([{ text: 'ok' }]);
    const { providers } = await harness.client.request('providers.list', {});
    assert.equal(providers.length, 1);
    assert.equal(providers[0]?.baseURL, MODEL.baseURL);
    assert.equal(providers[0]?.configured, true);
    assert.equal(providers[0]?.models[0]?.id, MODEL.model);

    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const original = globalThis.fetch;
    globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: (init?.headers ?? {}) as Record<string, string> });
      return new Response(
        JSON.stringify({ data: [{ id: 'fake-model', context_window: 65536 }, { id: 'fake-model-2' }] }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    try {
      const { models } = await harness.client.request('providers.discover', {
        baseURL: MODEL.baseURL,
        api: 'openai-completions',
      });
      assert.deepEqual(models.map((model) => model.id), ['fake-model', 'fake-model-2']);
      assert.equal(calls[0]?.url, `${MODEL.baseURL}/models`);
      // 没填新 Key、Base URL 没变：沿用当前渠道的 Key
      assert.equal(calls[0]?.headers.Authorization, 'Bearer test-key');
    } finally {
      globalThis.fetch = original;
    }

    await assert.rejects(
      harness.client.request('providers.discover', { baseURL: MODEL.baseURL, api: 'anthropic-messages' }),
      (error: unknown) => (error as { code?: string }).code === 'unsupported',
    );
  });

  it('未实现的方法返回 unsupported 而不是假装成功', async () => {
    const harness = await makeHost([{ text: 'ok' }]);
    await assert.rejects(harness.client.request('providers.save', { mode: 'custom', id: 'x', baseURL: 'https://x', api: 'openai-completions', models: [] }), (error: unknown) => {
      return (error as { code?: string }).code === 'unsupported';
    });
  });

  it('fs.list 列出工作区目录和文件大小，越界路径报错（U8）', async () => {
    const harness = await makeHost([{ text: 'ok' }]);
    await mkdir(join(harness.workspaceRoot, 'docs'), { recursive: true });
    await writeFile(join(harness.workspaceRoot, 'docs', 'a.txt'), 'hello');

    const root = await harness.client.request('fs.list', { path: '/' });
    assert.equal(root.path, '/');
    const docs = root.entries.find((entry) => entry.name === 'docs');
    assert.equal(docs?.kind, 'dir');

    const inner = await harness.client.request('fs.list', { path: '/docs' });
    const file = inner.entries.find((entry) => entry.name === 'a.txt');
    assert.equal(file?.kind, 'file');
    assert.equal(file?.size, 5);

    await assert.rejects(
      harness.client.request('fs.list', { path: '/nope' }),
      (error: unknown) => (error as { code?: string }).code === 'bad_request',
    );
  });

  it('fs.rename / fs.delete 改工作区文件，根目录拒绝（U8）', async () => {
    const harness = await makeHost([{ text: 'ok' }]);
    await mkdir(join(harness.workspaceRoot, 'docs'), { recursive: true });
    await writeFile(join(harness.workspaceRoot, 'docs', 'a.txt'), 'hello');

    await harness.client.request('fs.rename', { path: '/docs/a.txt', to: '/docs/b.txt' });
    const renamed = await harness.client.request('fs.list', { path: '/docs' });
    assert.equal(renamed.entries.some((entry) => entry.name === 'a.txt'), false);
    assert.equal(renamed.entries.find((entry) => entry.name === 'b.txt')?.size, 5);

    await harness.client.request('fs.delete', { path: '/docs/b.txt' });
    const after = await harness.client.request('fs.list', { path: '/docs' });
    assert.equal(after.entries.some((entry) => entry.name === 'b.txt'), false);

    await assert.rejects(
      harness.client.request('fs.delete', { path: '/' }),
      (error: unknown) => (error as { code?: string }).code === 'bad_request',
    );
    await assert.rejects(
      harness.client.request('fs.rename', { path: '/docs', to: '/' }),
      (error: unknown) => (error as { code?: string }).code === 'bad_request',
    );
  });

  it('shell.run 只读终端：pwd/echo 可跑，写操作被拒（U8）', async () => {
    const harness = await makeHost([{ text: 'ok' }]);
    const pwd = await harness.client.request('shell.run', { command: 'pwd' });
    assert.equal(pwd.exitCode, 0);
    assert.equal(pwd.stdout.trim(), '/workspace');

    const echo = await harness.client.request('shell.run', { command: 'echo hello' });
    assert.equal(echo.exitCode, 0);
    assert.equal(echo.stdout.trim(), 'hello');

    const ls = await harness.client.request('shell.run', { command: 'ls' });
    assert.equal(ls.exitCode, 0);

    const write = await harness.client.request('shell.run', {
      command: 'echo x > /workspace/terminal-write.txt',
    });
    assert.notEqual(write.exitCode, 0);
    assert.match(write.stderr, /read-only|EACCES/i);

    const listing = await harness.client.request('fs.list', { path: '/' });
    assert.equal(listing.entries.some((entry) => entry.name === 'terminal-write.txt'), false);

    await assert.rejects(
      harness.client.request('shell.run', { command: '   ' }),
      (error: unknown) => (error as { code?: string }).code === 'bad_request',
    );
  });

  it('sessions.pin 后 summary 带 pinned（U6 置顶分组）', async () => {
    const harness = await makeHost([{ text: 'ok' }]);
    const sessionId = await createSession(harness);
    await harness.client.request('sessions.pin', { sessionId, pinned: true });
    const pinnedList = await harness.client.request('sessions.list', {});
    assert.equal(pinnedList.sessions.find((session) => session.id === sessionId)?.pinned, true);

    await harness.client.request('sessions.pin', { sessionId, pinned: false });
    const normalList = await harness.client.request('sessions.list', {});
    assert.equal(normalList.sessions.find((session) => session.id === sessionId)?.pinned, false);
  });

  it('sessions.search 搜会话正文并返回片段（E3）', async () => {
    const harness = await makeHost([{ text: '你好，这是关于 python 的回复。' }]);
    const sessionId = await createSession(harness);
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '聊聊 python' });
    await finished;

    const { results } = await harness.client.request('sessions.search', { query: 'python' });
    assert.equal(results.length, 1);
    assert.equal(results[0]?.sessionId, sessionId);
    assert.match(results[0]?.snippet ?? '', /python/i);
    assert.ok((results[0]?.matches ?? 0) >= 1);

    await assert.rejects(
      harness.client.request('sessions.search', { query: '   ' }),
      (error: unknown) => (error as { code?: string }).code === 'bad_request',
    );
  });

  it('sessions.delete 删除会话，运行中的会话拒绝删除（E3）', async () => {
    const harness = await makeHost([{ text: 'ok' }]);
    const a = await createSession(harness);
    const b = await createSession(harness);
    await harness.client.request('sessions.delete', { sessionId: a });
    const list = await harness.client.request('sessions.list', {});
    assert.equal(list.sessions.some((session) => session.id === a), false);
    assert.equal(list.sessions.some((session) => session.id === b), true);

    const busy = await makeHost([{ waitForAbort: true }]);
    const running = await createSession(busy);
    await busy.client.request('sessions.send', { sessionId: running, text: '慢慢跑' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    await assert.rejects(
      busy.client.request('sessions.delete', { sessionId: running }),
      (error: unknown) => (error as { code?: string }).code === 'bad_request',
    );
    await busy.client.request('sessions.stop', { sessionId: running });
  });
});
