/**
 * 只读问答卡的纯函数：判断 resolved、提取答案、生成历史卡视图。
 *
 *   node --import tsx test/readonly-qa.test.ts
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Approval, Block } from '../app/src/protocol';
import {
  approvalBlockView,
  approvalQaStatus,
  parseQuestionAnswer,
  qaViewFromApproval,
  qaViewFromToolBlock,
  readonlyQaToolBlockIds,
  withApprovalResolution,
} from '../app/src/protocol/qa';

function question(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'q-1',
    sessionId: 's-1',
    runId: 'r-1',
    createdAt: 1,
    kind: 'question',
    title: '纪要格式',
    command: '纪要要什么格式？',
    summary: '点一个选项，或直接输入你自己的答案。',
    risk: 'low',
    actions: [],
    options: [{ label: 'Markdown' }, { label: 'Word' }],
    questionId: 'q1',
    ...overrides,
  };
}

function approval(overrides: Partial<Approval> = {}): Approval {
  return {
    id: 'ap-1',
    sessionId: 's-1',
    runId: 'r-1',
    createdAt: 1,
    kind: 'approval',
    title: '执行命令',
    command: 'echo hello',
    summary: '会执行一条命令',
    risk: 'medium',
    actions: ['approve', 'reject'],
    ...overrides,
  };
}

test('pending 问题走交互卡，不生成只读视图', () => {
  const pending = question();
  assert.equal(approvalQaStatus(pending), null);
  assert.equal(qaViewFromApproval(pending), null);
  const block: Block = { kind: 'approval', id: 'b1', approvalId: pending.id, snapshot: pending };
  const view = approvalBlockView(block, { [pending.id]: pending });
  assert.equal(view?.mode, 'interactive');
});

test('选中选项 → 已回答 + 问题/选择/状态', () => {
  const resolved = question({
    resolution: { decision: 'approve', selected: ['Markdown'], by: 'user', at: 2 },
  });
  assert.equal(approvalQaStatus(resolved)?.status, 'answered');
  const qa = qaViewFromApproval(resolved);
  assert.ok(qa);
  assert.equal(qa.question, '纪要要什么格式？');
  assert.deepEqual(qa.selected, ['Markdown']);
  assert.equal(qa.statusLabel, '已回答');
});

test('自定义答案 → 已回答，并保留 custom', () => {
  const resolved = question({
    resolution: { decision: 'approve', custom: '用飞书文档', by: 'user', at: 2 },
  });
  const qa = qaViewFromApproval(resolved);
  assert.equal(qa?.status, 'answered');
  assert.equal(qa?.custom, '用飞书文档');
  assert.deepEqual(qa?.selected, []);
});

test('用户跳过 → 已跳过；停止/拒绝 → 已拒绝；超时 → 已跳过', () => {
  const skipped = question({ resolution: { decision: 'approve', selected: [], by: 'user' } });
  assert.equal(approvalQaStatus(skipped)?.label, '已跳过');

  const rejected = question({ resolution: { decision: 'reject', selected: [], by: 'user' } });
  assert.equal(approvalQaStatus(rejected)?.label, '已拒绝');

  const stopped = question({ resolution: { decision: 'reject', selected: [], by: 'stop' } });
  assert.equal(approvalQaStatus(stopped)?.label, '已拒绝');

  const timedOut = question({ resolution: { decision: 'reject', selected: [], by: 'timeout' } });
  assert.equal(approvalQaStatus(timedOut)?.label, '已跳过');
});

test('普通审批 → 已批准/已拒绝', () => {
  const approved = approval({ resolution: { decision: 'approve', by: 'user' } });
  assert.equal(approvalQaStatus(approved)?.label, '已批准');
  assert.equal(qaViewFromApproval(approved)?.question, '会执行一条命令');

  const rejected = approval({ resolution: { decision: 'reject', by: 'user' } });
  assert.equal(approvalQaStatus(rejected)?.label, '已拒绝');
});

test('历史 approval block 只靠 snapshot 还原只读卡', () => {
  const resolved = question({
    resolution: { decision: 'approve', selected: ['Word'], by: 'user' },
  });
  const block: Block = {
    kind: 'approval',
    id: 'b1',
    approvalId: resolved.id,
    snapshot: resolved,
  };
  const view = approvalBlockView(block, {});
  assert.equal(view?.mode, 'readonly');
  assert.deepEqual(view?.mode === 'readonly' ? view.qa.selected : [], ['Word']);
});

test('旧轻引擎历史：从 ask_user_question 工具结果提取答案', () => {
  const detail = JSON.stringify({
    answers: [{ id: 'q1', selected: ['Markdown'], custom: '再加一列时间' }],
  });
  assert.deepEqual(parseQuestionAnswer(detail), {
    id: 'q1',
    selected: ['Markdown'],
    custom: '再加一列时间',
  });

  const block: Block = {
    kind: 'tool',
    id: 't1',
    callId: 'call-1',
    name: 'ask_user_question',
    summary: '提问：纪要要什么格式？',
    state: 'done',
    detail,
  };
  const qa = qaViewFromToolBlock(block);
  assert.equal(qa?.question, '纪要要什么格式？');
  assert.equal(qa?.status, 'answered');
  assert.deepEqual(qa?.selected, ['Markdown']);
  assert.equal(qa?.custom, '再加一列时间');

  const running: Block = { ...block, state: 'running' };
  assert.equal(qaViewFromToolBlock(running), null);
  assert.equal(parseQuestionAnswer('{broken'), null);
});

test('同一个问题不会同时画问答卡和工具行', () => {
  const resolved = question({
    resolution: { decision: 'approve', selected: ['Markdown'], by: 'user' },
  });
  const blocks: Block[] = [
    {
      kind: 'tool',
      id: 't1',
      callId: resolved.id,
      name: 'ask_user_question',
      summary: '提问：纪要要什么格式？',
      state: 'done',
      detail: JSON.stringify({ answers: [{ id: 'q1', selected: ['Markdown'] }] }),
    },
    { kind: 'approval', id: 'b1', approvalId: resolved.id, snapshot: resolved },
  ];
  const ids = readonlyQaToolBlockIds(blocks, {});
  assert.deepEqual([...ids], ['t1']);
});

test('后续只带 decision 的事件不会冲掉已拿到的答案', () => {
  const resolved = withApprovalResolution(question(), {
    decision: 'approve',
    selected: ['Word'],
    custom: '加目录',
    by: 'user',
    at: 2,
  });
  const merged = withApprovalResolution(resolved, { decision: 'approve', by: 'user' });
  assert.deepEqual(merged.resolution?.selected, ['Word']);
  assert.equal(merged.resolution?.custom, '加目录');
  assert.equal(merged.resolution?.at, 2);
});
