import { Colors, Fonts, Spacing } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';

/**
 * Colours the template's table doesn't carry, for the states the app shows.
 * Kept next to the template palette so both schemes stay in step.
 */
const stateColours = {
  light: {
    card: '#FFFFFF',
    border: '#D9DBE0',
    secondaryText: '#5B6069',
    accent: '#1F6FEB',
    onAccent: '#FFFFFF',
    accentSoft: '#E6EFFF',
    danger: '#B3261E',
    dangerSoft: '#FBEAE8',
    success: '#1B6B3A',
    successSoft: '#E4F4E9',
    warning: '#8A5A00',
    warningSoft: '#FBF1DA',
  },
  dark: {
    card: '#17181A',
    border: '#33363B',
    secondaryText: '#A2A7AF',
    accent: '#5B9CFF',
    onAccent: '#0B1220',
    accentSoft: '#13243E',
    danger: '#F2B8B5',
    dangerSoft: '#3A1D1B',
    success: '#8FD9A8',
    successSoft: '#122C1B',
    warning: '#E8C27A',
    warningSoft: '#332812',
  },
} as const;

export const themes = {
  light: { ...Colors.light, ...stateColours.light },
  dark: { ...Colors.dark, ...stateColours.dark },
};

export type AppTheme = Record<keyof typeof themes.light, string>;

/** The palette for the scheme the device is in. */
export function useAppTheme(): AppTheme {
  return useColorScheme() === 'dark' ? themes.dark : themes.light;
}

export { Fonts, Spacing };
