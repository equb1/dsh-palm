// Metro 配置：给 `node:*` 内建模块一个占位，让 just-bash 的浏览器包能打进 RN。
// 背景见 docs/23-requirements.md R2：Hermes 没有 Node 标准库，bundle 里只有 node:zlib 一处引用。
const path = require('node:path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);
const stub = path.resolve(__dirname, 'src/lib/node-builtin-stub.js');

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('node:')) {
    return { type: 'sourceFile', filePath: stub };
  }
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
