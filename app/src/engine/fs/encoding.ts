/**
 * 编码工具（不依赖 Buffer）。
 *
 * just-bash 的 IFileSystem 允许 utf8 / ascii / binary(latin1) / base64 / hex。
 * Hermes 有 TextEncoder / TextDecoder（docs/25 实测），所以这里只做薄封装；
 * `binary` / `latin1` 沿用 just-bash 的约定：一个字符 = 一个字节。
 */

export type TextEncoding = 'utf8' | 'utf-8' | 'ascii' | 'binary' | 'base64' | 'hex' | 'latin1';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

export function encodeUtf8(text: string): Uint8Array {
  return encoder.encode(text);
}

export function decodeUtf8(bytes: Uint8Array): string {
  return decoder.decode(bytes);
}

export function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    out += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunk, bytes.length)));
  }
  return out;
}

export function latin1ToBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) out[i] = text.charCodeAt(i) & 0xff;
  return out;
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] as number;
    const b = i + 1 < bytes.length ? (bytes[i + 1] as number) : NaN;
    const c = i + 2 < bytes.length ? (bytes[i + 2] as number) : NaN;
    const triple = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    out += B64[(triple >> 18) & 63];
    out += B64[(triple >> 12) & 63];
    out += Number.isNaN(b) ? '=' : B64[(triple >> 6) & 63];
    out += Number.isNaN(c) ? '=' : B64[triple & 63];
  }
  return out;
}

export function base64ToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '').replace(/=+$/, '');
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const ch of clean) {
    const value = B64.indexOf(ch);
    if (value < 0) throw new Error(`EINVAL: invalid base64 character '${ch}'`);
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  return out.subarray(0, index);
}

export function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

export function hexToBytes(text: string): Uint8Array {
  const clean = text.replace(/\s+/g, '');
  if (clean.length % 2 !== 0) throw new Error('EINVAL: invalid hex string');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i += 1) {
    const byte = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(byte)) throw new Error('EINVAL: invalid hex string');
    out[i] = byte;
  }
  return out;
}

/** 按 just-bash 的 encoding 把字节解成文本 */
export function decodeBytes(bytes: Uint8Array, encoding: TextEncoding = 'utf8'): string {
  switch (encoding) {
    case 'binary':
    case 'latin1':
      return bytesToLatin1(bytes);
    case 'base64':
      return bytesToBase64(bytes);
    case 'hex':
      return bytesToHex(bytes);
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    default:
      return decodeUtf8(bytes);
  }
}

/** 把文本按 encoding 编码成字节；不认识的编码按 utf8 处理 */
export function encodeText(text: string, encoding?: TextEncoding | null): Uint8Array {
  switch (encoding) {
    case 'binary':
    case 'latin1':
      return latin1ToBytes(text);
    case 'base64':
      return base64ToBytes(text);
    case 'hex':
      return hexToBytes(text);
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case null:
    case undefined:
    default:
      return encodeUtf8(text);
  }
}
