import type { FileRef } from '../../protocol';

export type { FileRef };

/** 附件会落到哪种引擎上处理（chip 上标「轻 / 完整」） */
export type AttachmentEngine = 'light' | 'full';

/** 附件类别；也复用为 `+` 面板的入口类别 */
export type AttachmentKind = 'image' | 'document' | 'file' | 'video' | 'audio';

/**
 * 原生收件入参：`content://` / `file://` URI，或本机绝对路径。
 * 原生侧复制到 uploads，只回路径引用。
 */
export interface IntakeSource {
  uri?: string;
  path?: string;
  name?: string;
  mime?: string;
}

/** 系统分享一次带进来的全部内容 */
export interface IntakeShare {
  text?: string;
  files: FileRef[];
  /** 部分文件失败的原因（有则提示用户，不影响已落盘的） */
  errors?: string[];
}

/** 单个附件的分类结果 */
export interface AttachmentClass {
  kind: AttachmentKind;
  engine: AttachmentEngine;
  /** 只保存路径、不解析内容（PDF / 旧 Office / 音视频 / 未知格式） */
  saveOnly: boolean;
  /** 给用户看的一句话说明 */
  hint?: string;
}
