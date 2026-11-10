/** 真引擎正文搜索的纯函数：与轻引擎保持同样的命中/片段口径。 */
import type { Turn } from '../../../app/src/protocol';

export function buildSessionSearchText(title: string, turns: Turn[]): string {
  const parts: string[] = [title];
  for (const turn of turns) {
    if (turn.role === 'user') {
      for (const block of turn.blocks) {
        if (block.kind === 'text' && block.text) parts.push(block.text);
      }
      continue;
    }
    for (const block of turn.blocks) {
      if ((block.kind === 'text' || block.kind === 'thinking') && block.text) parts.push(block.text);
    }
  }
  return parts.filter((part) => part.length > 0).join('\n');
}

export interface SearchMatch {
  matches: number;
  snippet: string;
}

/** 大小写不敏感；matches 按不重叠出现次数算，片段取首次命中前 50 / 后 90 字。 */
export function matchSessionText(text: string, query: string): SearchMatch | null {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const lower = text.toLowerCase();
  const first = lower.indexOf(q);
  if (first < 0) return null;
  let matches = 0;
  let at = first;
  while (at >= 0) {
    matches += 1;
    at = lower.indexOf(q, at + q.length);
  }
  const start = Math.max(0, first - 50);
  const snippet = text
    .slice(start, start + 140)
    .replace(/\s+/g, ' ')
    .trim();
  return { matches, snippet };
}
