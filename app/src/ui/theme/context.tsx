import React from 'react';
import { useColorScheme } from 'react-native';

import {
  darkColors,
  darkSemantic,
  lightColors,
  lightSemantic,
  type Palette,
  type ResolvedTheme,
  type Semantic,
  type ThemeMode,
} from './palette';

export interface Theme {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  palette: Palette;
  semantic: Semantic;
}

const ThemeContext = React.createContext<Theme>({
  mode: 'light',
  resolved: 'light',
  palette: lightColors,
  semantic: lightSemantic,
});

export function ThemeProvider({
  mode,
  children,
}: {
  mode: ThemeMode;
  children: React.ReactNode;
}): React.ReactElement {
  const system = useColorScheme();
  const resolved: ResolvedTheme = mode === 'system' ? (system === 'dark' ? 'dark' : 'light') : mode;
  const value = React.useMemo<Theme>(() => {
    const palette = resolved === 'dark' ? darkColors : lightColors;
    return {
      mode,
      resolved,
      palette,
      semantic: resolved === 'dark' ? darkSemantic : lightSemantic,
    };
  }, [mode, resolved]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return React.useContext(ThemeContext);
}

export function useThemedStyles<T>(factory: (theme: Theme) => T): T {
  const theme = useTheme();
  return React.useMemo(() => factory(theme), [factory, theme]);
}
