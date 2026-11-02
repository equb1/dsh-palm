/**
 * just-bash 的入口在这个仓库里有三份：
 *
 *  - Node（测试 / 桌面脚本）：`just-bash`，因为测试走 CJS，而浏览器包
 *    的 exports 只声明了 `import` 条件；
 *  - Android / iOS（Metro）：`just-bash/browser`，不含 node:fs 的 ReadWriteFs；
 *  - web：同上。
 *
 * 这是唯一需要平台分叉的地方，IFileSystem / ShellRunner 都只认这里导出的值。
 */
export { Bash, InMemoryFs, MountableFs } from 'just-bash';
