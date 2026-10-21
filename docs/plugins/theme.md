---
description: The named Loom theme plugin.
---

# Loom theme

```ts
import type { AdaptiveStyle, ConcreteStyle, Plugin, ThemeConstraint, ThemeMapping } from '@loomcli/core';

type LoomThemeDefaults = Readonly<
	{ primary: ConcreteStyle } & Record<
		'dim' | 'highlight' | 'success' | 'warning' | 'error' | 'info',
		AdaptiveStyle // new: the six colored tokens adapt to the run's background
	>
>;

export type LoomThemeOverrides = {
	readonly [Name in keyof LoomThemeDefaults]?: ConcreteStyle | AdaptiveStyle | undefined; // AdaptiveStyle is new
} & ThemeMapping;

export declare function loomTheme<const Mapping extends ThemeMapping = {}>(
	overrides?: LoomThemeOverrides & Mapping & ThemeConstraint<Mapping>,
): Plugin<{}, LoomThemeDefaults & Omit<NoInfer<Mapping>, keyof LoomThemeDefaults>>;
```

```ts
import { Application, style } from '@loomcli/core';
import { loomTheme } from '@loomcli/plugins/theme';

const app = new Application('example', {
	plugins: [loomTheme({
		highlight: style.cyan.bold,
		identifier: style.hex('#C97B36', { ansi256: 172, ansi16: 'yellow' }),
	})],
});
```

- **Status.** Implemented under ADR-0022 and [ADR-0029](../decisions/0029-explicit-color-fallbacks-preserve-theme-hues.md). The adaptive tokens and their light side are proposed under [ADR-0092](../decisions/0092-core-settles-each-runs-background-once-and-a-theme-entry-may-adapt-to-it.md).
- **Exports.** `@loomcli/plugins/theme` adds `loomTheme` and the type `LoomThemeOverrides` beside the existing `theme(mapping)`. Both factories use identity `@loomcli/plugins/theme` and contribute through the same single theme slot. They install no middleware, options, hooks, or views. Importing either factory installs nothing.
- **Defaults.** `loomTheme()` supplies the seven mappings below. `primary` is a plain entry, and the six colored tokens are [adaptive](../core/background.md), with a dark side and a light side, so core resolves each to the side that matches the run's background. `theme(mapping)` remains the bare factory and supplies only its declared mappings. The named defaults change foregrounds only, preserving backgrounds and modifiers. The factory takes no mode argument and reads no environment variable: core settles the background under [Background](../core/background.md), and the operator's spelling comes from the [background plugin](background.md).
- **Overrides.** A supplied concrete chain replaces the complete mapping for its key, both sides and every fallback color, so a plain override is one value on both backgrounds. An adaptive override supplies both sides. An omitted or `undefined` built-in override retains the default. `style` contributes no operations and inherits its surroundings. `style.resetForeground` selects the terminal's foreground default while preserving other attributes. `null` and applied strings are invalid values. The existing concrete-chain and reserved-name rules apply.
- **Custom names.** Extra keys add tokens to the Application vocabulary, including keys whose value is `undefined`. Core-key completion suggests the seven names without requiring an annotation. A reusable mapping can use `satisfies LoomThemeOverrides` while retaining its custom keys. Literal custom names survive the returned plugin and [Application environment registration](../core/styles.md#theme-plugins-and-typed-names) into action and view contexts. The imported `style` remains independent of Application registration. A mapping cannot reference another token.
- **Policy.** Construction reads no terminal facts. Core selects colors for each destination under the existing rendering policy. Installing the theme does not force color, select glyph forms, or change layout. An ordinary pipe remains free of styling, while explicit policy or `FORCE_COLOR` can enable it. Under automatic policy, `NO_COLOR` suppresses colors unless `FORCE_COLOR` is also set. Authored modifiers follow their own policy. Theme installation leaves unmarked text unchanged.

The named palette uses [explicit fallback colors](../core/styles.md#explicit-color-fallbacks) at the reduced depths. On a dark background, and when the run's background is `undefined`:

| Token | Truecolor foreground | 256-color foreground | 16-color foreground |
| --- | --- | --- | --- |
| `primary` | Terminal default | Terminal default | Terminal default |
| `dim` | `#8B93A3` | `245` | `brightBlack` |
| `highlight` | `#C97B36` | `172` | `yellow` |
| `success` | `#7A8F7B` | `108` | `green` |
| `warning` | `#E2B93D` | `178` | `brightYellow` |
| `error` | `#C04532` | `131` | `red` |
| `info` | `#5B7DA3` | `67` | `blue` |

On a light background:

| Token | Truecolor foreground | 256-color foreground | 16-color foreground |
| --- | --- | --- | --- |
| `primary` | Terminal default | Terminal default | Terminal default |
| `dim` | `#5F6B7A` | `243` | `brightBlack` |
| `highlight` | `#9C5A1E` | `130` | `yellow` |
| `success` | `#4E6B50` | `65` | `green` |
| `warning` | `#8A6D0E` | `94` | `brightYellow` |
| `error` | `#C04532` | `131` | `red` |
| `info` | `#4A6B91` | `60` | `blue` |

Each light truecolor value holds a contrast of at least 4.5:1 on a cream background. The 16-color fallbacks keep the dark side's names, because a light terminal remaps its own sixteen colors for its background. `error` holds the same values on both sides. `primary` maps to `style.resetForeground`, not a fixed white or cream, so it follows the terminal on either background. `dim` uses a color, not `faint`. No default adds bold. A view requests emphasis through a chain such as `style.highlight.bold(text)`. The palette paints no background; its colored tokens adapt to the run's.

## Loom theme acceptance

The implementation increment proves these cases through public APIs:

- Packed consumers import both factories and `LoomThemeOverrides` from the same subpath. Neither import installs a plugin. Installing either with another theme fails the existing identity or theme-slot check.
- Every default emits the exact foreground in the dark table at each depth under a dark background, and in the light table under a light one, with no background or modifier operation. A nested `primary` restores terminal foreground inside a colored span while preserving the surrounding background and modifiers.
- Omitted and `undefined` overrides retain defaults. A replacement chain discards the original mapping, both of its sides, and their fallbacks, and emits the same bytes under both backgrounds; an adaptive replacement emits its own sides. `style` inherits the enclosing style, and `style.resetForeground` restores terminal foreground. Custom `undefined` keys remain valid tokens.
- Compiler checks cover literal custom names, an adaptive override and an adaptive custom key, independent imported styles, invalid values, reserved names, and semantic references. An editor completion check suggests all seven core keys and omits keys already supplied.
- Both examples install `loomTheme()`. `textstat --total` uses the default highlight for its total row on a color terminal. Under ordinary piping or automatic `NO_COLOR`, the same content and layout contain no color escapes. Help and version restyling remains a separate increment.
- Process fixtures run on Node and Bun against the built packages. Packed-consumer evidence exercises the published declarations and the named palette at each color depth.

`scripts/check-theme-contract.mjs` checks the built factory export against the compiler and editor. `check:types` runs it after the existing declaration checks, so `pnpm verify` and PR CI include it. It verifies compilation and editor completion, not palette merging or output behavior. For a standalone run, use `pnpm build && node scripts/check-theme-contract.mjs`.
