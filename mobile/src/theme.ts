import { Platform } from 'react-native';

export const colors = {
  background: '#F7FAF9',
  backgroundSoft: '#EEF4F2',
  surface: '#FFFFFF',
  surfaceRaised: '#F1F6F4',
  surfaceHighlight: '#E5EEEB',
  primary: '#008F7F',
  primaryPressed: '#007568',
  primarySoft: '#DDF6F1',
  primaryText: '#FFFFFF',
  text: '#101820',
  textSoft: '#29343B',
  muted: '#5F6B73',
  mutedDark: '#7B858C',
  warning: '#B66A00',
  warningSoft: '#FFF2DC',
  danger: '#D93832',
  dangerSoft: '#FDE9E7',
  border: '#D8E3E0',
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
