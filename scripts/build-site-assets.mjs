// 落地页 / README 展示资产生成器
//
// 依赖（不写进 package.json，按需安装）：
//   npm install --no-save --no-package-lock sharp qrcode
//
// 运行：
//   node scripts/build-site-assets.mjs

import { mkdir, copyFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = path.join(root, 'site/assets');
const petsOut = path.join(site, 'pets');

const STATES = ['idle', 'thinking', 'working', 'attention', 'juggling', 'sleeping', 'react-tickle'];

const POUCH = `M208 158
  C 206 146, 219 138, 230 143
  C 238 131, 252 133, 256 141
  C 260 133, 274 131, 282 143
  C 293 138, 306 146, 304 158
  C 309 168, 316 172, 322 176
  C 364 202, 384 252, 382 306
  C 379 376, 328 424, 256 424
  C 184 424, 133 376, 130 306
  C 128 252, 148 202, 190 176
  C 196 172, 203 168, 208 158 Z`;

const STAR = `M256 222
  C 262 264, 270 274, 313 282
  C 270 290, 262 300, 256 342
  C 250 300, 242 290, 199 282
  C 242 274, 250 264, 256 222 Z`;

const FONT = `'PingFang SC','Noto Sans SC','Microsoft YaHei',sans-serif`;
const MONO = `ui-monospace,SFMono-Regular,Menlo,Consolas,monospace`;

function pouchIcon(x, y, size, dark) {
  const bg1 = dark ? '#1E2A4A' : '#F4F6FE';
  const bg2 = dark ? '#0B101C' : '#E3E8F6';
  return `<g transform="translate(${x} ${y}) scale(${size / 512})">
    <defs>
      <linearGradient id="icbg${x}${y}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/>
      </linearGradient>
      <linearGradient id="icp${x}${y}" x1=".22" y1=".02" x2=".78" y2=".98">
        <stop offset="0" stop-color="#A6BCFF"/><stop offset=".38" stop-color="#6785EC"/>
        <stop offset=".78" stop-color="#4A63BE"/><stop offset="1" stop-color="#35488C"/>
      </linearGradient>
    </defs>
    <rect width="512" height="512" rx="116" fill="url(#icbg${x}${y})"/>
    <rect width="512" height="512" rx="116" fill="none" stroke="#4B67B4" stroke-opacity=".28" stroke-width="4"/>
    <path d="${POUCH}" fill="url(#icp${x}${y})"/>
    <path d="M186 185 C 214 206, 298 206, 326 185" fill="none" stroke="#F0C979" stroke-width="13" stroke-linecap="round"/>
    <path d="M250 198 C 241 216, 234 226, 226 236" fill="none" stroke="#F0C979" stroke-width="8.5" stroke-linecap="round"/>
    <path d="M266 198 C 275 216, 282 226, 290 236" fill="none" stroke="#F0C979" stroke-width="8.5" stroke-linecap="round"/>
    <circle cx="258" cy="196" r="9" fill="#F6D68F" stroke="#B98A33" stroke-width="2.5"/>
    <path d="${STAR}" fill="#FFFFFF"/>
    <path d="M182 240 C 186 257, 191 262, 208 266 C 191 270, 186 275, 182 292 C 178 275, 173 270, 156 266 C 173 262, 178 257, 182 240 Z" fill="#FFFFFF" opacity=".72"/>
    <path d="M336 320 C 339 332, 342 336, 355 339 C 342 342, 339 346, 336 359 C 333 346, 330 342, 317 339 C 330 336, 333 332, 336 320 Z" fill="#FFFFFF" opacity=".55"/>
  </g>`;
}

function whale(x, y, scale, color = '#5B7CE6', belly = '#C9D8FF') {
  return `<g transform="translate(${x} ${y}) scale(${scale})">
    <path d="M0 26C0 10 14 0 32 0c20 0 34 12 34 27 0 16-14 25-34 25C14 52 0 42 0 26Z" fill="${color}"/>
    <path d="M66 12c6-8 14-11 22-10-2 8-8 14-16 17Z" fill="${color}"/>
    <path d="M66 40c7 7 15 9 23 7-4-8-10-13-18-15Z" fill="${color}"/>
    <path d="M8 34c4 10 13 16 25 17 12 1 23-4 29-12-10 4-21 6-32 4-9-2-16-5-22-9Z" fill="${belly}"/>
    <circle cx="22" cy="20" r="3" fill="#121826"/>
    <path d="M14 14c2-4 5-6 9-6" fill="none" stroke="#FFFFFF" stroke-opacity=".5" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M30 1c0-2 0-4 1-5M34 1c1-3 3-5 5-6" fill="none" stroke="${color}" stroke-width="2.6" stroke-linecap="round"/>
  </g>`;
}

function heroSvg(lang, dark) {
  const zh = lang === 'zh';
  const bg1 = dark ? '#182139' : '#FBFCFE';
  const bg2 = dark ? '#0B101C' : '#EDF1FA';
  const ink = dark ? '#F2F5FF' : '#14182A';
  const dim = dark ? '#A8B4D2' : '#555D72';
  const faint = dark ? '#7C89A8' : '#7A8194';
  const line = dark ? '#2A3552' : '#DDE3F1';
  const chipBg = dark ? '#1B2338' : '#FFFFFF';
  const chipLine = dark ? '#31405F' : '#DFE4F2';
  const phoneBg = dark ? '#11161F' : '#F8F9FD';
  const panel = dark ? '#171E2B' : '#FFFFFF';
  const phoneInk = dark ? '#E6E8EB' : '#161B2A';
  const phoneDim = dark ? '#98A2B5' : '#5E667C';
  const userBubble = dark ? '#1A2A44' : '#EDF3FE';
  const aiBubble = dark ? '#151B26' : '#F7F8FC';

  const title = zh ? '锦囊' : 'Jinang';
  const titleSub = zh ? 'DSH PALM' : 'DSH PALM';
  const tagline = zh ? '把 DeepSeek Harness 装进口袋' : 'DeepSeek Harness, in your pocket';
  const sub = zh ? '轻引擎 300ms 秒开 · 需要真 Linux 时按需 proot' : 'Instant in-process engine · on-demand proot when needed';
  const taglineSize = zh ? 29 : 27;
  const subSize = zh ? 15 : 14;
  const chips = zh ? ['Android arm64', '双引擎', 'AGPL-3.0'] : ['Android arm64', 'Dual engine', 'AGPL-3.0'];
  const chipWidths = zh ? [112, 62, 72] : [112, 88, 72];

  let chipX = 82;
  const chipMarkup = chips.map(function (label, index) {
    const w = chipWidths[index];
    const out = `<g transform="translate(${chipX} 300)">
      <rect width="${w}" height="26" rx="13" fill="${chipBg}" stroke="${chipLine}"/>
      <text x="${w / 2}" y="18" text-anchor="middle" fill="${dark ? '#BFD0FF' : '#4B67B4'}" font-family="${FONT}" font-size="11">${label}</text>
    </g>`;
    chipX += w + 8;
    return out;
  }).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="360" viewBox="0 0 1200 360" role="img" aria-labelledby="t d">
  <title id="t">${zh ? '锦囊 · dsh-palm — 把 DeepSeek Harness 装进口袋' : 'Jinang · dsh-palm — Put DeepSeek Harness in your pocket'}</title>
  <desc id="d">${sub}</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="${dark ? '#8FA2D6' : '#8FA2D6'}" stroke-opacity="${dark ? '.07' : '.10'}"/></pattern>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#4B67B4" stop-opacity="${dark ? '.55' : '.26'}"/><stop offset="1" stop-color="#4B67B4" stop-opacity="0"/></radialGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#414A63"/><stop offset="1" stop-color="#161B26"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4B67B4"/><stop offset="1" stop-color="#B8741A"/></linearGradient>
  </defs>

  <rect width="1200" height="360" rx="30" fill="url(#bg)"/>
  <rect width="1200" height="360" rx="30" fill="url(#grid)"/>
  <circle cx="1060" cy="20" r="220" fill="url(#glow)"/>
  <circle cx="860" cy="360" r="160" fill="url(#glow)" opacity=".5"/>

  ${pouchIcon(80, 52, 92, dark)}

  <text x="196" y="112" fill="${ink}" font-family="${FONT}" font-size="54" font-weight="700" letter-spacing="2">${title}</text>
  <text x="200" y="140" fill="${faint}" font-family="${MONO}" font-size="14" letter-spacing="6">${titleSub}</text>

  <text x="82" y="212" fill="${ink}" font-family="${FONT}" font-size="${taglineSize}" font-weight="600">${tagline}</text>
  <text x="84" y="250" fill="${dim}" font-family="${FONT}" font-size="${subSize}">${sub}</text>

  ${chipMarkup}

  <g>
    <rect x="948" y="18" width="196" height="324" rx="34" fill="url(#frame)"/>
    <rect x="954" y="24" width="184" height="312" rx="29" fill="${phoneBg}"/>
    <rect x="1007" y="29" width="78" height="8" rx="4" fill="#0A0D14"/>

    <g transform="translate(968 52)">
      <rect width="24" height="24" rx="7" fill="#4B67B4"/>
      <path d="M12 5c.6 4.1 1.4 4.9 5.5 5.5-4.1.6-4.9 1.4-5.5 5.5-.6-4.1-1.4-4.9-5.5-5.5 4.1-.6 4.9-1.4 5.5-5.5Z" fill="#FFFFFF"/>
      <text x="31" y="17" fill="${phoneInk}" font-family="${FONT}" font-size="11" font-weight="650">${zh ? '锦囊' : 'Jinang'}</text>
      <rect x="108" y="2" width="52" height="19" rx="9.5" fill="${dark ? '#1B2A44' : '#EDF3FE'}"/>
      <circle cx="118" cy="11.5" r="3" fill="#1F9D63"/>
      <text x="125" y="15" fill="#4B67B4" font-family="${FONT}" font-size="8.5">${zh ? '轻引擎' : 'Light'}</text>
    </g>

    <g transform="translate(968 90)">
      <rect width="150" height="34" rx="12" fill="${userBubble}"/>
      <text x="10" y="15" fill="${phoneInk}" font-family="${FONT}" font-size="8.5">${zh ? '把会议纪要整理成周报，' : 'Turn these notes into a weekly'}</text>
      <text x="10" y="27" fill="${phoneInk}" font-family="${FONT}" font-size="8.5">${zh ? '并生成 docx。' : 'report and make a docx.'}</text>
    </g>

    <g transform="translate(968 134)">
      <rect width="168" height="42" rx="11" fill="${aiBubble}" stroke="${line}"/>
      <text x="10" y="16" fill="${phoneDim}" font-family="${FONT}" font-size="8.5">${zh ? '已生成周报，包含本周进展、' : 'Weekly report ready with progress,'}</text>
      <text x="10" y="28" fill="${phoneDim}" font-family="${FONT}" font-size="8.5">${zh ? '风险与下周计划。' : 'risks and next-week plan.'}</text>
      <rect x="10" y="32" width="62" height="7" rx="3.5" fill="${dark ? '#1D2B45' : '#E4EDFD'}"/>
    </g>

    <g transform="translate(968 186)">
      <rect width="168" height="42" rx="10" fill="${dark ? '#2A2318' : '#FFF8E8'}" stroke="${dark ? '#5D4A28' : '#EBCF98'}"/>
      <text x="9" y="15" fill="${dark ? '#E2C07E' : '#7A5200'}" font-family="${FONT}" font-size="8" font-weight="600">${zh ? '需要确认 · 写入工作区文件' : 'Approval · write into workspace'}</text>
      <rect x="9" y="21" width="76" height="7" rx="3.5" fill="${dark ? '#3A3326' : '#F3E2BE'}"/>
      <rect x="9" y="31" width="34" height="9" rx="4.5" fill="#4B67B4"/>
      <rect x="47" y="31" width="28" height="9" rx="4.5" fill="none" stroke="${dark ? '#5D4A28' : '#EBCF98'}"/>
    </g>

    <g transform="translate(962 252)">
      <rect width="168" height="36" rx="10" fill="${panel}" stroke="${line}"/>
      <text x="10" y="15" fill="${phoneDim}" font-family="${MONO}" font-size="7.5">$ dsh web :8787</text>
      <circle cx="12" cy="26" r="3" fill="#4ADE80"/>
      <text x="20" y="29" fill="${phoneDim}" font-family="${FONT}" font-size="7.5">${zh ? '完整引擎按需就绪' : 'Full engine ready on demand'}</text>
    </g>

    <g transform="translate(966 300)">
      <rect width="162" height="26" rx="13" fill="${dark ? '#1A2233' : '#F1F4FA'}" stroke="${line}"/>
      <circle cx="14" cy="13" r="8" fill="none" stroke="#4B67B4" opacity=".45"/>
      <text x="28" y="16" fill="${phoneDim}" font-family="${FONT}" font-size="8">${zh ? '给锦囊发消息…' : 'Message Jinang…'}</text>
      <circle cx="147" cy="13" r="8" fill="#4B67B4"/>
      <path d="M144 13h6m-2.4-2.4 2.4 2.4-2.4 2.4" fill="none" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </g>

  ${whale(852, 20, 1.05)}
  <g transform="translate(838 300)">
    <rect width="94" height="26" rx="13" fill="${dark ? '#1B2338' : '#FFFFFF'}" stroke="${chipLine}"/>
    <text x="47" y="17" text-anchor="middle" fill="${dark ? '#BFD0FF' : '#4B67B4'}" font-family="${MONO}" font-size="10">300ms ready</text>
  </g>
</svg>`;
}

function showcaseEngines(dark) {
  const bg = dark ? '#10151F' : '#F7F9FE';
  const panel = dark ? '#171E2B' : '#FFFFFF';
  const ink = dark ? '#EEF1F8' : '#14182A';
  const dim = dark ? '#A8B4D2' : '#5A6278';
  const faint = dark ? '#7C89A8' : '#7A8194';
  const line = dark ? '#2A3552' : '#DFE4F2';
  const codeBg = dark ? '#0A0D14' : '#141824';
  const codeInk = '#D7E1FF';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420" role="img" aria-labelledby="t d">
  <title id="t">Two engines, one protocol</title>
  <desc id="d">An in-process TypeScript light engine for instant replies, and an on-demand proot engine with Ubuntu, Python and Office.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${dark ? '#0B101C' : '#EEF2FB'}"/></linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#4B67B4"/><stop offset="1" stop-color="#7AAAFF"/></linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#8FA2D6" stroke-opacity="${dark ? '.06' : '.09'}"/></pattern>
  </defs>
  <rect width="1200" height="420" rx="28" fill="url(#bg)"/>
  <rect width="1200" height="420" rx="28" fill="url(#grid)"/>

  <g transform="translate(56 44)">
    <rect width="520" height="332" rx="24" fill="${panel}" stroke="${line}"/>
    <rect x="26" y="26" width="92" height="26" rx="13" fill="#4B67B4"/>
    <text x="72" y="44" text-anchor="middle" fill="#FFFFFF" font-family="${FONT}" font-size="11" font-weight="600">LIGHT ENGINE</text>
    <text x="26" y="104" fill="${ink}" font-family="${FONT}" font-size="38" font-weight="750">300ms</text>
    <text x="26" y="128" fill="${faint}" font-family="${MONO}" font-size="11">IN-PROCESS · NO WEBSOCKET</text>

    <g font-family="${FONT}" font-size="12" fill="${dim}">
      <circle cx="32" cy="154" r="4" fill="#1F9D63"/><text x="44" y="158">Chat, streaming and thinking</text>
      <circle cx="32" cy="180" r="4" fill="#1F9D63"/><text x="44" y="184">Tools, approvals and questions</text>
      <circle cx="32" cy="206" r="4" fill="#1F9D63"/><text x="44" y="210">docx / xlsx + image generation</text>
    </g>

    <g transform="translate(300 88)">
      <rect width="188" height="196" rx="26" fill="${dark ? '#11161F' : '#F8F9FD'}" stroke="${line}"/>
      <rect x="12" y="14" width="164" height="18" rx="9" fill="${dark ? '#1A2233' : '#EEF1F8'}"/>
      <rect x="12" y="44" width="112" height="34" rx="10" fill="${dark ? '#1A2A44' : '#EDF3FE'}"/>
      <rect x="12" y="86" width="150" height="46" rx="10" fill="${dark ? '#151B26' : '#FFFFFF'}" stroke="${line}"/>
      <rect x="20" y="96" width="110" height="6" rx="3" fill="${dark ? '#2A3552' : '#DCE3F1'}"/>
      <rect x="20" y="108" width="88" height="6" rx="3" fill="${dark ? '#2A3552' : '#DCE3F1'}"/>
      <rect x="20" y="120" width="52" height="7" rx="3.5" fill="#4B67B4" opacity=".7"/>
      <rect x="12" y="142" width="164" height="32" rx="9" fill="${dark ? '#2A2318' : '#FFF8E8'}" stroke="${dark ? '#5D4A28' : '#EBCF98'}"/>
      <rect x="12" y="182" width="164" height="8" rx="4" fill="${dark ? '#1A2233' : '#EEF1F8'}"/>
    </g>
  </g>

  <g transform="translate(624 44)">
    <rect width="520" height="332" rx="24" fill="${panel}" stroke="${line}"/>
    <rect x="26" y="26" width="92" height="26" rx="13" fill="${dark ? '#2A2318' : '#FFF3DD'}"/>
    <text x="72" y="44" text-anchor="middle" fill="${dark ? '#E2C07E' : '#8A5A00'}" font-family="${FONT}" font-size="11" font-weight="600">PROOT ENGINE</text>
    <text x="26" y="100" fill="${ink}" font-family="${FONT}" font-size="26" font-weight="700">Ubuntu 24.04</text>
    <text x="26" y="126" fill="${faint}" font-family="${MONO}" font-size="11">PYTHON 3.12 · NODE 24 · ON DEMAND</text>

    <g transform="translate(26 150)">
      <rect width="200" height="140" rx="16" fill="${codeBg}"/>
      <text x="16" y="26" fill="#8B97B5" font-family="${MONO}" font-size="10">$ python3 analyze.py</text>
      <text x="16" y="48" fill="${codeInk}" font-family="${MONO}" font-size="10">rows: 1284  ok</text>
      <text x="16" y="70" fill="#7EE787" font-family="${MONO}" font-size="10">✓ report.xlsx</text>
      <text x="16" y="92" fill="#7EE787" font-family="${MONO}" font-size="10">✓ summary.pptx</text>
      <text x="16" y="114" fill="#8B97B5" font-family="${MONO}" font-size="10">$ dsh web :8787</text>
      <circle cx="20" cy="126" r="3" fill="#4ADE80"/>
      <text x="28" y="129" fill="#A9BBE4" font-family="${MONO}" font-size="8.5">bridge ready</text>
    </g>

    <g transform="translate(248 150)">
      <rect width="244" height="140" rx="16" fill="${dark ? '#11161F' : '#F8F9FD'}" stroke="${line}"/>
      <text x="16" y="28" fill="${ink}" font-family="${FONT}" font-size="13" font-weight="600">Office on device</text>
      <rect x="16" y="42" width="212" height="30" rx="8" fill="${dark ? '#151B26' : '#FFFFFF'}" stroke="${line}"/>
      <text x="26" y="61" fill="${dim}" font-family="${MONO}" font-size="9">report.xlsx</text>
      <rect x="16" y="80" width="212" height="30" rx="8" fill="${dark ? '#151B26' : '#FFFFFF'}" stroke="${line}"/>
      <text x="26" y="99" fill="${dim}" font-family="${MONO}" font-size="9">summary.pptx</text>
      <rect x="16" y="118" width="212" height="8" rx="4" fill="${dark ? '#1A2233' : '#EEF1F8'}"/>
    </g>
  </g>

  <g transform="translate(300 380)">
    <rect width="600" height="24" rx="12" fill="${dark ? '#1B2338' : '#FFFFFF'}" stroke="${line}"/>
    <text x="300" y="16" text-anchor="middle" fill="${faint}" font-family="${MONO}" font-size="10">ONE PROTOCOL · SAME WORKSPACE · SWITCH ANYTIME</text>
  </g>
</svg>`;
}

function showcaseOffice(dark) {
  const bg = dark ? '#10151F' : '#F7F9FE';
  const panel = dark ? '#171E2B' : '#FFFFFF';
  const ink = dark ? '#EEF1F8' : '#14182A';
  const dim = dark ? '#A8B4D2' : '#5A6278';
  const faint = dark ? '#7C89A8' : '#7A8194';
  const line = dark ? '#2A3552' : '#DFE4F2';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420" role="img" aria-labelledby="t d">
  <title id="t">docx, xlsx and pptx generated on the phone</title>
  <desc id="d">The light engine writes Word and Excel files; the full engine adds PowerPoint and Python tooling.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${dark ? '#0B101C' : '#EEF2FB'}"/></linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#8FA2D6" stroke-opacity="${dark ? '.06' : '.09'}"/></pattern>
  </defs>
  <rect width="1200" height="420" rx="28" fill="url(#bg)"/>
  <rect width="1200" height="420" rx="28" fill="url(#grid)"/>

  <g transform="translate(70 54)">
    <rect width="330" height="52" rx="26" fill="${dark ? '#1A2A44' : '#EDF3FE'}"/>
    <text x="24" y="33" fill="${ink}" font-family="${FONT}" font-size="15">Turn notes into a weekly report.</text>
    <circle cx="300" cy="26" r="15" fill="#4B67B4"/>
    <path d="M294 26h12m-5-5 5 5-5 5" fill="none" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </g>

  <g transform="translate(70 140)">
    <g transform="rotate(-5 0 120)">
      <rect width="300" height="220" rx="18" fill="${panel}" stroke="${line}"/>
      <rect x="22" y="22" width="54" height="22" rx="6" fill="#E4EDFD"/>
      <text x="49" y="37" text-anchor="middle" fill="#2F55A8" font-family="${MONO}" font-size="10" font-weight="700">DOCX</text>
      <text x="22" y="72" fill="${ink}" font-family="${FONT}" font-size="15" font-weight="650">weekly.docx</text>
      <rect x="22" y="86" width="240" height="7" rx="3.5" fill="${dark ? '#2A3552' : '#E7EBF5'}"/>
      <rect x="22" y="102" width="214" height="7" rx="3.5" fill="${dark ? '#2A3552' : '#E7EBF5'}"/>
      <rect x="22" y="118" width="228" height="7" rx="3.5" fill="${dark ? '#2A3552' : '#E7EBF5'}"/>
      <rect x="22" y="134" width="168" height="7" rx="3.5" fill="${dark ? '#2A3552' : '#E7EBF5'}"/>
      <rect x="22" y="162" width="240" height="34" rx="8" fill="${dark ? '#151B26' : '#F7F8FC'}" stroke="${line}"/>
      <text x="34" y="184" fill="${faint}" font-family="${MONO}" font-size="9">created on device · 9.6 KB</text>
    </g>
  </g>

  <g transform="translate(340 110)">
    <rect width="330" height="250" rx="20" fill="${panel}" stroke="${line}"/>
    <rect x="24" y="22" width="54" height="22" rx="6" fill="#DFF3E8"/>
    <text x="51" y="37" text-anchor="middle" fill="#147A45" font-family="${MONO}" font-size="10" font-weight="700">XLSX</text>
    <text x="24" y="72" fill="${ink}" font-family="${FONT}" font-size="15" font-weight="650">report.xlsx</text>
    <g transform="translate(24 88)" stroke="${line}">
      <rect width="282" height="118" rx="8" fill="${dark ? '#151B26' : '#FFFFFF'}"/>
      <path d="M0 30H282M0 60H282M0 88H282M70 0V118M150 0V118M226 0V118" fill="none"/>
    </g>
    <g font-family="${MONO}" font-size="9" fill="${dim}">
      <text x="36" y="108">item</text><text x="82" y="108">qty</text><text x="162" y="108">price</text><text x="238" y="108">sum</text>
      <text x="36" y="138">taxi</text><text x="82" y="138">3</text><text x="162" y="138">56.5</text><text x="238" y="138">169.5</text>
      <text x="36" y="168">meal</text><text x="82" y="168">2</text><text x="162" y="168">88.0</text><text x="238" y="168">176.0</text>
      <text x="36" y="196">total</text><text x="238" y="196">345.5</text>
    </g>
  </g>

  <g transform="translate(720 150)">
    <g transform="rotate(4 160 120)">
      <rect width="330" height="230" rx="20" fill="${panel}" stroke="${line}"/>
      <rect x="24" y="22" width="54" height="22" rx="6" fill="#FCE8DD"/>
      <text x="51" y="37" text-anchor="middle" fill="#A24A14" font-family="${MONO}" font-size="10" font-weight="700">PPTX</text>
      <text x="24" y="72" fill="${ink}" font-family="${FONT}" font-size="15" font-weight="650">summary.pptx</text>
      <rect x="24" y="92" width="282" height="112" rx="10" fill="${dark ? '#151B26' : '#F7F8FC'}" stroke="${line}"/>
      <rect x="44" y="112" width="128" height="9" rx="4.5" fill="#4B67B4" opacity=".8"/>
      <rect x="44" y="130" width="96" height="7" rx="3.5" fill="${dark ? '#2A3552' : '#DDE3F1'}"/>
      <rect x="44" y="146" width="112" height="7" rx="3.5" fill="${dark ? '#2A3552' : '#DDE3F1'}"/>
      <rect x="200" y="112" width="86" height="72" rx="8" fill="#4B67B4" opacity=".18"/>
      <circle cx="243" cy="148" r="18" fill="#4B67B4" opacity=".55"/>
    </g>
  </g>

  <g transform="translate(70 388)">
    <rect width="1060" height="24" rx="12" fill="${dark ? '#1B2338' : '#FFFFFF'}" stroke="${line}"/>
    <text x="530" y="16" text-anchor="middle" fill="${faint}" font-family="${MONO}" font-size="10">WORD · EXCEL · POWERPOINT — WRITTEN, READ AND DELIVERED ON THE PHONE</text>
  </g>
</svg>`;
}

function showcaseHosts(dark) {  const bg = dark ? '#10151F' : '#F7F9FE';
  const panel = dark ? '#171E2B' : '#FFFFFF';
  const ink = dark ? '#EEF1F8' : '#14182A';
  const dim = dark ? '#A8B4D2' : '#5A6278';
  const faint = dark ? '#7C89A8' : '#7A8194';
  const line = dark ? '#2A3552' : '#DFE4F2';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="420" viewBox="0 0 1200 420" role="img" aria-labelledby="t d">
  <title id="t">Phone host and computer host on the same Wi-Fi</title>
  <desc id="d">Run the engine on the phone, or connect to a computer running dsh over the LAN.</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg}"/><stop offset="1" stop-color="${dark ? '#0B101C' : '#EEF2FB'}"/></linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse"><path d="M40 0H0V40" fill="none" stroke="#8FA2D6" stroke-opacity="${dark ? '.06' : '.09'}"/></pattern>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#4B67B4" stop-opacity="${dark ? '.4' : '.18'}"/><stop offset="1" stop-color="#4B67B4" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="1200" height="420" rx="28" fill="url(#bg)"/>
  <rect width="1200" height="420" rx="28" fill="url(#grid)"/>
  <circle cx="600" cy="200" r="260" fill="url(#glow)"/>

  <g transform="translate(470 48)">
    <rect width="260" height="300" rx="34" fill="${panel}" stroke="${line}"/>
    <rect x="14" y="14" width="232" height="272" rx="24" fill="${dark ? '#11161F' : '#F8F9FD'}"/>
    <rect x="95" y="22" width="70" height="8" rx="4" fill="#0A0D14"/>
    <g transform="translate(30 46)">
      <rect width="30" height="30" rx="9" fill="#4B67B4"/>
      <path d="M15 6c.8 5.4 1.8 6.4 7.2 7.2-5.4.8-6.4 1.8-7.2 7.2-.8-5.4-1.8-6.4-7.2-7.2 5.4-.8 6.4-1.8 7.2-7.2Z" fill="#FFFFFF"/>
      <text x="40" y="20" fill="${ink}" font-family="${FONT}" font-size="14" font-weight="650">Jinang</text>
    </g>
    <g transform="translate(30 94)"><rect width="200" height="38" rx="12" fill="${dark ? '#1A2A44' : '#EDF3FE'}"/><text x="12" y="23" fill="${ink}" font-family="${FONT}" font-size="11">Continue on this phone.</text></g>
    <g transform="translate(30 146)"><rect width="200" height="70" rx="12" fill="${dark ? '#151B26' : '#FFFFFF'}" stroke="${line}"/><text x="14" y="26" fill="${dim}" font-family="${FONT}" font-size="10">Host</text><text x="14" y="46" fill="${ink}" font-family="${FONT}" font-size="12" font-weight="600">工作室 Mac mini</text><circle cx="184" cy="22" r="5" fill="#1F9D63"/></g>
    <g transform="translate(30 230)"><rect width="200" height="36" rx="18" fill="${dark ? '#1A2233' : '#F1F4FA'}" stroke="${line}"/><text x="16" y="23" fill="${dim}" font-family="${FONT}" font-size="10">Switch host</text><circle cx="181" cy="18" r="11" fill="#4B67B4"/><path d="M177 18h8m-3-3 3 3-3 3" fill="none" stroke="#FFF" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></g>
  </g>

  <g transform="translate(170 130)">
    <rect width="230" height="160" rx="18" fill="${panel}" stroke="${line}"/>
    <rect x="18" y="18" width="194" height="100" rx="8" fill="${dark ? '#0A0D14' : '#EEF1F8'}"/>
    <text x="28" y="44" fill="#7EE787" font-family="${MONO}" font-size="10">$ dsh web</text>
    <text x="28" y="66" fill="${dark ? '#8B97B5' : '#6B7280'}" font-family="${MONO}" font-size="9">127.0.0.1:8787</text>
    <rect x="18" y="126" width="194" height="16" rx="8" fill="${dark ? '#1A2233' : '#F1F4FA'}"/>
    <text x="115" y="138" text-anchor="middle" fill="${faint}" font-family="${MONO}" font-size="8">DESKTOP HOST · LAN</text>
  </g>

  <g transform="translate(800 130)">
    <rect width="230" height="160" rx="18" fill="${panel}" stroke="${line}"/>
    <circle cx="70" cy="80" r="34" fill="${dark ? '#1A2A44' : '#EDF3FE'}"/>
    <path d="M52 80c0-10 8-17 18-17s18 7 18 17-8 15-18 15-18-5-18-15Z" fill="#4B67B4"/>
    <path d="M86 72c3-4 7-5 11-4-1 4-4 7-8 8Z" fill="#4B67B4"/>
    <circle cx="64" cy="78" r="2" fill="#0F1115"/>
    <text x="118" y="70" fill="${ink}" font-family="${FONT}" font-size="13" font-weight="600">Deepy</text>
    <text x="118" y="88" fill="${faint}" font-family="${MONO}" font-size="8.5">12-state pet</text>
    <rect x="118" y="100" width="82" height="20" rx="10" fill="${dark ? '#2A2318' : '#FFF3DD'}"/>
    <text x="159" y="114" text-anchor="middle" fill="${dark ? '#E2C07E' : '#8A5A00'}" font-family="${MONO}" font-size="8">THINKING</text>
  </g>

  <g stroke="${dark ? '#3C4E74' : '#B9C6E2'}" stroke-width="2" stroke-dasharray="5 7" fill="none">
    <path d="M400 210H470"/>
    <path d="M730 210H800"/>
  </g>
  <g fill="#1F9D63">
    <circle cx="436" cy="210" r="5"/><circle cx="766" cy="210" r="5"/>
  </g>

  <g transform="translate(300 366)">
    <rect width="600" height="30" rx="15" fill="${dark ? '#1B2338' : '#FFFFFF'}" stroke="${line}"/>
    <text x="300" y="19" text-anchor="middle" fill="${faint}" font-family="${MONO}" font-size="10">SAME WI-FI · SCAN OR TYPE THE ADDRESS · RECONNECT AFTER A DROP</text>
  </g>
</svg>`;
}

function socialSvg(dark) {
  const bg1 = dark ? '#182139' : '#F7F9FE';
  const bg2 = dark ? '#0B101C' : '#E8EDF9';
  const ink = dark ? '#F2F5FF' : '#14182A';
  const dim = dark ? '#A8B4D2' : '#555D72';
  const faint = dark ? '#7C89A8' : '#7A8194';
  const line = dark ? '#2A3552' : '#DDE3F1';
  const panel = dark ? '#11161F' : '#F8F9FD';
  const phoneInk = dark ? '#E6E8EB' : '#161B2A';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="640" viewBox="0 0 1280 640" role="img" aria-labelledby="t d">
  <title id="t">锦囊 · dsh-palm — 把 DeepSeek Harness 装进口袋</title>
  <desc id="d">Android 本机宿主：轻引擎 300ms 秒开，需要真 Linux 时按需 proot。</desc>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse"><path d="M48 0H0V48" fill="none" stroke="#8FA2D6" stroke-opacity="${dark ? '.07' : '.10'}"/></pattern>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#4B67B4" stop-opacity="${dark ? '.55' : '.24'}"/><stop offset="1" stop-color="#4B67B4" stop-opacity="0"/></radialGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#414A63"/><stop offset="1" stop-color="#161B26"/></linearGradient>
  </defs>
  <rect width="1280" height="640" fill="url(#bg)"/>
  <rect width="1280" height="640" fill="url(#grid)"/>
  <circle cx="1120" cy="40" r="300" fill="url(#glow)"/>
  <circle cx="900" cy="640" r="240" fill="url(#glow)" opacity=".5"/>

  ${pouchIcon(80, 92, 118, dark)}
  <text x="222" y="166" fill="${ink}" font-family="${FONT}" font-size="66" font-weight="700" letter-spacing="2">锦囊</text>
  <text x="226" y="198" fill="${faint}" font-family="${MONO}" font-size="15" letter-spacing="8">DSH PALM</text>

  <text x="82" y="300" fill="${ink}" font-family="${FONT}" font-size="40" font-weight="650">把 DeepSeek Harness</text>
  <text x="82" y="352" fill="${ink}" font-family="${FONT}" font-size="40" font-weight="650">装进口袋</text>
  <text x="84" y="408" fill="${dim}" font-family="${FONT}" font-size="19">轻引擎 300ms 秒开 · 需要真 Linux 时按需 proot</text>

  <g transform="translate(82 458)">
    <rect width="126" height="32" rx="16" fill="${dark ? '#1B2338' : '#FFFFFF'}" stroke="${line}"/>
    <text x="63" y="21" text-anchor="middle" fill="${dark ? '#BFD0FF' : '#4B67B4'}" font-family="${MONO}" font-size="12">Android arm64</text>
    <rect x="138" width="92" height="32" rx="16" fill="${dark ? '#1B2338' : '#FFFFFF'}" stroke="${line}"/>
    <text x="184" y="21" text-anchor="middle" fill="${dark ? '#BFD0FF' : '#4B67B4'}" font-family="${MONO}" font-size="12">双引擎</text>
    <rect x="242" width="96" height="32" rx="16" fill="${dark ? '#1B2338' : '#FFFFFF'}" stroke="${line}"/>
    <text x="290" y="21" text-anchor="middle" fill="${dark ? '#BFD0FF' : '#4B67B4'}" font-family="${MONO}" font-size="12">AGPL-3.0</text>
  </g>

  <g transform="translate(906 62)">
    <rect width="272" height="516" rx="46" fill="url(#frame)"/>
    <rect x="8" y="8" width="256" height="500" rx="38" fill="${panel}"/>
    <rect x="98" y="18" width="84" height="9" rx="4.5" fill="#0A0D14"/>

    <g transform="translate(30 52)">
      <rect width="34" height="34" rx="10" fill="#4B67B4"/>
      <path d="M17 7c.9 6.2 2.1 7.4 8.3 8.3-6.2.9-7.4 2.1-8.3 8.3-.9-6.2-2.1-7.4-8.3-8.3 6.2-.9 7.4-2.1 8.3-8.3Z" fill="#FFFFFF"/>
      <text x="46" y="22" fill="${phoneInk}" font-family="${FONT}" font-size="15" font-weight="650">锦囊</text>
      <rect x="160" y="4" width="66" height="26" rx="13" fill="${dark ? '#1B2A44' : '#EDF3FE'}"/>
      <circle cx="174" cy="17" r="4" fill="#1F9D63"/>
      <text x="183" y="22" fill="#4B67B4" font-family="${FONT}" font-size="11">轻引擎</text>
    </g>

    <g transform="translate(30 114)">
      <rect width="212" height="52" rx="16" fill="${dark ? '#1A2A44' : '#EDF3FE'}"/>
      <text x="14" y="22" fill="${phoneInk}" font-family="${FONT}" font-size="12">把会议纪要整理成周报，</text>
      <text x="14" y="40" fill="${phoneInk}" font-family="${FONT}" font-size="12">并生成 docx。</text>
    </g>

    <g transform="translate(30 186)">
      <rect width="236" height="64" rx="15" fill="${dark ? '#151B26' : '#FFFFFF'}" stroke="${line}"/>
      <text x="14" y="24" fill="${dim}" font-family="${FONT}" font-size="12">已生成周报，包含本周进展、</text>
      <text x="14" y="43" fill="${dim}" font-family="${FONT}" font-size="12">风险与下周计划。</text>
      <rect x="14" y="50" width="86" height="8" rx="4" fill="${dark ? '#1D2B45' : '#E4EDFD'}"/>
    </g>

    <g transform="translate(30 270)">
      <rect width="236" height="64" rx="15" fill="${dark ? '#2A2318' : '#FFF8E8'}" stroke="${dark ? '#5D4A28' : '#EBCF98'}"/>
      <text x="14" y="22" fill="${dark ? '#E2C07E' : '#7A5200'}" font-family="${FONT}" font-size="11" font-weight="600">需要确认 · 写入工作区文件</text>
      <rect x="14" y="32" width="112" height="9" rx="4.5" fill="${dark ? '#3A3326' : '#F3E2BE'}"/>
      <rect x="14" y="47" width="46" height="12" rx="6" fill="#4B67B4"/>
      <rect x="66" y="47" width="38" height="12" rx="6" fill="none" stroke="${dark ? '#5D4A28' : '#EBCF98'}"/>
    </g>

    <g transform="translate(30 358)">
      <rect width="236" height="64" rx="15" fill="${dark ? '#151B26' : '#FFFFFF'}" stroke="${line}"/>
      <text x="14" y="24" fill="${dim}" font-family="${FONT}" font-size="12">完整引擎按需就绪：</text>
      <text x="14" y="44" fill="#4B67B4" font-family="${MONO}" font-size="11">$ dsh web :8787</text>
    </g>

    <g transform="translate(30 452)">
      <rect width="236" height="38" rx="19" fill="${dark ? '#1A2233' : '#F1F4FA'}" stroke="${line}"/>
      <text x="18" y="24" fill="${dim}" font-family="${FONT}" font-size="11">给锦囊发消息…</text>
      <circle cx="212" cy="19" r="12" fill="#4B67B4"/>
      <path d="M207 19h10m-4-4 4 4-4 4" fill="none" stroke="#FFFFFF" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </g>

  ${whale(780, 34, 1.35)}
</svg>`;
}

async function writeSvg(name, content) {
  await mkdir(site, { recursive: true });
  await writeFile(path.join(site, name), content, 'utf8');
}

async function main() {
  // 桌宠 sprite sheets（供落地页 CSS 动画）
  for (const pet of ['deepy', 'maid']) {
    await mkdir(path.join(petsOut, pet), { recursive: true });
    for (const state of STATES) {
      await copyFile(
        path.join(root, `app/assets/pets/${pet}/sheets/${state}.png`),
        path.join(petsOut, pet, `${state}.png`),
      );
    }
    await mkdir(path.join(petsOut, 'preview'), { recursive: true });
    for (const state of ['idle', 'thinking', 'working', 'attention', 'juggling', 'sleeping']) {
      const source = path.join(root, `app/assets/pets/${pet}/sheets/${state}.png`);
      const frame = await sharp(source)
        .extract({ left: 256, top: 0, width: 128, height: 128 })
        .resize(256, 256, { kernel: 'nearest' })
        .png({ compressionLevel: 9 })
        .toBuffer();
      await writeFile(path.join(petsOut, 'preview', `${pet}-${state}.png`), frame);
    }
  }

  // README hero（明暗 × 中英）
  await writeSvg('hero-zh-light.svg', heroSvg('zh', false));
  await writeSvg('hero-zh-dark.svg', heroSvg('zh', true));
  await writeSvg('hero-en-light.svg', heroSvg('en', false));
  await writeSvg('hero-en-dark.svg', heroSvg('en', true));

  // README 功能展示图（明暗共用同一套图，双语文案走 README）
  await writeSvg('showcase-engines-light.svg', showcaseEngines(false));
  await writeSvg('showcase-engines-dark.svg', showcaseEngines(true));
  await writeSvg('showcase-office-light.svg', showcaseOffice(false));
  await writeSvg('showcase-office-dark.svg', showcaseOffice(true));
  await writeSvg('showcase-hosts-light.svg', showcaseHosts(false));
  await writeSvg('showcase-hosts-dark.svg', showcaseHosts(true));

  // GitHub Social preview（1280×640）
  const social = socialSvg(true);
  await writeSvg('social-preview.svg', social);
  await writeFile(
    path.join(site, 'social-preview.png'),
    await sharp(Buffer.from(social), { density: 200 }).resize(1280, 640).png({ compressionLevel: 9 }).toBuffer(),
  );

  console.log('site assets: done');
}

await main();
