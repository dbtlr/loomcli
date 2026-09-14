import { plugin } from '@loomcli/core';
import type { Plugin, ThemeConstraint, ThemeMapping } from '@loomcli/core';

/** The bare palette introduces its literal token names and supplies no defaults or middleware. */
export function theme<const Mapping extends ThemeMapping>(
  mapping: Mapping & ThemeConstraint<Mapping>,
): Plugin<{}, NoInfer<Mapping>> {
  return plugin<{}, Mapping>('@loomcli/plugins/theme', { theme: mapping });
}
