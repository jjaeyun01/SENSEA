import { Platform } from 'react-native';

export const colors = {
  background: '#070C12',
  backgroundSoft: '#0B1118',
  surface: '#121922',
  surfaceRaised: '#18212B',
  surfaceHighlight: '#202B36',
  primary: '#08D8BD',
  primaryPressed: '#00BFA6',
  primarySoft: '#003E37',
  primaryText: '#031B19',
  text: '#F7F9FA',
  textSoft: '#D7DDE3',
  muted: '#8B96A3',
  mutedDark: '#66717E',
  warning: '#FFAA17',
  warningSoft: '#3A2607',
  danger: '#FF514B',
  dangerSoft: '#351314',
  border: '#252E38',
  white: '#FFFFFF',
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 22,
  xl: 28,
  xxl: 36,
} as const;

export const radii = {
  sm: 12,
  md: 18,
  lg: 24,
  pill: 999,
} as const;

export const typography = {
  family: Platform.select({ ios: 'Avenir Next', android: 'sans-serif', web: 'Avenir Next, system-ui, sans-serif', default: 'System' }),
  title: 34,
  heading: 24,
  body: 17,
  caption: 14,
} as const;
