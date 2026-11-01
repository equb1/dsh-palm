/**
 * 把真引擎桥打包成单文件 JS，好在手机上直接 `node dsh-palm-bridge.mjs` 跑。
 * 不依赖 tsx、不依赖 node_modules —— 手机上装个 node 就够了。
 *
 *   node scripts/build-bridge.mjs
 */
import { build } from 'esbuild';
import { mkdirSync, statSync } from 'node:fs';

const OUT = 'dist/dsh-palm-bridge.cjs';

mkdirSync('dist', { recursive: true });

const result = await build({
  entryPoints: ['engine/src/real/main.ts'],
  outfile: OUT,
  bundle: true,
  platform: 'node',
  target: 'node20',
  // CJS：ws 这类 CommonJS 依赖里有 require('events')，打成 ESM 会炸（Dynamic require is not supported）
  format: 'cjs',
  banner: {
    js: [
      '#!/usr/bin/env node',
      '// dsh-palm 真引擎桥（单文件版）',
      '// 用法: node dsh-palm-bridge.cjs <baseUrl> <token> [port]',
    ].join('\n'),
  },
  logLevel: 'info',
  minify: true,
  legalComments: 'none',
});

if (result.errors.length > 0) {
  for (const err of result.errors) console.error(err);
  process.exit(1);
}

const size = statSync(OUT).size;
console.log(`\n打包完成: ${OUT}  ${(size / 1024).toFixed(1)} KB`);
