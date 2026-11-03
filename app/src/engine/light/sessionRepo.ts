/**
 * 会话持久化：一个会话一个 JSON 文件。
 *
 * 放在 App 私有目录（真机 `<filesDir>/.dsh-light/sessions`），不进工作区，
 * 所以模型/shell 看不到也删不掉。数据量很小（一次会话几百 KB），
 * MVP 不做 SQLite，也不做增量日志。
 */
import type { SandboxFs } from '../fs/sandbox';
import type { StoredSession } from './types';

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export class SessionRepo {
  private readonly fs: SandboxFs;
  private readonly dir: string;
  private initialised = false;
  private readonly onWarn?: (message: string) => void;

  constructor(fs: SandboxFs, dir = '/sessions', onWarn?: (message: string) => void) {
    this.fs = fs;
    this.dir = dir;
    this.onWarn = onWarn;
  }

  private file(id: string): string {
    if (!ID_PATTERN.test(id)) throw new Error(`非法的会话 id：${id}`);
    return `${this.dir}/${id}.json`;
  }

  private async ensure(): Promise<void> {
    if (this.initialised) return;
    await this.fs.mkdir(this.dir, { recursive: true });
    this.initialised = true;
  }

  async list(): Promise<StoredSession[]> {
    await this.ensure();
    let names: string[] = [];
    try {
      names = await this.fs.readdir(this.dir);
    } catch {
      return [];
    }
    const sessions: StoredSession[] = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const id = name.slice(0, -'.json'.length);
      const session = await this.get(id).catch(() => null);
      if (session) sessions.push(session);
    }
    return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  async get(id: string): Promise<StoredSession | null> {
    await this.ensure();
    const path = this.file(id);
    if (!(await this.fs.exists(path))) return null;
    try {
      const raw = await this.fs.readFile(path);
      const parsed = JSON.parse(raw) as StoredSession;
      if (!parsed || typeof parsed.id !== 'string' || !Array.isArray(parsed.turns)) return null;
      if (!Array.isArray(parsed.history)) parsed.history = [];
      return parsed;
    } catch (error) {
      this.onWarn?.(`会话文件损坏，已忽略：${path}（${error instanceof Error ? error.message : String(error)}）`);
      return null;
    }
  }

  async save(session: StoredSession): Promise<void> {
    await this.ensure();
    session.updatedAt = Date.now();
    const path = this.file(session.id);
    const json = JSON.stringify(session);
    // 先写临时文件再 rename：App 被杀在写一半时，不会留下半个 JSON
    const temp = `${path}.tmp`;
    try {
      await this.fs.writeFile(temp, json);
      await this.fs.mv(temp, path);
    } catch {
      // 某些后端 rename 不覆盖已有文件：退回直接写
      await this.fs.rm(temp, { force: true });
      await this.fs.writeFile(path, json);
    }
  }

  async remove(id: string): Promise<void> {
    await this.ensure();
    await this.fs.rm(this.file(id), { force: true });
  }
}

export function newSessionId(): string {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function newRunId(): string {
  return `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

export function newBlockId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}
