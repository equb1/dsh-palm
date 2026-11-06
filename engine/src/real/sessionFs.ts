/**
 * 真 dsh 的会话落盘定位工具（U8/E3）。
 *
 * 真宿主没有公开的 session/delete 与 session/search API，桥又和 dsh 跑在
 * 同一个 proot 里，所以只能按 dsh 的磁盘布局直接定位：
 *
 *   $DSH_HOME/sessions/--<project>--/<encoded-session-id>/session.vN.jsonl.zstd
 *
 * 这里只做“定位/读取/删除单个会话目录”，不碰工作区文件，也不改 dsh 的
 * workspace 注册表。会话 id 和 cwd 都会先做与 dsh 相同的单射转义。
 */
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** 与 dsh-session-persistence-jsonl 的 encodeSegment 保持一致 */
export function encodeSegment(raw: string): string {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment');
  if (raw === '.') return '~002E';
  if (raw === '..') return '~002E~002E';
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch;
    else out += '~' + code.toString(16).toUpperCase().padStart(4, '0');
  }
  return out;
}

/** 与 dsh-session-persistence-jsonl 的 projectKey 保持一致 */
export function projectKey(cwd: string): string {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path');
  let readable = '';
  let separatorRun = false;
  for (let i = 0; i < cwd.length; i++) {
    const code = cwd.charCodeAt(i);
    const ch = String.fromCharCode(code);
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-';
      separatorRun = true;
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch;
      separatorRun = false;
    } else {
      readable += '~' + code.toString(16).toUpperCase().padStart(4, '0');
      separatorRun = false;
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`;
}

/** 默认的 dsh 数据目录；测试可以显式传 dshHome */
export function resolveDshHome(explicit?: string): string {
  return explicit ?? process.env.DSH_HOME ?? join(process.env.HOME || homedir(), '.dsh');
}

export function sessionsRoot(dshHome: string): string {
  return join(dshHome, 'sessions');
}

/** 按 cwd 直接算会话目录；不存在返回 null */
export async function sessionDirFor(
  dshHome: string,
  cwd: string,
  sessionId: string,
): Promise<string | null> {
  if (!cwd) return null;
  const dir = join(sessionsRoot(dshHome), projectKey(cwd), encodeSegment(sessionId));
  try {
    const info = await stat(dir);
    return info.isDirectory() ? dir : null;
  } catch {
    return null;
  }
}

/**
 * 扫描所有项目目录找会话；用于 cwd 缺失或历史会话换了工作区的情况。
 * 正常一次搜索只会在 sessionDirFor 找不到时走到这里。
 */
export async function findSessionDir(
  dshHome: string,
  sessionId: string,
): Promise<string | null> {
  const root = sessionsRoot(dshHome);
  const wanted = encodeSegment(sessionId);
  let projects: string[];
  try {
    projects = (await readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(root, entry.name));
  } catch {
    return null;
  }
  for (const project of projects) {
    const candidate = join(project, wanted);
    try {
      const info = await stat(candidate);
      if (info.isDirectory()) return candidate;
    } catch {
      /* 继续找 */
    }
  }
  return null;
}

export interface SessionLogFile {
  path: string;
  mtimeMs: number;
  size: number;
}

/**
 * 选择数值最高的 generation。dsh 当前写 v4，旧版本保留 v0–v3；同一代
 * 若 raw/zstd 同时存在，优先 zstd（当前默认压缩格式）。
 */
export async function latestSessionLog(dir: string): Promise<SessionLogFile | null> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null);
  if (!entries) return null;
  const candidates: Array<{ version: number; zstd: boolean; path: string }> = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const match = /^session(?:\.v(\d+))?\.jsonl(\.zstd)?$/.exec(entry.name);
    if (!match) continue;
    candidates.push({
      version: match[1] ? Number(match[1]) : 0,
      zstd: match[2] === '.zstd',
      path: join(dir, entry.name),
    });
  }
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    if (a.version !== b.version) return b.version - a.version;
    return Number(b.zstd) - Number(a.zstd);
  });
  const chosen = candidates[0]!;
  try {
    const info = await stat(chosen.path);
    return { path: chosen.path, mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return null;
  }
}

export async function readSessionLogFile(path: string): Promise<Buffer> {
  return readFile(path);
}

/**
 * 删除会话目录。dsh 的持久化写句柄最长可能还有 200ms 的批处理窗口，
 * 所以删完等一拍再确认一次；仍在就再删一次。
 */
export async function deleteSessionDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
  await new Promise((resolve) => setTimeout(resolve, 250));
  try {
    await stat(dir);
    await rm(dir, { recursive: true, force: true });
  } catch {
    /* 目录已经消失，正常 */
  }
}
