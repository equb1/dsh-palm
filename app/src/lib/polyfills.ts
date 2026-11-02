/**
 * just-bash 跑在 Hermes 上缺的三样宿主能力。
 *
 * 实测 RN 0.88.1 的 Hermes：TextEncoder / TextDecoder / atob / btoa / Intl 都有；
 * 缺 Buffer、crypto、performance。这里只补最小实现，供实验室自检使用。
 * 生产接入时要换成正经 polyfill（buffer 包 + expo-crypto 的随机数）。
 */
import { Buffer as BufferPolyfill } from 'buffer';

interface MutableGlobal {
  Buffer?: unknown;
  crypto?: { getRandomValues?: (array: Uint8Array) => Uint8Array };
  performance?: { now: () => number };
}

// 用 unknown 绕开 DOM 的类型声明：RN 上没有 DOM 的 Crypto/Performance，
// 但 tsc 会从 lib.dom 里拿到完整类型，直接赋值会报“缺少 subtle/timeOrigin”。
const g = globalThis as unknown as MutableGlobal;

if (typeof g.Buffer === 'undefined') {
  g.Buffer = BufferPolyfill;
}

if (typeof g.crypto === 'undefined') {
  g.crypto = {};
}

if (typeof g.crypto.getRandomValues !== 'function') {
  // 自检用；正式实现应该走 expo-crypto / 原生 CSPRNG
  g.crypto.getRandomValues = (array: Uint8Array): Uint8Array => {
    for (let i = 0; i < array.length; i += 1) array[i] = Math.floor(Math.random() * 256);
    return array;
  };
}

if (typeof g.performance === 'undefined') {
  g.performance = { now: () => Date.now() };
}

export {};
