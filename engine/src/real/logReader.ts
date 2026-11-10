/**
 * 读真 dsh 的会话日志（session.v4.jsonl.zstd）。
 *
 * 这个文件是**多个 zstd 帧拼接**的：Node 的 zstdDecompressSync 只解第一帧，
 * 必须按 magic 切帧后逐帧解。实测 2.1MB → 1549 帧。
 */
import { readFileSync } from 'node:fs';
import { zstdDecompressSync } from 'node:zlib';

import type { RealEvent, RealRecord } from './project';

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

export function splitZstdFrames(data: Buffer): Buffer[] {
  const offsets: number[] = [];
  for (let i = 0; i + 4 <= data.length; i++) {
    if (data.compare(MAGIC, 0, 4, i, i + 4) === 0) offsets.push(i);
  }
  const frames: Buffer[] = [];
  for (let k = 0; k < offsets.length; k++) {
    let end = k + 1 < offsets.length ? offsets[k + 1]! : data.length;
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        frames.push(zstdDecompressSync(data.subarray(offsets[k]!, end)));
        break;
      } catch {
        // magic 可能出现在压缩数据内部，解不开就把下一帧并进来重试
        if (k + 2 >= offsets.length) break;
        k += 1;
        end = k + 1 < offsets.length ? offsets[k + 1]! : data.length;
      }
    }
  }
  return frames;
}

/** 从已读出的文件内容里解记录（搜索用异步读，避免阻塞事件循环） */
export function readSessionLogBuffer(data: Buffer): RealRecord[] {
  // 压缩日志是多个 zstd 帧；测试/旧宿主也可能是未压缩的 .jsonl。
  const frames = data.includes(Buffer.from([0x28, 0xb5, 0x2f, 0xfd])) ? splitZstdFrames(data) : [data];
  const out: RealRecord[] = [];
  for (const frame of frames) {
    for (const line of frame.toString('utf8').split('\n')) {
      if (!line.trim()) continue;
      try {
        const rec = JSON.parse(line) as RealRecord & { type?: string; event?: RealEvent };
        if (rec.type === 'event' && rec.event) out.push(rec);
        else if (rec.type && rec.type !== 'session') out.push({ type: 'event', event: rec as unknown as RealEvent });
      } catch {
        /* 跳过坏行 */
      }
    }
  }
  return out;
}

/** 读出所有记录（`{ type:'event', event:{...} }`） */
export function readSessionLog(path: string): RealRecord[] {
  return readSessionLogBuffer(readFileSync(path));
}
