import { execSync } from 'node:child_process';

const script = `
const fs = require('fs');
const full = 'C:/Users/chenf/AppData/Local/Programs/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js';
const c = fs.readFileSync(full, 'utf8');
const idx = c.indexOf('function requestAudience');
console.log(c.slice(idx, idx + 800));
`;

const res = execSync(
  `"C:\\Users\\chenf\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe" -e "${script.replace(/\n/g, ' ')}"`,
  {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  }
);
console.log(res);
