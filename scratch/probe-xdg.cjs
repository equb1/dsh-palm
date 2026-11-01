// 验证 dsh 找默认工作区时的那次外部调用：execFile('xdg-user-dir', ['DOCUMENTS'])
const { execFile } = require('node:child_process');

execFile('xdg-user-dir', ['DOCUMENTS'], (error, stdout) => {
  if (error) {
    console.log('ERR ' + error.message);
    process.exit(1);
  }
  console.log(JSON.stringify(stdout));
});
