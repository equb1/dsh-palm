/**
 * Android 兼容补丁：app 私有目录里禁止硬链接，dsh 却拿 link() 做原子落盘。
 *
 * 现象（真机 PLR110 / Android 16，proot 里的 dsh 0.2.1-rc.5）：
 *   turn/end  reason:{ kind:'error',
 *     message:"EACCES: permission denied, link '…session.v4.jsonl.zstd.<tmp>' -> '…session.v4.jsonl.zstd'" }
 * 每一轮都停在落盘这一步，模型根本没被调用，App 一直显示「生成中」。
 *
 * 官方代码在 @deepseek-ai/dsh-session-persistence-jsonl 里是
 * "写临时文件 + fsync + link() 发布"（POSIX），用 link 保证 NO-REPLACE。
 * Android 的 SELinux 不让 app 数据目录建硬链接，而同一个目录里的 rename 是允许的、也是原子的，
 * 所以这里把 link 换成「目标不存在就 rename」，语义基本等价。
 *
 * 用 `node --require /opt/dsh/patch/fs-link-fallback.cjs` 预加载：
 * 必须在 dsh 的 ESM 图加载之前打补丁，具名导入（import { link } from 'node:fs/promises'）
 * 才会拿到这里的版本。
 */
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');

/** 先抓住原函数：下面会把同名属性换成包装版，包装里必须调原函数，否则自己递归自己 */
const original = { link: fsp.link, linkSync: fs.linkSync, linkCallback: fs.link };

/** 这些错误码说明是"环境不允许硬链接"，而不是调用方写错了 */
const FALLBACK_CODES = new Set(['EACCES', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'EXDEV']);

function shouldFallback(error) {
  return Boolean(error && FALLBACK_CODES.has(error.code));
}

function exists(path) {
  return fsp.access(path).then(
    () => true,
    () => false,
  );
}

async function linkAsync(existing, replacement) {
  try {
    return await original.link(existing, replacement);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    // 目标已存在时不能替换：保留 link 的 NO-REPLACE 语义，把原始错误抛回去
    if (await exists(replacement)) throw error;
    await fsp.rename(existing, replacement);
  }
}

function linkSync(existing, replacement) {
  try {
    return original.linkSync(existing, replacement);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    if (fs.existsSync(replacement)) throw error;
    fs.renameSync(existing, replacement);
  }
}

function linkCallback(existing, replacement, callback) {
  const done = typeof callback === 'function' ? callback : () => {};
  Promise.resolve()
    .then(() => linkAsync(existing, replacement))
    .then(
      () => done(null),
      (error) => done(error),
    );
}

fsp.link = linkAsync;
fs.promises.link = linkAsync;
fs.linkSync = linkSync;
fs.link = linkCallback;

module.exports = { original, linkAsync, linkSync };

