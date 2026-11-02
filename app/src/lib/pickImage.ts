import * as ImagePicker from 'expo-image-picker';

/**
 * 选一张图/一个文件，读成 base64 交给宿主。
 *
 * 说明：宿主（dsh）的 `fileUploads/upload` 只吃 base64 + 文件名，
 * 所以这里直接把字节省略成 base64，省一层流式通道。
 * 大文件别走这条（base64 会膨胀 33%），后续换成上传流再优化。
 */

export interface PickedFile {
  base64: string;
  name: string;
  size?: number;
}

/** 图片上限：超过就别传了，base64 后的 JSON 会非常大 */
const MAX_BYTES = 8 * 1024 * 1024;

export async function pickImage(): Promise<PickedFile | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;

  const result = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    // 手机拍的原图动辄 5–10MB，压到 0.7 再 base64（+33%）通常还在 1–2MB
    quality: 0.7,
    base64: true,
    allowsMultipleSelection: false,
  });
  if (result.canceled || result.assets.length === 0) return null;

  const asset = result.assets[0]!;
  if (!asset.base64) return null;
  if (asset.fileSize && asset.fileSize > MAX_BYTES) {
    throw new Error('图片太大了（上限 8MB），先压缩一下');
  }

  const name = asset.fileName ?? `image-${Date.now()}.jpg`;
  return { base64: asset.base64, name, size: asset.fileSize };
}
