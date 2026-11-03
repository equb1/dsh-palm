import { Easing, Platform, StatusBar } from 'react-native';

/**
 * 设计 token 对齐官方 DSH（packages/client/ui-theme）。
 *
 * 官方默认是浅色（白底），电脑深色模式才会走 dark alias；这里以 light 为默认：
 *  - 背景 #FFFFFF，侧栏 #F9FAFB，卡片/输入区 #FFFFFF + 黑色 hairline
 *  - 文字 #0F1115 / #61666B / #81858C / 说明 #ADB2B8
 *  - 交互 deepseek 蓝 #4176E6，浅蓝底 #E4EDFD
 *  - 圆角 4 / 8 / 12 / 16 / 20 / 28；正文 14/22，次级 13/20，说明 12/18
 *  - 动效 100 / 200 / 300ms，cubic-bezier(.4,0,.2,1)
 */

export const colors = {
  /** 官方 --dsw-alias-bg-base（light） */
  bg: '#FFFFFF',
  /** 官方 --dsw-alias-bg-layer-1：浮层/设置卡 */
  bgElevated: '#F9FAFB',
  /** 官方 --dsw-specific-input-major：卡片、气泡、输入区 */
  glass: '#FFFFFF',
  /** 官方 --dsw-static-neutral-bluish-75：hover / 次级块 */
  glassStrong: '#F1F3F5',
  glassPressed: '#EBEEF2',
  /** 官方 --dsw-specific-bubble（light）= deepseek-50 */
  bubble: '#EDF3FE',
  /** 官方 border-l1 / border-l2（light） */
  border: 'rgba(0,0,0,0.06)',
  borderStrong: 'rgba(0,0,0,0.10)',

  text: '#0F1115',
  textDim: '#61666B',
  textFaint: '#81858C',

  /** deepseek-500：链接、发送、主交互 */
  blue: '#4176E6',
  /** deepseek-400：hover */
  blueHover: '#7AAAFF',
  blueSoft: '#E4EDFD',
  /** 官方品牌字标是黑色；保留 key 兼容旧代码 */
  gold: '#0F1115',
  goldSoft: '#F1F3F5',

  ok: '#22C55E',
  okSoft: 'rgba(34,197,94,0.12)',
  warn: '#F59E0B',
  warnSoft: 'rgba(245,158,11,0.12)',
  danger: '#EC1313',
  dangerSoft: 'rgba(236,19,19,0.08)',
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
 * 语义色：组件只认语义名；深色主题以后只换这一层。
 * 取值来自官方 light alias。
 */
export const semantic = {
  surface: colors.bg,
  /** 官方侧栏 --dsw-specific-sidebar-fill（light）= bluish-50 */
  sidebar: '#F9FAFB',
  sidebarHover: '#F1F3F5',
  sidebarActive: '#EBEEF2',
  surfaceRaised: colors.bgElevated,
  card: colors.glass,
  cardStrong: colors.glassStrong,
  cardPressed: colors.glassPressed,
  border: colors.border,
  borderStrong: colors.borderStrong,
  textPrimary: colors.text,
  textSecondary: colors.textDim,
  textTertiary: colors.textFaint,
  textCaption: '#ADB2B8',
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
  codeBlock: '#F9FAFB',
  codeInline: '#FAFAFA',
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
