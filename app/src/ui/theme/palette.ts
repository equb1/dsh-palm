import { Easing, Platform, StatusBar } from 'react-native';

/**
 * 设计 token 对齐官方 DSH（packages/client/ui-theme）。
 *
 * 浅色沿用 2026-11-06 基线；深色按官方 Neutral 色阶（背景 #0F1115、面板 #151920、
 * 文字 #E6E8EB、次文字 #A8B0BA）。页面不直接引用这里的常量，走 theme/context 的
 * useTheme()/useThemedStyles()，切主题时按 palette 重建 StyleSheet。
 */

export type ThemeMode = 'system' | 'light' | 'dark' | 'deepy' | 'violet' | 'emerald';
export type ResolvedTheme = 'light' | 'dark' | 'deepy' | 'violet' | 'emerald';

export interface SyntaxPalette {
  comment: string;
  string: string;
  keyword: string;
  literal: string;
  number: string;
  function: string;
  operator: string;
  property: string;
  tag: string;
}

export interface Palette {
  bg: string;
  bgElevated: string;
  glass: string;
  glassStrong: string;
  glassPressed: string;
  bubble: string;
  border: string;
  borderStrong: string;

  text: string;
  textDim: string;
  textFaint: string;

  blue: string;
  blueHover: string;
  blueSoft: string;
  gold: string;
  goldSoft: string;

  ok: string;
  okSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;

  infoBorder: string;
  warnBorder: string;
  dangerBorder: string;
  dangerBorderSoft: string;
  dangerBorderMedium: string;
  successBorder: string;

  backdrop: string;
  shadow: string;
  pressedOverlay: string;
  skeleton: string;
  headerOverlay: string;
  headerSolid: string;

  codeBlock: string;
  codeInline: string;
  codeText: string;
  onAccent: string;
  onDanger: string;
  webOuter: string;
  emblemBorder: string;
  violet: string;
  violetSoft: string;
  terminalBg: string;
  terminalText: string;

  syntax: SyntaxPalette;
}

export const lightColors: Palette = {
  bg: '#FFFFFF',
  bgElevated: '#F9FAFB',
  glass: '#FFFFFF',
  glassStrong: '#F1F3F5',
  glassPressed: '#EBEEF2',
  bubble: '#EDF3FE',
  border: 'rgba(0,0,0,0.08)',
  borderStrong: 'rgba(0,0,0,0.12)',

  text: '#0F1115',
  textDim: '#4D5258',
  textFaint: '#6B7076',

  blue: '#4176E6',
  blueHover: '#7AAAFF',
  blueSoft: '#E4EDFD',
  gold: '#0F1115',
  goldSoft: '#F1F3F5',

  ok: '#22C55E',
  okSoft: 'rgba(34,197,94,0.12)',
  warn: '#F59E0B',
  warnSoft: 'rgba(245,158,11,0.12)',
  danger: '#EC1313',
  dangerSoft: 'rgba(236,19,19,0.08)',

  infoBorder: 'rgba(65,118,230,0.24)',
  warnBorder: 'rgba(245,158,11,0.28)',
  dangerBorder: 'rgba(236,19,19,0.28)',
  dangerBorderSoft: 'rgba(236,19,19,0.18)',
  dangerBorderMedium: 'rgba(236,19,19,0.24)',
  successBorder: 'rgba(34,197,94,0.26)',

  backdrop: 'rgba(15,17,21,0.28)',
  shadow: '#000000',
  pressedOverlay: 'rgba(0,0,0,0.06)',
  skeleton: 'rgba(0,0,0,0.06)',
  headerOverlay: 'rgba(255,255,255,0.86)',
  headerSolid: 'rgba(255,255,255,0.97)',

  codeBlock: '#F9FAFB',
  codeInline: '#FAFAFA',
  codeText: '#1F2328',
  onAccent: '#FFFFFF',
  onDanger: '#FFFFFF',
  webOuter: '#050608',
  emblemBorder: 'rgba(216,169,75,0.45)',
  violet: '#7C3AED',
  violetSoft: 'rgba(124,58,237,0.10)',
  terminalBg: '#0F1115',
  terminalText: '#FFFFFF',

  syntax: {
    comment: '#6E7781',
    string: '#0A7D32',
    keyword: '#8250DF',
    literal: '#0550AE',
    number: '#0550AE',
    function: '#0550AE',
    operator: '#0550AE',
    property: '#57606A',
    tag: '#116329',
  },
};

export const darkColors: Palette = {
  bg: '#0F1115',
  bgElevated: '#151920',
  glass: '#151920',
  glassStrong: '#1C2129',
  glassPressed: '#242A33',
  bubble: '#1A2A44',
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.16)',

  text: '#E6E8EB',
  textDim: '#A8B0BA',
  textFaint: '#8B949E',

  blue: '#7AAAFF',
  blueHover: '#9BC2FF',
  blueSoft: 'rgba(65,118,230,0.24)',
  gold: '#E6E8EB',
  goldSoft: '#1C2129',

  ok: '#4ADE80',
  okSoft: 'rgba(74,222,128,0.16)',
  warn: '#FBBF24',
  warnSoft: 'rgba(251,191,36,0.16)',
  danger: '#FF6B6B',
  dangerSoft: 'rgba(255,107,107,0.16)',

  infoBorder: 'rgba(122,170,255,0.30)',
  warnBorder: 'rgba(251,191,36,0.30)',
  dangerBorder: 'rgba(255,107,107,0.34)',
  dangerBorderSoft: 'rgba(255,107,107,0.26)',
  dangerBorderMedium: 'rgba(255,107,107,0.30)',
  successBorder: 'rgba(74,222,128,0.30)',

  backdrop: 'rgba(0,0,0,0.55)',
  shadow: '#000000',
  pressedOverlay: 'rgba(255,255,255,0.08)',
  skeleton: 'rgba(255,255,255,0.08)',
  headerOverlay: 'rgba(15,17,21,0.86)',
  headerSolid: 'rgba(15,17,21,0.97)',

  codeBlock: '#0B0D11',
  codeInline: '#1A1F27',
  codeText: '#D7DBE0',
  onAccent: '#0F1115',
  onDanger: '#0F1115',
  webOuter: '#000000',
  emblemBorder: 'rgba(216,169,75,0.55)',
  violet: '#A78BFA',
  violetSoft: 'rgba(167,139,250,0.16)',
  terminalBg: '#080A0D',
  terminalText: '#E6E8EB',

  syntax: {
    comment: '#8B949E',
    string: '#7EE787',
    keyword: '#FF7B72',
    literal: '#79C0FF',
    number: '#79C0FF',
    function: '#D2A8FF',
    operator: '#FF7B72',
    property: '#79C0FF',
    tag: '#7EE787',
  },
};

export const deepyColors: Palette = {
  ...darkColors,
  bg: '#0A1128',
  bgElevated: '#0F1A3A',
  glass: '#0F1A3A',
  glassStrong: '#14234C',
  glassPressed: '#1A2C5E',
  bubble: '#132A55',
  blue: '#38BDF8',
  blueHover: '#7DD3FC',
  blueSoft: 'rgba(56, 189, 248, 0.22)',
  headerOverlay: 'rgba(10, 17, 40, 0.88)',
  headerSolid: 'rgba(10, 17, 40, 0.98)',
};

export const violetColors: Palette = {
  ...darkColors,
  bg: '#0F0E17',
  bgElevated: '#171624',
  glass: '#171624',
  glassStrong: '#222035',
  glassPressed: '#2B2942',
  bubble: '#2A1F45',
  blue: '#A78BFA',
  blueHover: '#C4B5FD',
  blueSoft: 'rgba(167, 139, 250, 0.22)',
  headerOverlay: 'rgba(15, 14, 23, 0.88)',
  headerSolid: 'rgba(15, 14, 23, 0.98)',
};

export const emeraldColors: Palette = {
  ...darkColors,
  bg: '#061C14',
  bgElevated: '#0B291E',
  glass: '#0B291E',
  glassStrong: '#12382A',
  glassPressed: '#184736',
  bubble: '#143828',
  blue: '#34D399',
  blueHover: '#6EE7B7',
  blueSoft: 'rgba(52, 211, 153, 0.22)',
  headerOverlay: 'rgba(6, 28, 20, 0.88)',
  headerSolid: 'rgba(6, 28, 20, 0.98)',
};

export interface Semantic {
  surface: string;
  sidebar: string;
  sidebarHover: string;
  sidebarActive: string;
  surfaceRaised: string;
  card: string;
  cardStrong: string;
  cardPressed: string;
  border: string;
  borderStrong: string;
  textPrimary: string;
  textSecondary: string;
  textTertiary: string;
  textCaption: string;
  accent: string;
  accentStrong: string;
  accentSoft: string;
  brand: string;
  brandSoft: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  link: string;
  codeBlock: string;
  codeInline: string;
}

function deriveSemantic(c: Palette): Semantic {
  return {
    surface: c.bg,
    sidebar: c.bgElevated,
    sidebarHover: c.glassStrong,
    sidebarActive: c.glassPressed,
    surfaceRaised: c.bgElevated,
    card: c.glass,
    cardStrong: c.glassStrong,
    cardPressed: c.glassPressed,
    border: c.border,
    borderStrong: c.borderStrong,
    textPrimary: c.text,
    textSecondary: c.textDim,
    textTertiary: c.textFaint,
    textCaption: c.textFaint,
    accent: c.blue,
    accentStrong: c.blueHover,
    accentSoft: c.blueSoft,
    brand: c.gold,
    brandSoft: c.goldSoft,
    success: c.ok,
    successSoft: c.okSoft,
    warning: c.warn,
    warningSoft: c.warnSoft,
    danger: c.danger,
    dangerSoft: c.dangerSoft,
    link: c.blue,
    codeBlock: c.codeBlock,
    codeInline: c.codeInline,
  };
}

export const lightSemantic = deriveSemantic(lightColors);
export const darkSemantic = deriveSemantic(darkColors);

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

export const radius = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, panel: 28, pill: 999 } as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 28 } as const;

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

export const motion = {
  duration: { fast: 100, base: 200, slow: 300, breathing: 450 },
  easing: {
    standard: Easing.bezier(0.4, 0, 0.2, 1),
    decelerate: Easing.out(Easing.cubic),
    accelerate: Easing.in(Easing.cubic),
    emphasis: Easing.inOut(Easing.quad),
  },
  spring: {
    /** 页面 push/pop：约 300ms 收敛，临界阻尼，不 overshoot */
    page: {
      stiffness: 600,
      damping: 44,
      mass: 0.9,
      overshootClamping: true,
      restDisplacementThreshold: 0.5,
      restSpeedThreshold: 0.5,
    },
    /** 抽屉/底部弹层：跟手松手后约 300ms 收敛 */
    sheet: {
      stiffness: 700,
      damping: 46,
      mass: 0.9,
      overshootClamping: true,
      restDisplacementThreshold: 0.5,
      restSpeedThreshold: 0.5,
    },
  },
} as const;

export const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;

export function riskTone(
  risk: 'low' | 'medium' | 'high',
  c: Palette = lightColors,
): { color: string; bg: string; label: string } {
  if (risk === 'high') return { color: c.danger, bg: c.dangerSoft, label: '高风险' };
  if (risk === 'medium') return { color: c.warn, bg: c.warnSoft, label: '需确认' };
  return { color: c.ok, bg: c.okSoft, label: '低风险' };
}
