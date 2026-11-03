import { Easing, Platform, StatusBar } from 'react-native';

/**
 * 设计语言对齐 DSH 官方 / dsh-go：
 *  - 近黑背景 + 半透明玻璃层（靠 rgba 叠出层次，不用阴影）
 *  - 胶囊形状：头部控件、输入框、芯片全用全圆角
 *  - 蓝色是交互色，金色只留给品牌标识
 */

export const colors = {
  bg: '#0A0B0F',
  bgElevated: '#101218',
  /** 玻璃层：叠在 bg 上就是卡片 */
  glass: 'rgba(255,255,255,0.045)',
  glassStrong: 'rgba(255,255,255,0.075)',
  glassPressed: 'rgba(255,255,255,0.09)',
  bubble: 'rgba(255,255,255,0.08)',
  border: 'rgba(255,255,255,0.075)',
  borderStrong: 'rgba(255,255,255,0.12)',

  text: '#E9EBEF',
  textDim: '#9AA3B2',
  textFaint: '#6B7385',

  blue: '#6C8AF0',
  blueHover: '#7C97F5',
  blueSoft: 'rgba(108,138,240,0.16)',
  gold: '#D8A94B',
  goldSoft: 'rgba(216,169,75,0.14)',

  ok: '#57B37A',
  okSoft: 'rgba(87,179,122,0.14)',
  warn: '#E0A94A',
  warnSoft: 'rgba(224,169,74,0.14)',
  danger: '#E5645C',
  dangerSoft: 'rgba(229,100,92,0.14)',
} as const;

export const font = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, SFMono-Regular, Menlo, monospace' }),
} as const;

export const radius = { sm: 10, md: 14, lg: 20, xl: 24, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

/**
 * A2：字号层级（只新增，不动旧导出）。
 * 正文 13–14，标题 15–20；行高按 1.4–1.5 倍给，等宽用于代码/命令/路径。
 */
export const typography = {
  hero: { fontSize: 30, lineHeight: 40, fontWeight: '700' },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '600' },
  heading: { fontSize: 17, lineHeight: 24, fontWeight: '600' },
  subheading: { fontSize: 15, lineHeight: 22, fontWeight: '600' },
  body: { fontSize: 14, lineHeight: 22, fontWeight: '400' },
  bodySmall: { fontSize: 13, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 17, fontWeight: '400' },
  meta: { fontSize: 11, lineHeight: 15, fontWeight: '500' },
  micro: { fontSize: 10, lineHeight: 13, fontWeight: '500' },
  mono: { fontSize: 12.5, lineHeight: 18, fontFamily: font.mono },
} as const;

/**
 * A2：语义色（只新增）。
 * 组件只认语义名；U7 换浅色主题时改这里的映射，不用逐屏改颜色。
 */
export const semantic = {
  surface: colors.bg,
  surfaceRaised: colors.bgElevated,
  card: colors.glass,
  cardStrong: colors.glassStrong,
  cardPressed: colors.glassPressed,
  border: colors.border,
  borderStrong: colors.borderStrong,
  textPrimary: colors.text,
  textSecondary: colors.textDim,
  textTertiary: colors.textFaint,
  accent: colors.blue,
  accentStrong: colors.blueHover,
  accentSoft: colors.blueSoft,
  brand: colors.gold,
  brandSoft: colors.goldSoft,
  success: colors.ok,
  successSoft: colors.okSoft,
  warning: colors.warn,
  warningSoft: colors.warnSoft,
  danger: colors.danger,
  dangerSoft: colors.dangerSoft,
} as const;

/** A2：动效时长（ms）与曲线；组件不再写死 200 / 450 / Easing.quad。 */
export const motion = {
  duration: { fast: 120, base: 200, slow: 320, breathing: 450 },
  easing: {
    standard: Easing.bezier(0.2, 0, 0, 1),
    decelerate: Easing.out(Easing.cubic),
    accelerate: Easing.in(Easing.cubic),
    emphasis: Easing.inOut(Easing.quad),
  },
} as const;

export const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;

export function riskTone(risk: 'low' | 'medium' | 'high'): { color: string; bg: string; label: string } {
  if (risk === 'high') return { color: colors.danger, bg: colors.dangerSoft, label: '高风险' };
  if (risk === 'medium') return { color: colors.warn, bg: colors.warnSoft, label: '需确认' };
  return { color: colors.ok, bg: colors.okSoft, label: '低风险' };
}
