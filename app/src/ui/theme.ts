import { Platform, StatusBar } from 'react-native';

/** 深色底 + 金色袋口结：和品牌意象一致（见 docs/01-product.md「命名」） */
export const colors = {
  bg: '#0B0D10',
  card: '#14181D',
  cardAlt: '#1B2027',
  line: '#232A33',
  text: '#EDEFF2',
  dim: '#8A939F',
  faint: '#5A636E',
  gold: '#D8A94B',
  goldSoft: 'rgba(216,169,75,0.12)',
  blue: '#6C8AF0',
  ok: '#4C9A6A',
  warn: '#C9A227',
  danger: '#C4553B',
} as const;

export const font = {
  mono: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight ?? 24) : 0;

export function riskColor(risk: 'low' | 'medium' | 'high'): string {
  return risk === 'high' ? colors.danger : risk === 'medium' ? colors.warn : colors.ok;
}

export function riskLabel(risk: 'low' | 'medium' | 'high'): string {
  return risk === 'high' ? '高风险' : risk === 'medium' ? '需确认' : '低风险';
}
