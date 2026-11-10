import React from 'react';
import { Image, View } from 'react-native';

import { getPetPack } from '../../pet';
import { PetRuntime } from '../../pet/PetRuntime';
import { PET_SHEETS } from '../../pet/sheets';
import type { PetRole } from '../../pet/types';

/**
 * 内置 sprite sheet 渲染器：按 pack 的 frames[].ms 逐帧裁剪。
 *
 * 只重绘这一块，不触发整页；像素风用整数尺寸 + stretch，避免双线性模糊。
 */
export function PetCanvas({
  role,
  animation,
  size = 64,
}: {
  role: PetRole;
  animation: string;
  size?: number;
}): React.ReactElement {
  const pack = getPetPack(role);
  const anim = pack.animations[animation] ?? pack.animations[pack.states.idle] ?? pack.animations.idle;
  const sheet = PET_SHEETS[role][animation] ?? PET_SHEETS[role].idle;
  const runtime = React.useRef<PetRuntime | null>(null);
  const [cell, setCell] = React.useState(0);

  React.useEffect(() => {
    if (!anim) return;
    if (!runtime.current) runtime.current = new PetRuntime();
    const rt = runtime.current;
    rt.reset();
    rt.play(anim, { restart: true });
    setCell(anim.frames[0]?.i ?? 0);

    let raf = 0;
    let last = Date.now();
    const tick = (now: number): void => {
      const frame = rt.advance(now - last);
      last = now;
      if (frame) setCell(frame.frame.i);
      if (!rt.isFinished) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [anim, role]);

  if (!anim) return <></>;

  const scale = size / anim.frameH;
  const cols = anim.cols;
  const rows = Math.max(1, Math.ceil(anim.frames.length / cols));
  const cellW = anim.frameW * scale;
  const cellH = anim.frameH * scale;
  const col = cell % cols;
  const row = Math.floor(cell / cols);

  return (
    <View style={{ width: size, height: size, overflow: 'hidden' }}>
      <Image
        source={sheet}
        resizeMode="stretch"
        fadeDuration={0}
        style={{
          position: 'absolute',
          width: cellW * cols,
          height: cellH * rows,
          left: -col * cellW,
          top: -row * cellH,
        }}
      />
    </View>
  );
}
