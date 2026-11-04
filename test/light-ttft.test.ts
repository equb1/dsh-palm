/**
 * 轻引擎 TTFT 日志（P0 1.5）：首个非空分片（含 tool_calls）只打一行，
 * 失败打 `error kind=… status=… run=… message=…`。
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { Agent, type RunSink } from '../app/src/engine/light/agent';
import type { StreamHandlers, StreamOptions, StreamResult } from '../app/src/engine/light/provider';
import type { LightModelConfig, LightRun, StoredSession } from '../app/src/engine/light/types';
import { LightRequestError } from '../app/src/lib/errors';

const MODEL: LightModelConfig = {
  baseURL: 'https://example.invalid/v1',
  apiKey: 'test-key',
  model: 'fake-model',
};

function makeSession(): StoredSession {
  return {
    id: 'session-1',
    title: 'TTFT',
    presetId: 'light',
    workspaceId: 'local',
    createdAt: 1,
    updatedAt: 1,
    pinned: false,
    archived: false,
    permission: 'danger-full-access',
    turns: [],
    history: [],
  };
}

function makeRun(): LightRun {
  return {
    sessionId: 'session-1',
    runId: 'run_test',
    step: new AbortController(),
    abortKind: null,
    finished: false,
  };
}

function makeSink(): RunSink {
  return {
    emit: () => undefined,
    requestApproval: async () => 'approve',
    askUser: async () => ({ id: 'q', selected: [] }),
    setStatus: () => undefined,
    persist: async () => undefined,
  };
}

function makeAgent(
  stream: (config: LightModelConfig, options: StreamOptions, handlers: StreamHandlers) => Promise<StreamResult>,
  logs: string[],
  now: () => number,
): Agent {
  return new Agent({
    model: MODEL,
    workspace: {} as never,
    bash: {} as never,
    maxSteps: 2,
    now,
    log: (message) => logs.push(message),
    stream: stream as unknown as typeof import('../app/src/engine/light/provider').streamChat,
  });
}

describe('轻引擎 · TTFT 日志', () => {
  it('正文首包：ttft / stream / usage / step 各就各位，且只打一次 ttft', async () => {
    let clock = 1_000;
    const logs: string[] = [];
    const stream = async (
      _config: LightModelConfig,
      _options: StreamOptions,
      handlers: StreamHandlers,
    ): Promise<StreamResult> => {
      clock += 20;
      handlers.onText?.('你');
      clock += 5;
      handlers.onText?.('好');
      clock += 100;
      return {
        text: '你好',
        thinking: '',
        toolCalls: [],
        usage: { inputTokens: 12, outputTokens: 7 },
      };
    };
    const outcome = await makeAgent(stream, logs, () => clock).run(makeSession(), makeRun(), makeSink());
    assert.equal(outcome.reason, 'done');
    const ttft = logs.filter((line) => line.startsWith('ttft='));
    assert.deepEqual(ttft, [
      'ttft=20ms stream=125ms model=fake-model step=1 first=content tools=0 usage=in:12,out:7 run=run_test',
    ]);
  });

  it('只有 tool_calls 的步骤：first=tool（不能等正文）', async () => {
    let clock = 2_000;
    const logs: string[] = [];
    const stream = async (
      _config: LightModelConfig,
      _options: StreamOptions,
      handlers: StreamHandlers,
    ): Promise<StreamResult> => {
      clock += 30;
      handlers.onToolCallDelta?.();
      clock += 50;
      return { text: '', thinking: '', toolCalls: [] };
    };
    const outcome = await makeAgent(stream, logs, () => clock).run(makeSession(), makeRun(), makeSink());
    assert.equal(outcome.reason, 'done');
    const ttft = logs.find((line) => line.startsWith('ttft=')) ?? '';
    assert.match(ttft, /^ttft=30ms stream=80ms model=fake-model step=1 first=tool tools=0 usage=in:0,out:0 run=run_test$/);
  });

  it('失败：带 kind/status/run/message，错误消息仍回给 UI', async () => {
    const logs: string[] = [];
    const stream = async (): Promise<StreamResult> => {
      throw new LightRequestError('unauthorized', 'API Key 无效或没有权限（401）', 401);
    };
    const outcome = await makeAgent(stream, logs, () => 1).run(makeSession(), makeRun(), makeSink());
    assert.equal(outcome.reason, 'error');
    assert.equal(outcome.error, 'API Key 无效或没有权限（401）');
    assert.deepEqual(
      logs.filter((line) => line.startsWith('error ')),
      ['error kind=unauthorized status=401 run=run_test message=API Key 无效或没有权限（401）'],
    );
    assert.equal(logs.filter((line) => line.startsWith('ttft=')).length, 0);
  });

  it('普通 Error 也能归类（默认 server），不会让 run 卡住', async () => {
    const logs: string[] = [];
    const stream = async (): Promise<StreamResult> => {
      throw new Error('boom');
    };
    const outcome = await makeAgent(stream, logs, () => 1).run(makeSession(), makeRun(), makeSink());
    assert.equal(outcome.reason, 'error');
    assert.match(logs.find((line) => line.startsWith('error ')) ?? '', /^error kind=server status=0 run=run_test message=boom$/);
  });
});
