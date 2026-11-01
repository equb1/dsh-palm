/**
 * 离线验证投影：直接读真 dsh 的会话日志，折成 Turn/Block。
 * 不需要凭据、不需要起服务。
 *
 *   node --import tsx scripts/test-projection.ts <session.v4.jsonl.zstd>
 */
import assert from 'node:assert/strict';

import { readSessionLog } from '../engine/src/real/logReader';
import { projectRecords } from '../engine/src/real/project';

const path = process.argv[2];
if (!path) {
  console.error('用法: node --import tsx scripts/test-projection.ts <session.v4.jsonl.zstd>');
  process.exit(1);
}

const records = readSessionLog(path);
console.log('记录数:', records.length);

const { turns, title, model } = projectRecords(records);
console.log('标题:', title ?? '(无)');
console.log('模型:', model ?? '(未知)');
console.log('回合数:', turns.length);

const users = turns.filter((t) => t.role === 'user');
const assistants = turns.filter((t) => t.role === 'assistant');
const toolBlocks = assistants
  .flatMap((t) => t.blocks)
  .filter((b): b is Extract<typeof b, { kind: 'tool' }> => b.kind === 'tool');
const done = toolBlocks.filter((b) => b.state === 'done');
const errored = toolBlocks.filter((b) => b.state === 'error');
const running = toolBlocks.filter((b) => b.state === 'running');
const thinking = assistants.flatMap((t) => t.blocks.filter((b) => b.kind === 'thinking'));

console.log('  用户回合:', users.length);
console.log('  助手回合:', assistants.length);
console.log(
  '  工具卡片:',
  toolBlocks.length,
  '| 完成',
  done.length,
  '/ 出错',
  errored.length,
  '/ 仍在跑',
  running.length,
);
console.log('  思考块:', thinking.length);

for (const r of running.slice(0, 3)) {
  console.log('    未收尾:', r.name, '|', r.summary.slice(0, 50));
}

const firstUser = users[0];
if (firstUser) {
  const text = firstUser.blocks.find((b) => b.kind === 'text');
  console.log('  首条用户消息长度:', text && text.kind === 'text' ? text.text.length : 0);
}

const sampleTool = toolBlocks[0];
if (sampleTool) {
  console.log('  示例工具卡:', sampleTool.name, '|', sampleTool.state, '|', sampleTool.summary.slice(0, 40));
}

assert.ok(turns.length > 0, '应当至少折出一个回合');
assert.ok(users.length > 0, '应当有用户回合');
assert.ok(assistants.length > 0, '应当有助手回合');
assert.ok(thinking.length > 0, '应当有思考块');
// 框架注入的上下文（source.kind = runtime-context / time-context / …）不能出现在用户回合里
const injectedMarkers = ['Current runtime context', '<system-reminder>', 'Time sampled while'];
for (const turn of users) {
  for (const block of turn.blocks) {
    if (block.kind !== 'text') continue;
    for (const marker of injectedMarkers) {
      assert.ok(
        !block.text.includes(marker),
        '用户回合里混进了框架注入内容：' + marker,
      );
    }
  }
}
console.log('  框架注入内容已过滤: ✓');
assert.ok(toolBlocks.length > 0, '应当有工具卡片');
assert.ok(
  running.length <= 2,
  '未收尾的工具应当只是个位数（正在执行的命令会暂时没有结果），实际 ' + running.length,
);

console.log('\n✓ 投影检查通过');
