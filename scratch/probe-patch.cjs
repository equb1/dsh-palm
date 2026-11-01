// 探针：验证 --require（CJS 预载）里改 fs.link，ESM 的具名导入能不能看见。
const fsp = require('node:fs/promises');
fsp.link = async () => 'PATCHED-ESM-SEES-IT';
