// 从已构建的 APK 生成落地页/README 用的发布元数据。
//
// 用法：
//   node scripts/write-release-meta.mjs 0.2.2 dist/dsh-palm-0.2.2-arm64.apk
//
// 输出：site/assets/release.json

import { createHash } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = process.argv[2];
const apkPath = process.argv[3];

if (!version || !apkPath) {
  console.error('usage: node scripts/write-release-meta.mjs <version> <apk-path>');
  process.exit(1);
}

const absolute = path.resolve(root, apkPath);
const bytes = await readFile(absolute);
const info = await stat(absolute);
const file = path.basename(absolute);
const sha256 = createHash('sha256').update(bytes).digest('hex');

const payload = {
  version,
  file,
  size: info.size,
  sha256,
  builtAt: new Date().toISOString(),
  assetUrl: `https://github.com/equb1/dsh-palm/releases/latest/download/${encodeURIComponent(file)}`,
  releaseUrl: 'https://github.com/equb1/dsh-palm/releases/latest',
};

const output = path.join(root, 'site/assets/release.json');
await writeFile(output, JSON.stringify(payload, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(payload, null, 2));
