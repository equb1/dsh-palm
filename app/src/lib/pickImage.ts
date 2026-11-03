/**
 * 选择附件（图片 / 视频 / 音频 / 任意文件），读成 base64 交给宿主。
 *
 * 原生端走 `pickImage.native.ts`（结合 expo-image-picker 与原生 SAF 文件选择器）；
 * Web / Node 测试端走本文件。
 */

export type AttachmentKind = 'image' | 'video' | 'audio' | 'file';

export interface PickedFile {
  base64: string;
  name: string;
  mime?: string;
  size?: number;
  kind?: AttachmentKind;
}

const MAX_BYTES = 20 * 1024 * 1024;

function acceptForKind(kind: AttachmentKind): string {
  switch (kind) {
    case 'image':
      return 'image/*';
    case 'video':
      return 'video/*';
    case 'audio':
      return 'audio/*';
    default:
      return '*/*';
  }
}

interface WebFile {
  name: string;
  size: number;
  type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface WebFileInput {
  type: string;
  multiple: boolean;
  accept: string;
  files?: ArrayLike<WebFile> | null;
  onchange: (() => void) | null;
  oncancel: (() => void) | null;
  click(): void;
}

interface WebDocument {
  createElement(tag: 'input'): WebFileInput;
}

export async function pickAttachments(kind: AttachmentKind = 'file'): Promise<PickedFile[]> {
  const doc = (globalThis as { document?: WebDocument }).document;
  if (!doc) return [];
  return await new Promise<PickedFile[]>((resolve, reject) => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = acceptForKind(kind);
    input.onchange = async () => {
      try {
        const files = Array.from(input.files ?? []);
        const out: PickedFile[] = [];
        for (const f of files) {
          if (f.size > MAX_BYTES) {
            throw new Error(`文件「${f.name}」超过 20MB 上限`);
          }
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i += 1) {
            binary += String.fromCharCode(bytes[i]!);
          }
          const base64 = btoa(binary);
          out.push({
            base64,
            name: f.name || `file-${Date.now()}`,
            mime: f.type || 'application/octet-stream',
            size: f.size,
            kind,
          });
        }
        resolve(out);
      } catch (err) {
        reject(err);
      }
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

export async function pickImage(): Promise<PickedFile | null> {
  const list = await pickAttachments('image');
  return list[0] ?? null;
}
