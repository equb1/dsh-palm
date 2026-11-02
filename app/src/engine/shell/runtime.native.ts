/**
 * 原生（Android / iOS）入口：浏览器构建，避开 node:fs。
 * 见 `runtime.ts` 的说明。
 */
export { Bash, InMemoryFs, MountableFs } from 'just-bash/browser';
