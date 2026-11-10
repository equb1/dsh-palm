import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import {
  deleteSessionDir,
  encodeSegment,
  findSessionDir,
  latestSessionLog,
  projectKey,
  sessionDirFor,
} from '../engine/src/real/sessionFs';

let dshHome = '';

before(async () => {
  dshHome = await mkdtemp(join(tmpdir(), 'dsh-palm-session-fs-'));
  const project = join(dshHome, 'sessions', projectKey('/root/work'));
  const session = join(project, encodeSegment('session-alpha'));
  await mkdir(session, { recursive: true });
  await writeFile(join(session, 'session.v3.jsonl.zstd'), 'old');
  await writeFile(join(session, 'session.v4.jsonl.zstd'), 'new');
  await writeFile(join(session, 'session.v4.jsonl'), 'raw-old');
});

after(async () => {
  await rm(dshHome, { recursive: true, force: true });
});

describe('真 dsh 会话目录定位', () => {
  it('session id / cwd 转义与 dsh 一致', () => {
    assert.equal(encodeSegment('session-123'), 'session-123');
    assert.equal(encodeSegment('..'), '~002E~002E');
    assert.equal(encodeSegment('a/b'), 'a~002Fb');
    assert.equal(projectKey('/root/work'), '--root-work--');
    assert.equal(projectKey('C:\\work\\a'), '--C-work-a--');
  });

  it('按 cwd 直接定位；也能全量扫描兜底', async () => {
    const direct = await sessionDirFor(dshHome, '/root/work', 'session-alpha');
    assert.ok(direct?.endsWith(encodeSegment('session-alpha')));
    const scanned = await findSessionDir(dshHome, 'session-alpha');
    assert.equal(scanned, direct);
    assert.equal(await sessionDirFor(dshHome, '/root/other', 'session-alpha'), null);
    assert.equal(await findSessionDir(dshHome, 'session-missing'), null);
  });

  it('选择最高 generation；同代优先 zstd', async () => {
    const dir = await sessionDirFor(dshHome, '/root/work', 'session-alpha');
    assert.ok(dir);
    const log = await latestSessionLog(dir);
    assert.ok(log);
    assert.ok(log.path.endsWith('session.v4.jsonl.zstd'));
  });

  it('删除只影响目标会话目录', async () => {
    const dir = await sessionDirFor(dshHome, '/root/work', 'session-alpha');
    assert.ok(dir);
    await deleteSessionDir(dir);
    assert.equal(await sessionDirFor(dshHome, '/root/work', 'session-alpha'), null);
    const projects = await readdir(join(dshHome, 'sessions'));
    assert.deepEqual(projects, [projectKey('/root/work')]);
  });
});
