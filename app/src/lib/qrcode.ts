/**
 * 轻量、标准的 ISO/IEC 18004 二维码 (QR Code) 矩阵生成器。
 * 纯 TypeScript 实现，零第三方库依赖，输出布尔值二维矩阵。
 */

// Galois Field GF(256) 运算表
const EXP_TABLE = new Uint8Array(512);
const LOG_TABLE = new Uint8Array(256);

(function initGaloisField() {
  let val = 1;
  for (let i = 0; i < 255; i++) {
    EXP_TABLE[i] = val;
    EXP_TABLE[i + 255] = val;
    LOG_TABLE[val] = i;
    val <<= 1;
    if (val & 0x100) {
      val ^= 0x11d; // x^8 + x^4 + x^3 + x^2 + 1
    }
  }
})();

function gfMul(x: number, y: number): number {
  if (x === 0 || y === 0) return 0;
  return EXP_TABLE[LOG_TABLE[x]! + LOG_TABLE[y]!] ?? 0;
}

function rsGeneratorPoly(degree: number): Uint8Array {
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i++) {
    const next = new Uint8Array(poly.length + 1);
    const factor = EXP_TABLE[i]!;
    for (let j = 0; j < poly.length; j++) {
      next[j] = (next[j] ?? 0) ^ gfMul(poly[j] ?? 0, factor);
      next[j + 1] = (next[j + 1] ?? 0) ^ poly[j]!;
    }
    poly = next;
  }
  return poly;
}

function rsCalculateEcc(msg: Uint8Array, numEcc: number): Uint8Array {
  const gen = rsGeneratorPoly(numEcc);
  const ecc = new Uint8Array(numEcc);
  for (let i = 0; i < msg.length; i++) {
    const factor = (msg[i] ?? 0) ^ (ecc[0] ?? 0);
    ecc.copyWithin(0, 1);
    ecc[numEcc - 1] = 0;
    for (let j = 0; j < numEcc; j++) {
      ecc[j] = (ecc[j] ?? 0) ^ gfMul(gen[j] ?? 0, factor);
    }
  }
  return ecc;
}

// 支持 Version 1 到 Version 8，纠错等级 M（15% 纠错）
interface QrVersionInfo {
  version: number;
  size: number;
  dataBytes: number;
  eccBytes: number;
  alignments: number[];
}

const QR_VERSIONS: QrVersionInfo[] = [
  { version: 1, size: 21, dataBytes: 16, eccBytes: 10, alignments: [] },
  { version: 2, size: 25, dataBytes: 28, eccBytes: 16, alignments: [6, 18] },
  { version: 3, size: 29, dataBytes: 44, eccBytes: 26, alignments: [6, 22] },
  { version: 4, size: 33, dataBytes: 64, eccBytes: 36, alignments: [6, 26] },
  { version: 5, size: 37, dataBytes: 86, eccBytes: 48, alignments: [6, 30] },
  { version: 6, size: 41, dataBytes: 108, eccBytes: 64, alignments: [6, 34] },
  { version: 7, size: 45, dataBytes: 124, eccBytes: 72, alignments: [6, 22, 38] },
  { version: 8, size: 49, dataBytes: 154, eccBytes: 88, alignments: [6, 24, 42] },
];

export function generateQrMatrix(text: string): boolean[][] {
  const encoder = new TextEncoder();
  const utf8 = encoder.encode(text);

  // 选用最小容纳得下的版本
  let vInfo = QR_VERSIONS[0]!;
  let found = false;
  for (const v of QR_VERSIONS) {
    // 8-bit 模式：模式 4 位 + 长度 8 位 + 数据
    if (utf8.length + 2 <= v.dataBytes) {
      vInfo = v;
      found = true;
      break;
    }
  }
  if (!found) {
    vInfo = QR_VERSIONS[QR_VERSIONS.length - 1]!;
  }

  // 1. 构建数据位流
  const bits: number[] = [];
  function pushBits(val: number, len: number) {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  }

  // 模式指示符 (0100 = 8-bit Byte)
  pushBits(0b0100, 4);
  // 字符计数 (8 位对于 Version 1-9)
  const len = Math.min(utf8.length, vInfo.dataBytes - 2);
  pushBits(len, 8);
  for (let i = 0; i < len; i++) {
    pushBits(utf8[i]!, 8);
  }

  // 终止符 (最多 4 个 0)
  const maxDataBits = vInfo.dataBytes * 8;
  const termLen = Math.min(4, maxDataBits - bits.length);
  pushBits(0, termLen);

  // 补齐到 8 的倍数
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // 填充交替垫字 (0xEC, 0x11)
  const padPatterns = [0xec, 0x11];
  let padIdx = 0;
  while (bits.length < maxDataBits) {
    pushBits(padPatterns[padIdx % 2]!, 8);
    padIdx++;
  }

  // 转换为字节
  const dataBytes = new Uint8Array(vInfo.dataBytes);
  for (let i = 0; i < vInfo.dataBytes; i++) {
    let byteVal = 0;
    for (let b = 0; b < 8; b++) {
      byteVal = (byteVal << 1) | bits[i * 8 + b]!;
    }
    dataBytes[i] = byteVal;
  }

  // 2. Reed-Solomon 纠错码
  const eccBytes = rsCalculateEcc(dataBytes, vInfo.eccBytes);

  // 完整数据序列
  const finalBytes = new Uint8Array(vInfo.dataBytes + vInfo.eccBytes);
  finalBytes.set(dataBytes, 0);
  finalBytes.set(eccBytes, vInfo.dataBytes);

  const finalBits: number[] = [];
  for (let i = 0; i < finalBytes.length; i++) {
    for (let b = 7; b >= 0; b--) {
      finalBits.push((finalBytes[i]! >> b) & 1);
    }
  }

  // 3. 构建矩阵 (0: 白色/未占用, 1: 黑色, -1: 功能区白, 2: 功能区黑)
  const N = vInfo.size;
  const matrix: number[][] = Array.from({ length: N }, () => Array(N).fill(0));
  const isFunction: boolean[][] = Array.from({ length: N }, () => Array(N).fill(false));

  function setFunction(r: number, c: number, val: boolean) {
    if (r >= 0 && r < N && c >= 0 && c < N) {
      matrix[r]![c] = val ? 1 : 0;
      isFunction[r]![c] = true;
    }
  }

  // 寻像图案 (Finder Patterns) 7x7 位于三个角
  function drawFinder(row: number, col: number) {
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        const nr = row + r;
        const nc = col + c;
        if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
        if (r >= 0 && r <= 6 && c >= 0 && c <= 6) {
          if (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4)) {
            setFunction(nr, nc, true);
          } else {
            setFunction(nr, nc, false);
          }
        } else {
          // 分隔符 (白框)
          setFunction(nr, nc, false);
        }
      }
    }
  }

  drawFinder(0, 0);
  drawFinder(0, N - 7);
  drawFinder(N - 7, 0);

  // 定位图案 (Timing Patterns)
  for (let i = 8; i < N - 8; i++) {
    const val = i % 2 === 0;
    setFunction(6, i, val);
    setFunction(i, 6, val);
  }

  // 对齐图案 (Alignment Patterns)
  if (vInfo.alignments.length > 0) {
    for (const r of vInfo.alignments) {
      for (const c of vInfo.alignments) {
        if (isFunction[r]![c]) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isBlack = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFunction(r + dr, c + dc, isBlack);
          }
        }
      }
    }
  }

  // 暗模块
  setFunction(4 * vInfo.version + 9, 8, true);

  // 格式信息保留区
  for (let i = 0; i < 9; i++) {
    if (i !== 6) {
      isFunction[8]![i] = true;
      isFunction[i]![8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    isFunction[8]![N - 1 - i] = true;
    isFunction[N - 1 - i]![8] = true;
  }

  // 4. 填充数据位 (避开功能区)
  let bitIdx = 0;
  let upward = true;
  for (let right = N - 1; right > 0; right -= 2) {
    if (right === 6) right--; // 跳过垂直定时线
    for (let vert = 0; vert < N; vert++) {
      const r = upward ? N - 1 - vert : vert;
      for (let c = right; c >= right - 1; c--) {
        if (!isFunction[r]![c]) {
          const bit = bitIdx < finalBits.length ? finalBits[bitIdx]! : 0;
          bitIdx++;
          // 应用掩码 0: (row + col) % 2 === 0
          const mask = (r + c) % 2 === 0;
          matrix[r]![c] = bit ^ (mask ? 1 : 0);
        }
      }
    }
    upward = !upward;
  }

  // 5. 写入格式信息 (纠错 M (00) + 掩码 0 (000) => 格式位序列带 BCH: 101010000010010)
  const formatBits = [1, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0];
  // 顶左角
  const pos1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8],
  ];
  for (let i = 0; i < 15; i++) {
    const pair = pos1[i];
    if (pair) {
      matrix[pair[0]!]![pair[1]!] = formatBits[i] ?? 0;
    }
  }
  // 边角
  for (let i = 0; i < 7; i++) {
    matrix[N - 1 - i]![8] = formatBits[i]!;
  }
  for (let i = 7; i < 15; i++) {
    matrix[8]![N - 15 + i] = formatBits[i]!;
  }

  // 返回最终布尔矩阵
  return matrix.map((row) => row.map((cell) => cell === 1));
}
