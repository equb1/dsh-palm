// 锦囊 / dsh-palm 品牌图标生成器
//
// 依赖（不写进 package.json，按需安装）：
//   npm install --no-save --no-package-lock sharp qrcode
//
// 运行：
//   node scripts/build-icons.mjs
//
// 产物：
//   site/assets/icon.svg / icon-512.png / icon-192.png / apple-touch-icon.png / favicon-32.png
//   site/assets/download-qr.png
//   app/assets/icon.png / adaptive-icon.png / adaptive-icon-monochrome.png / splash-icon.png
//   app/android/app/src/main/res/mipmap-*/ic_launcher* / ic_launcher_foreground
//   app/android/app/src/main/res/drawable-*/splashscreen_logo.png

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import QRCode from 'qrcode';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = path.join(root, 'app/android/app/src/main/res');
const siteAssets = path.join(root, 'site/assets');
const appAssets = path.join(root, 'app/assets');

const BRAND_BG = '#141C31';

const POUCH_PATH = `M208 158
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

const STAR_PATH = `M256 222
  C 262 264, 270 274, 313 282
  C 270 290, 262 300, 256 342
  C 250 300, 242 290, 199 282
  C 242 274, 250 264, 256 222 Z`;

const SMALL_STARS = `
  <path d="M182 240 C 186 257, 191 262, 208 266 C 191 270, 186 275, 182 292 C 178 275, 173 270, 156 266 C 173 262, 178 257, 182 240 Z" fill="#FFFFFF" opacity=".72"/>
  <path d="M336 320 C 339 332, 342 336, 355 339 C 342 342, 339 346, 336 359 C 333 346, 330 342, 317 339 C 330 336, 333 332, 336 320 Z" fill="#FFFFFF" opacity=".55"/>
  <circle cx="331" cy="210" r="5.5" fill="#FFFFFF" opacity=".5"/>
  <circle cx="174" cy="338" r="4" fill="#FFFFFF" opacity=".4"/>`;

const DEFS = `
  <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#1E2A4A"/>
    <stop offset=".55" stop-color="#141C31"/>
    <stop offset="1" stop-color="#0B101C"/>
  </linearGradient>
  <radialGradient id="glow" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#6D8CF0" stop-opacity=".55"/>
    <stop offset="1" stop-color="#6D8CF0" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="glow2" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#F2C879" stop-opacity=".22"/>
    <stop offset="1" stop-color="#F2C879" stop-opacity="0"/>
  </radialGradient>
  <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
    <path d="M40 0H0V40" fill="none" stroke="#9DB4F5" stroke-opacity=".07"/>
  </pattern>
  <linearGradient id="pouch" x1=".22" y1=".02" x2=".78" y2=".98">
    <stop offset="0" stop-color="#A6BCFF"/>
    <stop offset=".38" stop-color="#6785EC"/>
    <stop offset=".78" stop-color="#4A63BE"/>
    <stop offset="1" stop-color="#35488C"/>
  </linearGradient>
  <linearGradient id="shade" x1="0" y1="0" x2="0" y2="1">
    <stop offset=".55" stop-color="#1B2652" stop-opacity="0"/>
    <stop offset="1" stop-color="#1B2652" stop-opacity=".45"/>
  </linearGradient>
  <linearGradient id="cord" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#FFEDB8"/>
    <stop offset=".5" stop-color="#F0C979"/>
    <stop offset="1" stop-color="#C79A3F"/>
  </linearGradient>
  <linearGradient id="star" x1="0" y1="0" x2=".6" y2="1">
    <stop offset="0" stop-color="#FFFFFF"/>
    <stop offset="1" stop-color="#DCE6FF"/>
  </linearGradient>
  <filter id="soft" x="-45%" y="-45%" width="190%" height="190%">
    <feGaussianBlur stdDeviation="22"/>
  </filter>`;

const POUCH_ART = `
  <ellipse cx="256" cy="312" rx="124" ry="124" fill="#0A0F1B" opacity=".55" filter="url(#soft)"/>
  <path d="${POUCH_PATH}" fill="url(#pouch)"/>
  <path d="${POUCH_PATH}" fill="url(#shade)"/>
  <path d="${POUCH_PATH}" fill="none" stroke="#B9CBFF" stroke-opacity=".32" stroke-width="3"/>
  <path d="M194 256 C 199 216, 220 196, 248 190" fill="none" stroke="#FFFFFF" stroke-opacity=".36" stroke-width="9" stroke-linecap="round"/>
  <path d="M186 185 C 214 206, 298 206, 326 185" fill="none" stroke="url(#cord)" stroke-width="13" stroke-linecap="round"/>
  <path d="M190 194 C 219 213, 293 213, 322 194" fill="none" stroke="#5A3D11" stroke-opacity=".25" stroke-width="4" stroke-linecap="round"/>
  <path d="M250 198 C 241 216, 234 226, 226 236" fill="none" stroke="url(#cord)" stroke-width="8.5" stroke-linecap="round"/>
  <path d="M266 198 C 275 216, 282 226, 290 236" fill="none" stroke="url(#cord)" stroke-width="8.5" stroke-linecap="round"/>
  <circle cx="258" cy="196" r="9" fill="#F6D68F" stroke="#B98A33" stroke-width="2.5"/>
  <path d="${STAR_PATH}" fill="url(#star)"/>
  ${SMALL_STARS}`;

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    ${DEFS}
    <clipPath id="squircle"><rect width="512" height="512" rx="116"/></clipPath>
  </defs>
  <g clip-path="url(#squircle)">
    <rect width="512" height="512" fill="url(#bg)"/>
    <rect width="512" height="512" fill="url(#grid)"/>
    <circle cx="404" cy="82" r="170" fill="url(#glow)"/>
    <circle cx="118" cy="446" r="150" fill="url(#glow2)"/>
  </g>
  <g>${POUCH_ART}</g>
</svg>`;

const FOREGROUND_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>${DEFS}</defs>
  <g transform="translate(256 256) scale(1.1) translate(-256 -256)">
    ${POUCH_ART}
  </g>
</svg>`;

const MONOCHROME_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <g transform="translate(256 256) scale(1.1) translate(-256 -256)">
    <path d="${POUCH_PATH}" fill="#FFFFFF"/>
    <path d="M186 185 C 214 206, 298 206, 326 185" fill="none" stroke="#FFFFFF" stroke-width="13" stroke-linecap="round"/>
    <path d="M250 198 C 241 216, 234 226, 226 236" fill="none" stroke="#FFFFFF" stroke-width="8.5" stroke-linecap="round"/>
    <path d="M266 198 C 275 216, 282 226, 290 236" fill="none" stroke="#FFFFFF" stroke-width="8.5" stroke-linecap="round"/>
  </g>
</svg>`;

const STAR_PUNCH_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <g transform="translate(256 256) scale(1.1) translate(-256 -256)">
    <path d="${STAR_PATH}" fill="#FFFFFF"/>
    <path d="M182 240 C 186 257, 191 262, 208 266 C 191 270, 186 275, 182 292 C 178 275, 173 270, 156 266 C 173 262, 178 257, 182 240 Z" fill="#FFFFFF"/>
    <path d="M336 320 C 339 332, 342 336, 355 339 C 342 342, 339 346, 336 359 C 333 346, 330 342, 317 339 C 330 336, 333 332, 336 320 Z" fill="#FFFFFF"/>
    <circle cx="331" cy="210" r="7" fill="#FFFFFF"/>
    <circle cx="174" cy="338" r="6" fill="#FFFFFF"/>
  </g>
</svg>`;

async function render(svg, size, format = 'png') {
  const pipeline = sharp(Buffer.from(svg), { density: 384 }).resize(size, size, { fit: 'contain' });
  return format === 'webp'
    ? pipeline.webp({ quality: 96, alphaQuality: 100, effort: 6 }).toBuffer()
    : pipeline.png({ compressionLevel: 9 }).toBuffer();
}

async function writeBuf(file, buf) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
}

async function circleMask(size) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#FFFFFF"/></svg>`,
  );
}

async function buildSiteIcons() {
  await writeBuf(path.join(siteAssets, 'icon.svg'), Buffer.from(ICON_SVG));
  await writeBuf(path.join(siteAssets, 'icon-512.png'), await render(ICON_SVG, 512));
  await writeBuf(path.join(siteAssets, 'icon-192.png'), await render(ICON_SVG, 192));
  await writeBuf(path.join(siteAssets, 'apple-touch-icon.png'), await render(ICON_SVG, 180));
  await writeBuf(path.join(siteAssets, 'favicon-32.png'), await render(ICON_SVG, 32));

  await writeBuf(path.join(appAssets, 'icon.png'), await render(ICON_SVG, 1024));
  await writeBuf(path.join(appAssets, 'adaptive-icon.png'), await render(FOREGROUND_SVG, 1024));
  await writeBuf(path.join(appAssets, 'adaptive-icon-monochrome.png'), await renderMonochrome(1024));
  await writeBuf(path.join(appAssets, 'splash-icon.png'), await render(ICON_SVG, 1024));
}

async function renderMonochrome(size) {
  const base = await render(MONOCHROME_SVG, size);
  const punch = await render(STAR_PUNCH_SVG, size);
  return sharp(base)
    .composite([{ input: punch, blend: 'dest-out' }])
    .png()
    .toBuffer();
}

async function buildAndroidIcons() {
  const legacy = [
    ['mdpi', 48],
    ['hdpi', 72],
    ['xhdpi', 96],
    ['xxhdpi', 144],
    ['xxxhdpi', 192],
  ];
  const adaptive = [
    ['mdpi', 108],
    ['hdpi', 162],
    ['xhdpi', 216],
    ['xxhdpi', 324],
    ['xxxhdpi', 432],
  ];

  for (const [density, size] of legacy) {
    const dir = path.join(res, `mipmap-${density}`);
    const square = await render(ICON_SVG, size, 'webp');
    await writeBuf(path.join(dir, 'ic_launcher.webp'), square);

    const squarePng = await render(ICON_SVG, size);
    const round = await sharp(squarePng)
      .composite([{ input: await circleMask(size), blend: 'dest-in' }])
      .webp({ quality: 96, alphaQuality: 100 })
      .toBuffer();
    await writeBuf(path.join(dir, 'ic_launcher_round.webp'), round);
  }

  for (const [density, size] of adaptive) {
    const dir = path.join(res, `mipmap-${density}`);
    await writeBuf(path.join(dir, 'ic_launcher_foreground.png'), await render(FOREGROUND_SVG, size));
    await writeBuf(path.join(dir, 'ic_launcher_monochrome.png'), await renderMonochrome(size));
  }

  const adaptiveXml = `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/ic_launcher_background" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />
</adaptive-icon>
`;
  const anydpi = path.join(res, 'mipmap-anydpi-v26');
  await writeBuf(path.join(anydpi, 'ic_launcher.xml'), Buffer.from(adaptiveXml));
  await writeBuf(path.join(anydpi, 'ic_launcher_round.xml'), Buffer.from(adaptiveXml));
}

async function buildSplash() {
  const sizes = [
    ['mdpi', 288],
    ['hdpi', 432],
    ['xhdpi', 576],
    ['xxhdpi', 864],
    ['xxxhdpi', 1152],
  ];
  const icon = await render(ICON_SVG, 1024);
  for (const [density, size] of sizes) {
    const inner = Math.round(size * 0.62);
    const art = await sharp(icon).resize(inner, inner).toBuffer();
    const canvas = sharp({
      create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    });
    const logo = await canvas
      .composite([{ input: art, left: Math.round((size - inner) / 2), top: Math.round((size - inner) / 2) }])
      .png()
      .toBuffer();
    await writeBuf(path.join(res, `drawable-${density}`, 'splashscreen_logo.png'), logo);
  }
}

async function buildQr() {
  const target = 'https://github.com/equb1/dsh-palm/releases/latest';
  const buf = await QRCode.toBuffer(target, {
    type: 'png',
    width: 512,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: { dark: '#141C31', light: '#FFFFFF' },
  });
  await writeBuf(path.join(siteAssets, 'download-qr.png'), buf);
}

await buildSiteIcons();
await buildAndroidIcons();
await buildSplash();
await buildQr();
console.log('icons: done');
