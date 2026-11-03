import { Easing, Platform, StatusBar } from 'react-native';

/**
 * 设计 token 对齐官方 DSH（packages/client/ui-theme 的 dark alias）：
 *  - 暖中性灰层次：base #151517 / layer1 #232324 / layer2 #2C2C2E / layer3 #353638
 *  - 文字：primary #F9FAFB / secondary #CFD3D6 / tertiary #ADB2B8 / caption #81858C
 *  - 交互：deepseek 蓝 #7AAAFF（发送、链接、焦点），实心按钮 #4176E6
 *  - 圆角：4 / 8 / 12 / 16 / 20 / 28；动效：100 / 200 / 300ms，cubic-bezier(.4,0,.2,1)
 */

export const colors = {
  /** 官方 --dsw-alias-bg-base（dark） */
  bg: '#151517',
  /** 官方 --dsw-alias-bg-layer-1，用于浮层/设置卡 */
  bgElevated: '#232324',
  /** 官方 --dsw-alias-bg-layer-2：卡片、气泡、输入区 */
  glass: '#2C2C2E',
  /** 官方 --dsw-alias-bg-layer-3 */
  glassStrong: '#353638',
  glassPressed: '#3A3A3C',
  bubble: '#2C2C2E',
  /** 官方 border-l1 / border-l2 */
  border: 'rgba(255,255,255,0.06)',
  borderStrong: 'rgba(255,255,255,0.12)',

  text: '#F9FAFB',
  textDim: '#CFD3D6',
  textFaint: '#ADB2B8',

  /** deepseek-400：发送、链接、主交互 */
  blue: '#7AAAFF',
  /** deepseek-450：hover */
  blueHover: '#5686FE',
  blueSoft: 'rgba(122,170,255,0.16)',
  /** 品牌字标改成官方的白色；保留 key 兼容旧代码 */
  gold: '#F9FAFB',
  goldSoft: 'rgba(249,250,251,0.08)',

  ok: '#22C55E',
  okSoft: 'rgba(34,197,94,0.14)',
  warn: '#F59E0B',
  warnSoft: 'rgba(245,158,11,0.14)',
  danger: '#F25A5A',
  dangerSoft: 'rgba(242,90,90,0.14)',
} as const;

export const font = {
  family: Platform.select({
    ios: 'System',
    android: 'sans-serif',
    default: '-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
  }),
  mono: Platform.select({
    ios: 'Menlo',
    android: 'monospace',
    default: '"SF Mono", "JetBrains Mono", "Fira Code", Consolas, Menlo, monospace',
  }),
} as const;

/** 官方圆角阶梯：xs 4 / sm 8 / md 12 / lg 16 / xl 20 / panel 28 */
export const radius = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, panel: 28, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

/**
 * 官方字号：xl 24/32 · l 20/28 · m 16/28 · s 14/22 · xs 13/20 · xxs 12/18；
 * 等宽按官方 code 11/16。
 */
export const typography = {
  hero: { fontSize: 24, lineHeight: 32, fontWeight: '600' },
  title: { fontSize: 20, lineHeight: 28, fontWeight: '500' },
  heading: { fontSize: 16, lineHeight: 28, fontWeight: '500' },
  subheading: { fontSize: 14, lineHeight: 22, fontWeight: '500' },
  body: { fontSize: 14, lineHeight: 22, fontWeight: '400' },
  bodySmall: { fontSize: 13, lineHeight: 20, fontWeight: '400' },
  caption: { fontSize: 12, lineHeight: 18, fontWeight: '400' },
  meta: { fontSize: 11, lineHeight: 16, fontWeight: '400' },
  micro: { fontSize: 10, lineHeight: 14, fontWeight: '400' },
  mono: { fontSize: 11, lineHeight: 16, fontFamily: font.mono },
} as const;

/**
 * 语义色：组件只认语义名；以后做浅色主题只改这一层。
 * 取值来自官方 dark alias，不是随手调的近似色。
 */
export const semantic = {
  surface: colors.bg,
  /** 官方侧栏 --dsw-specific-sidebar-fill */
  sidebar: '#1B1B1C',
  surfaceRaised: colors.bgElevated,
  card: colors.glass,
  cardStrong: colors.glassStrong,
  cardPressed: colors.glassPressed,
  border: colors.border,
  borderStrong: colors.borderStrong,
  textPrimary: colors.text,
  textSecondary: colors.textDim,
  textTertiary: colors.textFaint,
  textCaption: '#81858C',
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
  link: colors.blue,
  codeBlock: '#1B1B1C',
  codeInline: '#292929',
} as const;

/** 官方动效：100 / 200 / 300ms，标准曲线 cubic-bezier(.4,0,.2,1) */
export const motion = {
  duration: { fast: 100, base: 200, slow: 300, breathing: 450 },
  easing: {
    standard: Easing.bezier(0.4, 0, 0.2, 1),
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
