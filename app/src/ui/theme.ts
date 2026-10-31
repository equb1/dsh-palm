import { Platform, StatusBar } from 'react-native';

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

export const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;

export function riskTone(risk: 'low' | 'medium' | 'high'): { color: string; bg: string; label: string } {
  if (risk === 'high') return { color: colors.danger, bg: colors.dangerSoft, label: '高风险' };
  if (risk === 'medium') return { color: colors.warn, bg: colors.warnSoft, label: '需确认' };
  return { color: colors.ok, bg: colors.okSoft, label: '低风险' };
}
