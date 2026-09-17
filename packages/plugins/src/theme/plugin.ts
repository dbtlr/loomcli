import { plugin, style } from '@loomcli/core';
import type { ConcreteStyle, Plugin, ThemeConstraint, ThemeMapping } from '@loomcli/core';

/** The bare palette introduces its literal token names and supplies no defaults or middleware. */
function theme<const Mapping extends ThemeMapping>(
  mapping: Mapping & ThemeConstraint<Mapping>,
): Plugin<{}, NoInfer<Mapping>> {
  return plugin<{}, Mapping>('@loomcli/plugins/theme', { theme: mapping });
}

const defaults = {
  dim: style.hex('#8B93A3', { ansi16: 'brightBlack', ansi256: 245 }),
  error: style.hex('#C04532', { ansi16: 'red', ansi256: 131 }),
  highlight: style.hex('#C97B36', { ansi16: 'yellow', ansi256: 172 }),
  info: style.hex('#5B7DA3', { ansi16: 'blue', ansi256: 67 }),
  primary: style.resetForeground,
  success: style.hex('#7A8F7B', { ansi16: 'green', ansi256: 108 }),
  warning: style.hex('#E2B93D', { ansi16: 'brightYellow', ansi256: 178 }),
};
type LoomThemeDefaults = Readonly<typeof defaults>;
type LoomThemeOverrides = {
  readonly [Name in keyof LoomThemeDefaults]?: ConcreteStyle | undefined;
} & ThemeMapping;

/** The dark foreground palette preserves terminal backgrounds and authored modifiers. */
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
