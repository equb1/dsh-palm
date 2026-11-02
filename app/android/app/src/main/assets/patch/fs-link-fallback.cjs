/**
 * Android 兼容与启动加速补丁（通过 `node --require /opt/dsh/patch/fs-link-fallback.cjs` 预加载）：
 *
 * 1. 开启 Node V8 编译缓存（module.enableCompileCache）：
 *    把 dsh 543 个 ESM 模块的字节码落盘在 /root/.dsh/compile-cache，二次冷启动跳过 JS 解析。
 *
 * 2. 修复 Android 私有目录禁止 link() 硬链接的问题：
 *    - @deepseek-ai/dsh-session-persistence-jsonl 用 "写临时文件 + fsync + link() + unlink(tmp)" 原子落盘
 *    - @deepseek-ai/dsh-attachment-local 用 "stage -> link(staged, object) -> unlink(staged) -> link(object, alias)"
 *    注意：不能把 link() 降级成 rename()！因为：
 *      a) dsh-attachment-local 在 link(staged, target) 下一行紧接着无 catch 地调 unlink(staged)，
 *         如果用 rename 把 staged 移走了，unlink(staged) 会直接抛 ENOENT 导致附件上传必败；
 *      b) publishImmutableAlias 需要同时保留 objectPath 和 aliasPath 两份文件；
 *      c) 重复上传同一文件时，dsh-attachment-local 依赖 link() 抛出 EEXIST 触发内容寻址去重。
 *    因此这里用 `copyFile(existing, replacement, COPYFILE_EXCL)` 降级：
 *      - 保留源文件不消失（满足后续 unlink 和二次 link）；
 *      - 目标已存在时原子返回 EEXIST（同时满足会话落盘 NO-REPLACE 与附件库内容寻址去重）。
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

function makeEexistError(existing, replacement) {
  return Object.assign(
    new Error(`EEXIST: file already exists, link '${existing}' -> '${replacement}'`),
    {
      code: 'EEXIST',
      errno: -17,
      syscall: 'link',
      path: existing,
      dest: replacement,
    },
  );
}

async function linkAsync(existing, replacement) {
  try {
    return await original.link(existing, replacement);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    try {
      await fsp.copyFile(existing, replacement, fs.constants.COPYFILE_EXCL);
    } catch (copyErr) {
      if (copyErr && copyErr.code === 'EEXIST') throw copyErr;
      if (await exists(replacement)) throw makeEexistError(existing, replacement);
      throw copyErr;
    }
  }
}

function linkSync(existing, replacement) {
  try {
    return original.linkSync(existing, replacement);
  } catch (error) {
    if (!shouldFallback(error)) throw error;
    try {
      fs.copyFileSync(existing, replacement, fs.constants.COPYFILE_EXCL);
    } catch (copyErr) {
      if (copyErr && copyErr.code === 'EEXIST') throw copyErr;
      if (fs.existsSync(replacement)) throw makeEexistError(existing, replacement);
      throw copyErr;
    }
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

