/**
 * 能力门测试：
 *  - 纯函数：bash 任一段命中解释器就整条拒绝、read_file >10MB、未知工具；
 *  - 轻引擎集成：无审批/无副作用、capability block + 事件 + run.finished，
 *    历史里补了 [CAPABILITY_MISSING]，下一次发送还能正常工作。
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, describe, it } from 'node:test';

import { NodeBackend } from '../app/src/engine/fs/nodeBackend';
import { createDataSandbox, createWorkspaceMount } from '../app/src/engine/fs/mount';
import { ShellRunner } from '../app/src/engine/shell/bash';
import { LightHost } from '../app/src/engine/light/host';
import { LocalEngineClient } from '../app/src/engine/light/localClient';
import { checkToolCapability, inspectBashCommand } from '../app/src/engine/light/capability';
import type { LightModelConfig, ToolCall } from '../app/src/engine/light/types';
import type { EngineEvent, HandoffV1 } from '../app/src/protocol';
import type {
  StreamHandlers,
  StreamOptions,
  StreamResult,
} from '../app/src/engine/light/provider';

const roots: string[] = [];

after(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

const MODEL: LightModelConfig = {
  baseURL: 'https://example.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
  providerName: 'Fake',
};

function call(name: string, args: Record<string, unknown>, id = `call_${name}`): ToolCall {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function fakeStream(steps: Array<{ text?: string; toolCalls?: ToolCall[] }>) {
  let index = 0;
  const fn = async (
    _config: LightModelConfig,
    _options: StreamOptions,
    handlers: StreamHandlers,
  ): Promise<StreamResult> => {
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    if (step.text) handlers.onText?.(step.text);
    return { text: step.text ?? '', thinking: '', toolCalls: step.toolCalls ?? [] };
  };
  return fn as unknown as (typeof import('../app/src/engine/light/provider'))['streamChat'];
}

interface Harness {
  host: LightHost;
  client: LocalEngineClient;
  events: EngineEvent[];
  workspaceRoot: string;
}

async function makeHost(steps: Array<{ text?: string; toolCalls?: ToolCall[] }>): Promise<Harness> {
  const workspaceRoot = await mkdtemp(join(tmpdir(), 'dsh-cap-ws-'));
  const dataRoot = await mkdtemp(join(tmpdir(), 'dsh-cap-data-'));
  roots.push(workspaceRoot, dataRoot);
  const mount = await createWorkspaceMount({ backend: new NodeBackend({ root: workspaceRoot }) });
  const dataFs = await createDataSandbox(new NodeBackend({ root: dataRoot }));
  const shell = new ShellRunner({ fs: mount.fs, beforeRun: () => mount.workspace.refreshIndex() });
  const host = new LightHost({
    workspace: mount.workspace,
    shell,
    dataFs,
    model: MODEL,
    maxSteps: 4,
    approvalTimeoutMs: 5_000,
    questionTimeoutMs: 5_000,
    stream: fakeStream(steps),
  });
  const events: EngineEvent[] = [];
  host.onEvent((event) => events.push(event));
  const client = new LocalEngineClient(host);
  await client.connect();
  return { host, client, events, workspaceRoot };
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

async function createSession(harness: Harness): Promise<string> {
  const { session } = await harness.client.request('sessions.create', {
    presetId: 'light',
    title: '能力门测试',
  });
  return session.id;
}

describe('能力门 · 纯函数', () => {
  it('bash 任一段调用解释器/编译器 → 整条拒绝', () => {
    for (const command of [
      'echo start && python a.py',
      'cat a.txt | python -',
      'bash -c "python x.py"',
      'cd /workspace && git status',
      'npm run build',
      'ffmpeg -i a.mp4 out.mp3',
      'apt install python3',
      'make',
      'gcc a.c -o a',
    ]) {
      const result = inspectBashCommand(command);
      assert.equal(result.blocked, true, command);
      assert.ok(result.missing.length > 0, command);
    }
    assert.deepEqual(inspectBashCommand('echo start && python a.py').missing, ['python']);
  });

  it('普通 echo/ls/管道 不拦；bash 字符串里的 python 字样不误伤', () => {
    for (const command of ['ls -la', 'cat a.txt | grep foo', 'echo python', 'echo "python 是什么"']) {
      assert.equal(inspectBashCommand(command).blocked, false, command);
    }
  });

  it('read_file >10MB / 未知工具 / 生图', () => {
    const big = checkToolCapability({
      name: 'read_file',
      args: { path: 'big.log' },
      size: 11 * 1024 * 1024,
    });
    assert.equal(big.ok, false);
    if (!big.ok) assert.deepEqual(big.missing, ['read_file:>10MB']);

    const unknown = checkToolCapability({ name: 'browser', args: {}, known: false });
    assert.equal(unknown.ok, false);
    if (!unknown.ok) assert.ok(unknown.missing.includes('browser'));

    assert.equal(checkToolCapability({ name: 'generate_image', args: { prompt: '猫' } }).ok, true);
    assert.equal(checkToolCapability({ name: 'read_file', args: { path: 'small.txt' } }).ok, true);
  });
});

describe('能力门 · 轻引擎集成', () => {
  it('bash python：不执行、不弹审批、capability block/事件 + 下一轮还能发', async () => {
    const harness = await makeHost([
      { toolCalls: [call('bash', { command: 'python -c "open(\'pwned\', \'w\').write(\'x\')" && touch pwned' })] },
      { text: '已经停在能力门' },
      { text: '下一轮正常' },
    ]);
    const sessionId = await createSession(harness);
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '帮我跑 Python' });
    const done = await finished;
    assert.equal((done.data as { reason: string }).reason, 'capability_missing');
    assert.equal(existsSync(join(harness.workspaceRoot, 'pwned')), false);
    assert.equal(harness.events.some((event) => event.event === 'approval.requested'), false);

    const missingEvent = harness.events.find((event) => event.event === 'capability.missing');
    assert.ok(missingEvent);
    const missingData = missingEvent.data as {
      missing: string[];
      block: { kind: string; tool: string; status: string; callId?: string };
    };
    assert.deepEqual(missingData.missing, ['python']);
    assert.equal(missingData.block.kind, 'capability');
    assert.equal(missingData.block.tool, 'bash');
    assert.equal(missingData.block.status, 'pending');
    assert.ok(missingData.block.callId);

    const { session } = await harness.client.request('sessions.get', { sessionId });
    const blocks = session.turns.flatMap((turn) => turn.blocks);
    const capability = blocks.find((block) => block.kind === 'capability');
    assert.ok(capability);
    assert.equal(blocks.some((block) => block.kind === 'tool' && block.name === 'bash'), false);

    const handoff = (await harness.client.request('sessions.handoff', {
      sessionId,
      reason: 'capability_missing',
      blockedCallIds: [missingData.block.callId as string],
      userText: '帮我跑 Python',
    })) as HandoffV1;
    assert.equal(handoff.completedSteps.length, 0);
    assert.equal(handoff.pendingIntent.blocked.length, 1);
    assert.match(String(handoff.pendingIntent.blocked[0]?.args.command), /python/);
    assert.ok(
      handoff.recentTurns.some(
        (turn) => turn.role === 'tool' && turn.content === '[CAPABILITY_MISSING] not executed',
      ),
      '历史里必须补 tool 结果，不能悬空',
    );

    const again = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '继续' });
    const second = await again;
    assert.equal((second.data as { reason: string }).reason, 'done');
  });

  it('bash ls：能力门放行，完整权限下真的执行', async () => {
    const harness = await makeHost([
      { toolCalls: [call('bash', { command: 'ls' })] },
      { text: '列完了' },
    ]);
    const sessionId = await createSession(harness);
    await writeFile(join(harness.workspaceRoot, 'hello.txt'), 'hi');
    await harness.client.request('sessions.setPermission', {
      sessionId,
      preset: 'danger-full-access',
    });
    const finished = nextEvent(harness, 'run.finished');
    await harness.client.request('sessions.send', { sessionId, text: '列一下文件' });
    const done = await finished;
    assert.equal((done.data as { reason: string }).reason, 'done');
    assert.equal(harness.events.some((event) => event.event === 'capability.missing'), false);

    const { session } = await harness.client.request('sessions.get', { sessionId });
    const tool = session.turns
      .flatMap((turn) => turn.blocks)
      .find((block) => block.kind === 'tool' && block.name === 'bash');
    assert.ok(tool);
    assert.equal((tool as { state: string }).state, 'done');
    assert.match((tool as { detail?: string }).detail ?? '', /hello\.txt/);
  });
});
