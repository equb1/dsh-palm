import type { PetAnimation, PetAnimationFrame } from './types';

export interface PetRuntimeFrame {
  animation: PetAnimation;
  frame: PetAnimationFrame;
  /** 帧在序列中的下标（不是 sheet cell） */
  index: number;
  /** 一次性动画是否已经播完（循环动画永远 false） */
  finished: boolean;
}

interface PlayOptions {
  /** 同一动画也从头播 */
  restart?: boolean;
}

/**
 * 纯 TS 的逐帧时钟：不依赖 React/Native，方便单测。
 *
 * 用法：
 *   runtime.play(anim);
 *   const frame = runtime.advance(deltaMs);
 *
 * `advance` 只在“帧真的变了”时返回结果，UI 可以据此避免每 16ms setState。
 */
export class PetRuntime {
  private animation: PetAnimation | null = null;
  private index = 0;
  private elapsed = 0;
  private finished = false;

  get current(): PetAnimation | null {
    return this.animation;
  }

  get frameIndex(): number {
    return this.index;
  }

  get isFinished(): boolean {
    return this.finished;
  }

  play(animation: PetAnimation, options: PlayOptions = {}): boolean {
    if (!options.restart && this.animation === animation) return false;
    this.animation = animation;
    this.index = 0;
    this.elapsed = 0;
    this.finished = false;
    return true;
  }

  /**
   * 推进 `deltaMs`。返回当前帧；若这一段时间内没有换帧，返回 null。
   * 一次性动画播完后停在最后一帧，`finished=true`；循环动画回到第 0 帧。
   */
  advance(deltaMs: number): PetRuntimeFrame | null {
    const animation = this.animation;
    if (!animation || animation.frames.length === 0) return null;

    if (this.finished) return null;
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return null;

    const frames = animation.frames;
    const totalMs = frames.reduce((sum, frame) => sum + frame.ms, 0);
    // 后台恢复时 delta 可能极大：只追最多两轮，避免 here 循环几十万次。
    const maxStep = animation.loop ? Math.max(totalMs * 2, 1000) : Math.max(totalMs, 1);
    let remaining = Math.min(deltaMs, maxStep);
    const startIndex = this.index;
    let changed = false;

    // 防止异常大的 delta 导致死循环（例如 App 后台回来）
    let guard = 0;
    while (remaining > 0 && guard++ < 10_000) {
      const frame = frames[this.index]!;
      const left = frame.ms - this.elapsed;
      if (remaining < left) {
        this.elapsed += remaining;
        remaining = 0;
        break;
      }

      remaining -= left;
      this.elapsed = 0;

      if (this.index + 1 < frames.length) {
        this.index += 1;
        changed = true;
      } else if (animation.loop) {
        this.index = 0;
        changed = true;
      } else {
        this.index = frames.length - 1;
        this.finished = true;
        changed = true;
        break;
      }
    }

    if (!changed) return null;
    if (this.index === startIndex) return null;

    return {
      animation,
      frame: frames[this.index]!,
      index: this.index,
      finished: this.finished,
    };
  }

  reset(): void {
    this.animation = null;
    this.index = 0;
    this.elapsed = 0;
    this.finished = false;
  }
}
