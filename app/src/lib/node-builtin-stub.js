'use strict';

/**
 * `node:*` 内建模块的占位实现。
 *
 * just-bash 的浏览器包只在 gzip/gunzip/zcat 里动态 import('node:zlib')；
 * 手机（Hermes）上没有 Node 标准库，Metro 连解析都会失败。
 * 这里统一返回一个“用到就抛错”的 Proxy，让打包通过、命令按官方文档失败。
 */
function unavailable(name) {
  return () => {
    throw new Error('node 内建模块在手机上不可用：' + name);
  };
}

const handler = {
  get(_target, property) {
    return unavailable(String(property));
  },
};

module.exports = new Proxy({}, handler);
module.exports.default = module.exports;
