// 自测：正常 link 走原函数；模拟 EACCES 时退化成 rename。
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const shim = require('../app/android/app/src/main/assets/patch/fs-link-fallback.cjs');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'linktest-'));
const a = path.join(dir, 'a.tmp');
const b = path.join(dir, 'b.final');
const c = path.join(dir, 'c.final');

async function main() {
  const fsp = require('node:fs/promises');
  fs.writeFileSync(a, 'hello');

  await fsp.link(a, b);
  console.log('normal link ok:', fs.existsSync(b), 'content:', fs.readFileSync(b, 'utf8'));

  // 模拟 Android 的 EACCES
  shim.original.link = async () => {
    const error = new Error('permission denied');
    error.code = 'EACCES';
    throw error;
  };
  fs.writeFileSync(a, 'world');
  await fsp.link(a, c);
  console.log('fallback rename ok:', fs.existsSync(c), 'content:', fs.readFileSync(c, 'utf8'));
  console.log('tmp removed by rename:', !fs.existsSync(a));

  // 目标已存在时必须仍然报错（NO-REPLACE）
  fs.writeFileSync(a, 'again');
  let threw = false;
  try {
    await fsp.link(a, c);
  } catch (error) {
    threw = error.code === 'EACCES';
  }
  console.log('no-replace preserved:', threw);

  fs.rmSync(dir, { recursive: true, force: true });
}

void main();
