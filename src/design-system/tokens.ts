export const colors = {
  background: '#0B0B0D',
  surface1: '#151517',
  surface2: '#1B1B1E',
  elevated: '#222226',
  textPrimary: '#F4F4F5',
  textSecondary: '#98989F',
  textTertiary: '#8E8E94',
  accent: '#C8FF3D',
  success: '#55D98B',
  carbs: '#8FD9F5',
  fat: '#F7C95B',
  warning: '#FFB84D',
  danger: '#FF6767',
  border: '#2A2A2E',
  borderSubtle: '#202024',
  surfacePressed: '#27272C',
  activeSurface: '#171A14',
  accentMuted: '#232817',
  tabSurface: '#111113',
  scrim: 'rgba(0,0,0,0.58)',
} as const;

export const spacing = { xxs: 4, xs: 8, sm: 12, md: 16, lg: 20, xl: 24, xxl: 32, xxxl: 40, huge: 48 } as const;
export const radius = { small: 10, medium: 16, large: 22, round: 999 } as const;
export const control = { touch: 44, button: 54, row: 48, restBar: 68 } as const;
export const mobileCanvasWidth = 402;
export const iconSize = { small: 16, medium: 20, navigation: 21, large: 24 } as const;
export const motion = { fast: 150, standard: 220 } as const;
export const typography = {
  display: { fontSize: 40, lineHeight: 44, fontWeight: '600' as const },
  h1: { fontSize: 28, lineHeight: 34, fontWeight: '600' as const },
  title: { fontSize: 26, lineHeight: 32, fontWeight: '600' as const },
  h2: { fontSize: 21, lineHeight: 27, fontWeight: '600' as const },
  h3: { fontSize: 17, lineHeight: 23, fontWeight: '600' as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: '400' as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: '500' as const },
  label: { fontSize: 12, lineHeight: 16, fontWeight: '600' as const, letterSpacing: 1.1 },
} as const;
