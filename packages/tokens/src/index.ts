/**
 * Intelli design tokens — single source of truth, ported verbatim from the
 * prototype's shared/styles.css :root (light theme). Web consumes tokens.css;
 * React Native consumes this object via StyleSheet. Keep the two in sync.
 */

export const color = {
  accent: '#1B4F8A',
  accentHover: '#174274',
  accentPress: '#133761',
  accentFg: '#ffffff',
  accentSubtle: '#e8edf3',
  accentSubtle2: '#d1dce8',
  accentRing: 'rgba(27, 79, 138, 0.16)',

  bg: '#fafafa',
  bgElev: '#f4f4f5',
  surface: '#ffffff',
  surface2: '#fafafa',
  surfaceHover: '#f4f4f5',
  surfaceActive: '#ececee',

  border: '#e9e9ec',
  borderStrong: '#dcdce0',
  borderFaint: '#f1f1f3',

  text: '#18181b',
  text2: '#52525b',
  text3: '#8a8a93',
  text4: '#b4b4bb',

  green: '#16a34a',
  greenBg: '#ecfdf3',
  greenFg: '#157f3c',
  amber: '#d97706',
  amberBg: '#fffaeb',
  amberFg: '#b45309',
  red: '#dc2626',
  redBg: '#fef3f2',
  redFg: '#b42318',
  blue: '#2563eb',
  blueBg: '#eff6ff',
  violet: '#7c3aed',
  violetBg: '#f5f3ff',
} as const;

export const radius = {
  xs: 5,
  sm: 7,
  md: 9,
  lg: 12,
  xl: 16,
  '2xl': 20,
  full: 999,
} as const;

export const space = {
  gap: 14,
  pad: 22,
  rowH: 40,
} as const;

export const type = {
  fontBase: 14,
  sans: "'Hanken Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  mono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
} as const;

export const shadow = {
  xs: '0 1px 2px rgba(24, 24, 27, 0.04)',
  sm: '0 1px 2px rgba(24, 24, 27, 0.05), 0 1px 3px rgba(24, 24, 27, 0.04)',
  md: '0 2px 4px rgba(24, 24, 27, 0.04), 0 4px 12px rgba(24, 24, 27, 0.06)',
  lg: '0 8px 24px rgba(24, 24, 27, 0.10), 0 2px 6px rgba(24, 24, 27, 0.06)',
  pop: '0 12px 40px rgba(24, 24, 27, 0.14), 0 2px 8px rgba(24, 24, 27, 0.06)',
} as const;

export const tokens = { color, radius, space, type, shadow } as const;
export default tokens;
