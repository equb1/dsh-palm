import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { NodeBackend } from '../app/src/engine/fs/nodeBackend';
import { createWorkspaceMount, type WorkspaceMount } from '../app/src/engine/fs/mount';
import { MOBILE_EXECUTION_LIMITS, ShellRunner, truncateMiddle } from '../app/src/engine/shell/bash';

let root: string;
let mount: WorkspaceMount;
let shell: ShellRunner;

before(async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-palm-shell-'));
  mount = await createWorkspaceMount({ backend: new NodeBackend({ root }) });
  shell = new ShellRunner({
    fs: mount.fs,
    beforeRun: () => mount.workspace.refreshIndex(),
  });
});

after(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('ShellRunner（just-bash + 真实工作区）', () => {
  it('cwd 在 /workspace，默认布局不落到真实目录', async () => {
    const pwd = await shell.run('pwd');
    assert.equal(pwd.stdout.trim(), '/workspace');

    const listing = await shell.run('ls /');
    assert.match(listing.stdout, /workspace/);
    assert.match(listing.stdout, /bin/);

    // /bin 等默认布局只在内存里，真实工作区里没有
    await assert.rejects(stat(join(root, 'bin')), /ENOENT/);
  });

  it('重定向/管道/控制流都落到真实文件', async () => {
    const result = await shell.run(
      'mkdir -p tmp/d && echo hi > tmp/d/f.txt && cat tmp/d/f.txt | tr a-z A-Z',
    );
    assert.equal(result.exitCode, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'HI');
    assert.equal(await readFile(join(root, 'tmp/d/f.txt'), 'utf8'), 'hi\n');
  });

  it('grep -r / find / glob 能看到工作区文件', async () => {
    await shell.run('printf "alpha\\nbeta\\n" > notes.txt');
    const grep = await shell.run('grep -r beta .');
    assert.equal(grep.exitCode, 0, grep.stderr);
    assert.match(grep.stdout, /notes\.txt:beta/);

    const find = await shell.run('find . -name "*.txt"');
    assert.match(find.stdout, /notes\.txt/);

    const glob = await shell.run('echo *.txt');
    assert.match(glob.stdout, /notes\.txt/);
  });

  it('工作区外读不到宿主的文件', async () => {
    const secret = await shell.run('cat /workspace/../../secret');
    assert.notEqual(secret.exitCode, 0);
    const rootEtc = await shell.run('cat /etc/passwd');
    assert.notEqual(rootEtc.exitCode, 0);
  });

  it('退出码原样带回', async () => {
    const result = await shell.run('false');
    assert.equal(result.exitCode, 1);
    const missing = await shell.run('cat nope.txt');
    assert.equal(missing.exitCode, 1);
    assert.match(missing.stderr, /No such file/);
    assert.match(missing.text, /exit code: 1/);
  });

  it('输出截断：头尾保留，中间标明', async () => {
    const result = await shell.run('seq 1 500', { maxOutputChars: 120 });
    assert.equal(result.truncated, true);
    assert.match(result.stdout, /截断 \d+ 字符/);
    const direct = truncateMiddle('abcdefghij', 4);
    assert.equal(direct.truncated, true);
    assert.equal(direct.text, 'ab\n…[截断 6 字符]…\nij');
  });

  it('超时：长命令在 timeout 后交还控制权', async () => {
    const started = Date.now();
    const result = await shell.run('sleep 5', { timeoutMs: 300 });
    const elapsed = Date.now() - started;
    assert.equal(result.timedOut, true);
    assert.equal(result.exitCode, 124);
    assert.ok(elapsed < 4_000, `超时没有及时返回，用了 ${elapsed}ms`);
  });

  it('外部 abort 能停下命令', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 200);
    const started = Date.now();
    const result = await shell.run('sleep 5', { signal: controller.signal, timeoutMs: 10_000 });
    assert.notEqual(result.exitCode, 0);
    assert.ok(Date.now() - started < 4_000);
  });

  it('死循环被 executionLimits 挡住', async () => {
    const result = await shell.run('while true; do echo x; done');
    assert.equal(result.exitCode, 126);
    assert.ok(result.ms < 5_000);
    assert.ok(MOBILE_EXECUTION_LIMITS.maxLoopIterations! > 0);
  });

  it('每次执行新建 interpreter，但文件系统状态连续', async () => {
    await shell.run('mkdir -p persists && echo one > persists/a.txt');
    const second = await shell.run('cat persists/a.txt');
    assert.equal(second.stdout.trim(), 'one');
    // 环境/工作目录按 just-bash 语义不跨 exec 保留
    const env = await shell.run('echo ${UNSET_VAR:-empty}');
    assert.equal(env.stdout.trim(), 'empty');
  });
});
