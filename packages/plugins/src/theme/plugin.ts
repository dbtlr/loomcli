import { plugin, style } from '@loomcli/core';
import type {
  AdaptiveStyle,
  ConcreteStyle,
  Plugin,
  ThemeConstraint,
  ThemeMapping,
} from '@loomcli/core';

/** The bare palette introduces its literal token names and supplies no defaults or middleware. */
function theme<const Mapping extends ThemeMapping>(
  mapping: Mapping & ThemeConstraint<Mapping>,
): Plugin<{}, NoInfer<Mapping>> {
  return plugin<{}, Mapping>('@loomcli/plugins/theme', { theme: mapping });
}

/**
 * The six colored tokens adapt to the run's background. Each light side holds at least 4.5:1 on a
 * cream background, and keeps the dark side's 16-color name, because a light terminal remaps its
 * own sixteen colors. `primary` follows the terminal's foreground on either background.
 */
const defaults = {
  dim: style.adaptive({
    dark: style.hex('#8B93A3', { ansi16: 'brightBlack', ansi256: 245 }),
    light: style.hex('#5F6B7A', { ansi16: 'brightBlack', ansi256: 243 }),
  }),
  error: style.adaptive({
    dark: style.hex('#C04532', { ansi16: 'red', ansi256: 131 }),
    light: style.hex('#C04532', { ansi16: 'red', ansi256: 131 }),
  }),
  highlight: style.adaptive({
    dark: style.hex('#C97B36', { ansi16: 'yellow', ansi256: 172 }),
    light: style.hex('#9C5A1E', { ansi16: 'yellow', ansi256: 130 }),
  }),
  info: style.adaptive({
    dark: style.hex('#5B7DA3', { ansi16: 'blue', ansi256: 67 }),
    light: style.hex('#4A6B91', { ansi16: 'blue', ansi256: 60 }),
  }),
  primary: style.resetForeground,
  success: style.adaptive({
    dark: style.hex('#7A8F7B', { ansi16: 'green', ansi256: 108 }),
    light: style.hex('#4E6B50', { ansi16: 'green', ansi256: 65 }),
  }),
  warning: style.adaptive({
    dark: style.hex('#E2B93D', { ansi16: 'brightYellow', ansi256: 178 }),
    light: style.hex('#8A6D0E', { ansi16: 'brightYellow', ansi256: 94 }),
  }),
};
type LoomThemeDefaults = Readonly<typeof defaults>;
type LoomThemeOverrides = {
  readonly [Name in keyof LoomThemeDefaults]?: ConcreteStyle | AdaptiveStyle | undefined;
} & ThemeMapping;

/** The Loom palette, which adapts to the run's background and preserves authored modifiers. */
function loomTheme<const Mapping extends ThemeMapping = {}>(
  overrides?: LoomThemeOverrides & Mapping & ThemeConstraint<Mapping>,
): Plugin<{}, LoomThemeDefaults & Omit<NoInfer<Mapping>, keyof LoomThemeDefaults>>;
function loomTheme(overrides?: LoomThemeOverrides): Plugin<{}, ThemeMapping> {
  return plugin('@loomcli/plugins/theme', {
    theme: {
      ...overrides,
      dim: overrides?.dim === undefined ? defaults.dim : overrides.dim,
      error: overrides?.error === undefined ? defaults.error : overrides.error,
      highlight: overrides?.highlight === undefined ? defaults.highlight : overrides.highlight,
      info: overrides?.info === undefined ? defaults.info : overrides.info,
      primary: overrides?.primary === undefined ? defaults.primary : overrides.primary,
      success: overrides?.success === undefined ? defaults.success : overrides.success,
      warning: overrides?.warning === undefined ? defaults.warning : overrides.warning,
    },
  });
}

export { theme, loomTheme };
export type { LoomThemeOverrides };
