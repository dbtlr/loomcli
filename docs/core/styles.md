---
description: How core resolves marked strings into styled output, covering style helpers, color fallbacks, theme plugins, glyphs, rendering policies, and the width, padding, and wrapping helpers a view receives.
---

# Styles and rendering policy

Core exports the style helpers, rendering context, and rendering policy described below. [ADR-0027](../decisions/0027-core-resolves-marked-output-and-one-theme-contribution.md) governs this seam.

## Strings and composition

Core exports `style`, `glyph`, `pad`, `nowrap`, `splitLines`, `escapeControlCharacters`, and `width`. Style calls accept one string and return an ordinary string containing internal markup. Interpolation, concatenation, arrays, and `join()` work without a wrapper type or a conversion step. `style.adaptive` is the one member that styles no text: it builds a theme entry for each background, under [Background](background.md).

```ts
import { glyph, pad, style } from '@loomcli/core';

const first = style.yellow.bold('Ready');
const second = style.bold(style.yellow('Ready'));
const status = `${style.green(glyph.success)} ${first}`;
const cell = pad(status, 24);
```

Both chaining and nesting are first-class. Chains apply from left to right. A later foreground or background replaces only that attribute; unrelated modifiers accumulate. An inner span overrides the attributes it supplies and restores its enclosing style afterward. The chain never mutates its receiver.

For a `warning` token mapped to yellow and bold, `style.warning.red(text)` is red and bold. `style.red.warning(text)` is yellow and bold. A token without a mapping leaves the surrounding style unchanged.

`style.escape(text)` returns a string that displays Loom's internal delimiters literally. Normal style calls preserve markup rather than escaping it. `String(value)` performs coercion and does not escape markup. The escape helper does not remove ANSI sequences; rendering policy governs them.

`escapeControlCharacters(text)` returns the text with every control character and line separator, U+0000 through U+001F, U+007F through U+009F, U+2028, and U+2029, and every bidirectional control and mark, U+202A through U+202E, U+2066 through U+2069, U+200E, U+200F, and U+061C, replaced by its four-digit lowercase `\uXXXX` escape, so raw text stays on one line, writes no control character, and cannot reorder the rest of the line. Other format characters, such as a zero-width joiner or a soft hyphen, pass through. Results output never passes through it, under rule 5 of [failure message voice](failures.md#failure-message-voice). It escapes no markup, so text a view styles passes through `style.escape` as well. Core writes the reason of a broken failure view or `onFailure` hook through it, and every token, option spelling, short group, and issue path its failure sentences quote, while the failure's public fields keep the raw values. The [configuration plugin](../plugins/config.md) writes a file path through it.

First-party views escape raw data they interpolate, such as a filename taken from a data object. A string supplied to an `out.*` message method is already authored text and can contain deliberate styles. Lane views preserve that text, including its markup. Escaping a complete message would break ordinary composition.

The [wire contract](../maintaining/style-wire.md) fixes the delimiters, framing, literal-data rules, and malformed-input behavior. The wire form is internal and is not a persistent interchange format.

## Default styles and custom colors

The foreground catalog has all sixteen terminal colors:

| Base | Bright |
| --- | --- |
| `black` | `brightBlack` |
| `red` | `brightRed` |
| `green` | `brightGreen` |
| `yellow` | `brightYellow` |
| `blue` | `brightBlue` |
| `magenta` | `brightMagenta` |
| `cyan` | `brightCyan` |
| `white` | `brightWhite` |

Every foreground has a background counterpart: `bgBlack` through `bgWhite`, and `bgBrightBlack` through `bgBrightWhite`. Terminal palette settings determine the actual appearance of these named colors. Loom's own views do not paint backgrounds; SDK authors can use them.

The modifier catalog is `bold`, `faint`, `italic`, `underline`, `inverse`, `hidden`, `strikethrough`, and `overline`. There is no blink helper. `faint` is a terminal modifier; `dim` is a semantic theme token.

Custom colors return the same callable chain:

```ts
style.hex('#C97B36').bold('Ready');
style.rgb(201, 123, 54)('Ready');
style.ansi256(172)('Ready');
style.bgHex('#123').white('Ready');
style.bgRgb(17, 34, 51)('Ready');
style.bgAnsi256(17)('Ready');
```

Hex strings use `#RGB` or `#RRGGBB`, case-insensitively. RGB channels and ANSI palette indices are integers from 0 through 255. Alpha channels, clamping, and rounding are not supported. Invalid arguments throw when the helper is called, before a marked string is produced. Helpers do not coerce non-string text or invalid numeric input.

Three scoped resets are chainable:

| Helper | Effect inside its span |
| --- | --- |
| `reset` | Clear foreground, background, and modifiers |
| `resetForeground` | Use the terminal's foreground default; retain other attributes |
| `resetBackground` | Use the terminal's background default; retain other attributes |

`style.reset.red(text)` clears inherited styling and then applies red. Closing the span restores the enclosing style. A token mapped to `style.reset` explicitly clears inherited styling. An omitted mapping does not clear anything.

## Explicit color fallbacks

An explicit fallback keeps a themed color's hue at a lower color depth. [ADR-0029](../decisions/0029-explicit-color-fallbacks-preserve-theme-hues.md) records the decision, and core exports the three types below.

```ts
import type { Style } from '@loomcli/core';

export type ColorName =
	| 'black' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white'
	| 'brightBlack' | 'brightRed' | 'brightGreen' | 'brightYellow'
	| 'brightBlue' | 'brightMagenta' | 'brightCyan' | 'brightWhite';

export interface ColorFallbacks {
	readonly ansi256?: number | undefined;
	readonly ansi16?: ColorName | undefined;
}

export type Ansi256Fallbacks = Pick<ColorFallbacks, 'ansi16'>;

// These members extend the existing Style type.
interface ColorHelpers<Names extends string, Semantic extends boolean> {
	hex(color: string, fallbacks?: ColorFallbacks): Style<Names, Semantic>;
	rgb(red: number, green: number, blue: number, fallbacks?: ColorFallbacks): Style<Names, Semantic>;
	ansi256(index: number, fallbacks?: Ansi256Fallbacks): Style<Names, Semantic>;
	bgHex(color: string, fallbacks?: ColorFallbacks): Style<Names, Semantic>;
	bgRgb(red: number, green: number, blue: number, fallbacks?: ColorFallbacks): Style<Names, Semantic>;
	bgAnsi256(index: number, fallbacks?: Ansi256Fallbacks): Style<Names, Semantic>;
}
```

```ts
const sage = style.hex('#7A8F7B', { ansi256: 108, ansi16: 'green' });
const rgbSage = style.rgb(122, 143, 123, { ansi256: 108, ansi16: 'green' });
const indexedSage = style.ansi256(108, { ansi16: 'green' });
sage.bold('Ready');
```

- **Selection.** RGB and hex retain their original RGB value at truecolor depth. At 256 or 16 colors, the matching explicit fallback wins. An omitted or `undefined` fallback uses the existing approximation of the original color for that depth. A 256-color fallback never changes the 16-color result. `ansi256` retains its original index at truecolor and 256-color depth, and uses `ansi16` when supplied at 16-color depth.
- **Values.** `ansi256` is an integer from 0 through 255. `ansi16` is one of the sixteen foreground color names, including for background helpers. Both options are optional. `undefined` options and an empty object behave as omission. The `ansi256` and `bgAnsi256` helpers accept only `ansi16`.
- **Validation.** Helpers validate options when called and copy the accepted values into the chain. Later object mutation cannot change that chain. A non-plain options object, unknown option, or invalid color name throws `TypeError`. An invalid palette index throws `RangeError`. Existing hex and RGB validation remains unchanged. No value is coerced, rounded, or clamped.
- **Composition.** Fallbacks belong to one color operation. A later foreground replaces the original foreground and all its fallbacks, so `sage.blue` uses named blue at every depth. A background operation leaves the foreground choice intact. Nesting and embedded ANSI resets restore enclosing colors with their fallbacks. All helpers retain the receiver's token names and semantic-chain restriction.
- **Callbacks.** Helpers accept only their documented arguments. A callback such as `values.map(style.hex)` passes the array index as the options argument and fails validation. Use `values.map((value) => style.hex(value))` so the helper receives only the color.
- **Policy.** Fallbacks do not change capability detection or force color. Color suppression removes them like other colors. Direct styles and theme mappings use the same rules. Calls that omit the options argument preserve their current behavior. Named terminal colors and raw ANSI colors gain no inferred fallback mapping.

## Theme plugins and typed names

The core semantic names are `dim`, `primary`, `highlight`, `success`, `warning`, `error`, and `info`. These are names, not built-in appearances.

The plugin pack exports the bare `theme(mapping)` factory from `@loomcli/plugins/theme`:

```ts
import { Application, style } from '@loomcli/core';
import { theme } from '@loomcli/plugins/theme';

const app = new Application('example', {
	plugins: [
		theme({
			highlight: style.yellow.bold,
			identifier: style.cyan,
		}),
	],
});
```

`theme(mapping)` supplies exactly the mappings provided. Its plugin identity is `@loomcli/plugins/theme`. Importing it installs nothing.

The [`loomTheme(overrides?)`](../plugins/theme.md) factory adds the named palette and accepts replacements and custom keys.

### `PluginDefinition.theme` field

A [PluginDefinition](plugin-contract.md) can contribute this field:

| Field | Required | Value |
| --- | --- | --- |
| `theme` | No | A readonly mapping from semantic names to unapplied concrete style chains, [adaptive styles](background.md), or `undefined`, retaining its literal keys through the returned plugin type. |

Supplying the field claims the theme slot, including an empty mapping. The pack factory uses this field; third-party themes use their own plugin identities:

```ts
import { plugin, style } from '@loomcli/core';

export const dusk = () => plugin('@example/dusk', {
	theme: {
		highlight: style.magenta.bold,
		identifier: style.cyan,
	},
});
```

The contribution retains its literal keys in the returned plugin type and through Application installation. A broad annotation must not erase the vocabulary along the framework's internal path. Theme declarations require no middleware and perform no output or capability detection during construction. They follow the same mapping validation and single-owner rule as the pack factories.

One Application installs at most one theme plugin. A second claim on the theme slot is a `DeclarationError` under [`@loomcli/core/slot-taken`](diagnostics.md#loomclicoreslot-taken) from the Application constructor that names both claimants and marks both entries of `plugins`. Zero themes is valid. Without a mapping, semantic tokens inherit their enclosing style; direct colors and modifiers still work under rendering policy.

In a bare theme, an omitted or undefined mapping contributes no style. An explicitly declared custom key with an undefined value still introduces that name.

Mapping values are unapplied concrete style chains: named terminal colors, modifiers, resets, custom colors, or their combinations. A value may instead be an [adaptive style](background.md), `style.adaptive({ dark, light })`, whose two sides are such chains and which core resolves against the run's background. A mapping cannot reference any semantic token, including a core token. For example, `highlight: style.info.bold` fails the type contract. Shared concrete chain constants are valid. The types reject a name a built-in style member holds. A mapping value that is neither an unapplied concrete chain nor an adaptive style throws a plain `TypeError` from `plugin()`, because core finds no style operations for it.

The mapping's custom keys introduce one flat semantic vocabulary for the Application. The same key always names the same token within that Application. There are no public token descriptors, style groups, per-view namespaces, or group override methods. A custom key cannot shadow a built-in style member, including callable-function members. Core semantic keys are valid mapping keys because they configure those tokens.

The Application derives this vocabulary from its installed theme and publishes it through one Application-owned type registration. Independently authored Commands, extracted action handlers, and `View<Data>` values receive those names automatically. A misspelled name fails compilation. There is no per-Command theme argument, manual token generic, or Application-owned Command factory.

Custom names use automatic Application environment registration. It registers a shallow configuration type rather than a completed command tree, avoiding a circular dependency through handlers. One compilation context has one default registration; reusable libraries express their requirements without registering a consumer's Application. ADR-0026 supplies this registration API and its compatibility checks. Style derives custom names from the installed plugins in that environment, including when ordinary plugins accompany the theme.

Core supplies `style` on the action context and in the second view-function argument. The imported `style` supplies concrete styles and core semantic names; theme authoring needs no Application instance.

Actions use the supplied `style` to access the installed theme's custom names. Pass that style to helpers that compose action output.

```ts
import { Command } from '@loomcli/core';

export const show = new Command('show')
	.argument('name', { required: true })
	.action(({ args, out, style }) => out.print(style.identifier(style.escape(args.name))));
```

This action belongs to the Application compilation context that declares `identifier`, as does the view below.

```ts
import type { View } from '@loomcli/core';

interface Item {
	name: string;
}

export const item: View<Item> = {
	render: (data, { style, width }) => {
		const text = style.identifier(style.escape(data.name));
		return `${text} (${width(text)} columns)\n`;
	},
};
```

This example belongs to the Application compilation context that declares `identifier`. The view context is immutable and supplies `style`, destination-aware `width(text)`, `plain(text)`, `columns`, `wrap(text, columns)`, `expandTabs(text)`, and the run's [`background`](background.md). Existing one-argument view functions can ignore it. A view remains pure and synchronous and receives no output handle. Under `out.render`, as here, it owns its trailing newline; a lane view returns none, as [Rendered output](output.md#rendered-output) states per write site. Core resolves its returned markup and ANSI policy before writing, so a returned string promises no exact output bytes.

## Glyphs

`glyph` contains the complete [glyph catalog](../maintaining/glyphs.md), derived from a pinned Inquirer figures inventory. Each property is an unstyled marked string. `success` aliases `tick`, and `error` aliases `cross`; `info` and `warning` retain the upstream names. A glyph carries no theme token or automatic color.

```ts
style.success(glyph.success);
style.cyan(glyph.success);
glyph.success;
```

The first two expressions style the glyph explicitly; the last inherits its surroundings. The inventory preserves upstream compatibility forms, which can contain Unicode or multiple characters. There is no separate strict ASCII mode. For example, `tick` selects `✔` or `√`, `cross` selects `✘` or `×`, and `radioOn` selects `◉` or `(*)`.

Core applies the pinned Inquirer detection rule to captured facts on each run. On every platform, main forms apply unless `TERM` is `linux`, where core selects compatibility forms. Inquirer's separate Windows rule is not applied, under [ADR-0100](../decisions/0100-acceptance-plans-live-beside-the-tests.md). It reads the captured environment case-sensitively. Piping, `NO_COLOR`, `FORCE_COLOR`, and theme installation do not select glyph forms. Only marked glyphs participate; core does not search and replace arbitrary Unicode characters in data.

## Rendering policies

Both Application options and `run()` options accept `rendering`:

```ts
const app = new Application('example', {
	rendering: {
		color: 'auto',
		modifiers: 'auto',
		hyperlinks: 'auto',
		terminalControls: 'strip',
		background: 'auto',
	},
});

await app.run({ rendering: { color: 'never' } });
```

`color`, `modifiers`, and `hyperlinks` each accept `'auto'`, `'always'`, or `'never'`. Their default is `'auto'`. `terminalControls` accepts `'strip'` or `'preserve'`, defaulting to `'strip'`. `background` accepts `'auto'`, `'dark'`, or `'light'`, defaulting to `'auto'`: `'dark'` and `'light'` state the run's [background](background.md) over every source but the operator's background choice, except in an invocation by name, which settles nothing and reads `undefined`, and `'auto'` leaves it to the sources after the author's. Undefined fields act as omitted fields.

There is one policy for both streams. No field accepts a stdout/stderr map. Core evaluates automatic capabilities separately for each destination. Redirecting stdout therefore does not turn off capable stderr output.

Invocation overrides replace only supplied rendering fields. Omitted fields retain the Application setting. Explicit `'auto'` restores automatic behavior for that field. This merge applies to rendering policy alone: a field supplied to a [process handle](host.md#the-process-handle) still replaces its whole field under [ADR-0107](../decisions/0107-a-run-reads-the-process-through-one-process-handle.md).

The operator's [color choice](color.md), `--color` or `--no-color` on an Application that declares the color mark, comes first for the `color` field alone: it sets `'always'` or `'never'` over the merged policy and over both variables, and every other field keeps its own policy. Without a choice, explicit `'always'` or `'never'` wins for its policy. With color set to `'auto'`, precedence is nonempty `FORCE_COLOR`, nonempty `NO_COLOR`, then terminal detection. Empty values make no override. The string `"0"` is nonempty and therefore active for either variable. A nonempty `FORCE_COLOR` wins when both variables are active. Numeric values do not select a color depth.

These rules follow [NO_COLOR](https://no-color.org/) and [FORCE_COLOR](https://force-color.org/), including user configuration precedence and the standard's rule that an argument given for one run overrides `NO_COLOR`, which the [color choice](color.md) implements. They deliberately differ from Node's numeric `FORCE_COLOR` interpretation. Core owns the behavior under both Node and Bun.

| Automatic case | Colors | Modifiers | Hyperlinks |
| --- | --- | --- | --- |
| Capable TTY | On | On | Preserve |
| Capable TTY with `NO_COLOR` | Off | On | Preserve |
| Pipe or file | Off | Off | Strip, retaining visible text |
| Pipe or file with `FORCE_COLOR` | On | On | Strip, retaining visible text |

For ANSI color and modifier detection, a capable TTY has `isTTY: true` and `TERM` other than `dumb`. Automatic modifiers follow that detection or a nonempty `FORCE_COLOR`; `NO_COLOR` never disables them. Automatic hyperlinks require `isTTY: true`. Explicit policy values override each column independently. Setting color to `'always'` alone does not change the modifier or hyperlink policy.

When colors are enabled, core determines depth on each emission from the hints the run's environment holds, a variable [environment preparation](plugin-contract.md#environment-preparation) imported included, in this order:

| Hint | Depth |
| --- | --- |
| `COLORTERM` is `truecolor` or `24bit` | Truecolor |
| `TERM` is `xterm-kitty`, `xterm-ghostty`, or `wezterm` | Truecolor |
| `TERM_PROGRAM` is `iTerm.app` and its version starts with a decimal major of at least 3 | Truecolor |
| `TERM_PROGRAM` is `iTerm.app` otherwise | 256 |
| `TERM_PROGRAM` is `Apple_Terminal` | 256 |
| `TERM` ends in `-256` or `-256color`, case-insensitively | 256 |
| No matching hint | 16 |

The iTerm version field is `TERM_PROGRAM_VERSION`. These are a portable subset of [supports-color's detection rules](https://github.com/chalk/supports-color/blob/e2a4cd3c44eb384b075161ef32859cd29ce1aa7f/index.js), with enablement handled separately. Core does not read CLI flags or live process globals during resolution, and does not reuse upstream numeric forcing semantics. The [color choice](color.md) reads `host.argv` once, before resolution, for the marked option's spellings alone, unlike supports-color's scan of `process.argv`, and the [background choice](background.md) reads it once beside it for its own marked option. Forced color without a depth hint uses sixteen colors.

[Explicit fallbacks](#explicit-color-fallbacks) take precedence at their named depth. Without a matching fallback, the following approximation rule applies.

RGB colors remain RGB at truecolor depth. At lower depth, core chooses the closest available color by squared RGB distance, with the lower palette index breaking ties. The 256-color target is the conventional xterm palette. The sixteen-color target uses that palette's first sixteen entries. Named colors retain their terminal palette indices; they do not acquire hard-coded RGB values on a richer terminal. ANSI-256 colors retain their index at 256 or truecolor depth and approximate to sixteen colors at basic depth. A terminal can customize its palette, so approximation does not promise an exact visual match.

The same policies apply to ANSI styling already embedded in supplied strings. Color suppression removes foreground and background colors, not unrelated modifiers or text. An embedded reset restores the enclosing Loom style. Core closes remaining style and hyperlink state at the end of each rendered string.

General terminal controls include cursor movement, screen erasure, title changes, and the bell. The default removes those commands while retaining ordinary text, tabs, and line breaks. `'preserve'` permits them without bypassing color, modifier, or hyperlink policy. OSC 8 hyperlinks have their own policy even though their encoding uses terminal control sequences. Disabling hyperlinks preserves the label exactly and does not append the destination URL. No hyperlink authoring helper is added by this contract.

For filtered control strings such as OSC, core removes the complete sequence through its terminator, including its payload. An unterminated control string is removed through the end of the rendered string. When controls are preserved, complete unrecognized controls pass through; recognized styling and hyperlinks still obey their own policies. The resolver must not misclassify a control-string payload as ordinary text or as another output command.

Core discards an incomplete ANSI sequence at the end of each rendered string, including in preserve mode. Commands cannot span separate output calls. For example, separate view results containing `ESC[3` and `1mX` emit only the literal `1mX`, not a red-color command. Within one rendered string, ANSI recognition spans adjacent Loom frames, as the [wire contract](../maintaining/style-wire.md#parsing-order) specifies.

## Width, padding, and multiline lanes

The view context also supplies `plain(text): string`, which resolves marked text without colors, modifiers, hyperlinks, or terminal controls, while keeping that destination’s glyph forms and padding. A view can clip the plain text at grapheme boundaries and escape the result before applying its own styles.

The view context supplies `width(text): number`. It resolves glyph forms for that destination, ignores styling and hyperlink envelopes, and counts Unicode terminal columns. Combining marks add no column; wide characters occupy two. Emoji sequences follow the selected Unicode width implementation. Ambiguous-width characters count as one column. Measurement and padding use the grapheme width rules of `@rockorager/uucode` 2.2.1 with its Unicode 17 data. Core carries both itself, the tables as a JavaScript module, so it reads no file at run time. The tables stay under the Unicode License v3, which core's license field and its `NOTICE` state, and their license notices are legal comments that a bundler keeps in the bundle. It does not promise identical font rendering in every terminal.

`width()` returns the widest line's width. Tabs advance to the next multiple of eight columns, starting each input line at column zero. Thus `width('a\tb')` is 9. CRLF is one line break; LF is a line break. Preserved cursor operations do not turn width measurement into a terminal emulator.

Deep padding around unchanged content reuses measurement. Nested padding that changes the content at every level can still require quadratic Unicode measurement, such as appending one combining mark per level. This pathological optimization is deferred; the [wire contract](../maintaining/style-wire.md#resolution) includes a reproducible probe.

The view context supplies `columns: number | undefined`, the effective width of the destination the view's text reaches. Core reads it live. Just before each render call it takes the destination's real width from `host.terminal` and passes the result to the view as a plain number, so a resize between two renders reaches the next one, and core never renders printed text again: a [live region](output.md#live-region) redraws the frame text it kept. Each context belongs to one destination, so a view rendered to stdout reads stdout's width and a view rendered to stderr reads stderr's. Core builds a fresh context, with its own `columns`, for every render call: each lane write, `out.render`, result render, failure view, incomplete-result line, `out.draw`, each live region's `draw`, and each `head`, `row`, and `tail` of a row view. A whole view over a sequence reads the width when it renders, after the source ends. `columns` is `undefined` when that destination is not a terminal: a pipe, a redirect to a file, `app.invoke`, and so every MCP tool call. It is also `undefined` on a terminal that reports no width and whose `COLUMNS` holds no positive integer. The context carries no fallback width, because a view that read 80 for a pipe could not tell a pipe from an 80-column terminal. A view that wants a fallback supplies its own, such as `context.columns ?? 80`. `FailureViewContext` extends `ViewContext`, so failure views receive `columns`, `wrap`, and `expandTabs` too.

`COLUMNS` only narrows. It is valid when `host.env.COLUMNS` is a positive integer: ASCII digits 0-9 only, leading zeros allowed, a safe integer greater than zero. Any other value, such as `0`, `abc`, `-5`, `60.5`, `+60`, `6e1`, a value with a leading or trailing space, or an empty string, is ignored. On a terminal that reports a width, `columns` is the smaller of that width and a valid `COLUMNS`, and the real width otherwise, so `COLUMNS` never widens a layout past the screen. On a terminal that reports no width, `columns` is a valid `COLUMNS`, and `undefined` otherwise. On a destination that is not a terminal, `columns` is `undefined` whatever `COLUMNS` says, because some shells export `COLUMNS` and piped output would otherwise wrap unasked. `host.terminal.stdout.columns` and `host.terminal.stderr.columns` are the real readings and never reflect `COLUMNS`. The row count `out.draw` resolves to uses the real stderr width read at that draw.

`pad(text, minimumWidth, options?)` returns a marked string. `options.align` is `'left'`, `'right'`, or `'center'`, defaulting to `'left'`. Padding uses spaces only. It supplies a minimum width, never truncates text, and puts an odd extra space on the right for center alignment. Width arguments are nonnegative safe integers.

```ts
pad('cat', 8);
pad('cat', 8, { align: 'right' });
pad('cat', 8, { align: 'center' });
```

These produce five spaces after `cat`, five spaces before it, or two before and three after it. Core defers actual padding until glyph selection, so a compatibility form such as `(*)` occupies its real width. Padding expands tabs within each input line before adding alignment spaces. Ordinary output outside padding preserves tabs, except where a view expands them with `expandTabs`, below, as the marked lanes, the [table](../plugins/pack-views.md#table), and the [records](../plugins/pack-views.md#records) layout do on a terminal.

Padding applies to each line independently and preserves line breaks. A trailing newline does not create a padded extra empty line. Interior blank lines are lines and receive the requested padding. For example, `pad('cat\ndog', 5)` resolves to `cat  \ndog  `, while `pad('cat\n', 5)` resolves to `cat  \n`. CRLF remains CRLF. The empty string has width zero; padding it produces the requested number of spaces.

`nowrap(text)` returns a marked string, as `pad` does. It takes one string and throws `TypeError('Style helpers require a string.')` for any other value, as `pad` does. The frame is deferred and resolves to its body exactly: it adds no byte, expands no tab itself, and measures as its body, so copying the printed text gives the exact text. A view that expands tabs with `expandTabs` expands a tab inside the frame as any other, and the frame still keeps its body whole. Frames nest, so a style or a glyph inside it is fine. It exists for line breaking: `wrap` keeps its body whole, and a table's floor counts it whole. A path that holds spaces is the case it serves.

```ts
import { nowrap } from '@loomcli/core';

out.info(`Wrote ${nowrap(path)}`);
```

With `path` set to `/Users/a/Library/Application Support/x` and a lane that leaves 30 columns for the message, the path stays on one line and the text before it wraps:

```text
ℹ Wrote
  /Users/a/Library/Application Support/x
```

The view context supplies `wrap(text, columns): string`, which breaks lines when the view runs. It measures with that destination's glyph forms exactly as `width()` does, ignores styling and hyperlink envelopes, and returns marked text with real line breaks inserted. It is not a deferred frame. `pad` stays the deferred minimum-width composer, and the [wire contract](../maintaining/style-wire.md) carries one frame for line breaking, `nowrap`, below. The idiom is `context.wrap(text, context.columns)`. With `columns` undefined, `wrap` returns the text unchanged, so the same view wraps at a terminal and passes the text through a pipe. Any other `columns` that is not a positive safe integer throws `RangeError('Wrap width must be a positive safe integer.')`.

- **Greedy.** Each output line takes as many words as fit within `columns`, and a line exactly `columns` wide fits.
- **Breaks are at spaces only.** The only break opportunity is U+0020. Text without spaces, such as Chinese, Japanese, or Thai prose, does not wrap, however wide it is. `wrap` implements no Unicode line-breaking rules.
- **Line breaks are kept.** LF and CRLF stay as written, CRLF stays CRLF, and each input line wraps independently. An inserted break is LF, or CRLF on an input line that ends in CRLF.
- **A long word stays whole.** A word wider than `columns` keeps a line of its own and is never split, so a URL, a token, a hash, a path without spaces, or any text inside `nowrap` copies intact.
- **Spaces at a break are dropped.** An input line's leading spaces are never a break, and they stay with its first word. Spaces at the end of an input line are never a break, and they stay with its last word. Both count toward the fit, so `wrap('ab cd   ', 5)` is `ab` and then `cd   `. Continuation lines start at column 0, and indenting them is the caller's job. Runs of spaces inside a line are kept.
- **Tabs** measure at stops of eight as `width()` does, and a line never breaks at a tab. `wrap` keeps each tab as written, so its stops count from column 0 of each output line. A view that places the wrapped text after other text expands the tabs first with `expandTabs`, below, as the marked lanes, the [table](../plugins/pack-views.md#table), and the [records](../plugins/pack-views.md#records) layout do on a terminal.
- **A `pad` frame or a `nowrap` frame is one unit.** `wrap` measures a `pad` frame at its padded width and a `nowrap` frame at the width of its body, and never breaks inside either.
- **A style or a hyperlink that spans a break** continues across it. The break is inserted inside the envelope, as an authored line break sits, so the span continues on the next line. A lane's gutter on a continuation line carries the span as it does after an authored break.

Loom's first-party messages wrap each filesystem path and URL they print in `nowrap`, so a path that holds spaces, such as a macOS folder under `Application Support`, stays whole on screen. They do so wherever the text resolves frames: a lane, a view such as the service status view, and a `FatalError`'s message. An `InputError`'s default text prints its message as data, so a frame there would show its delimiters, and a path in an `InputError`'s message, such as the configuration plugin's `File "…"` failure, or in a wrong value's label stays unmarked. The wrapping changes no message text, because `nowrap` adds no bytes.

```ts
import type { View } from '@loomcli/core';

export const notice: View<string> = {
	render: (message, context) => `${context.wrap(message, context.columns)}\n`,
};
```

At 30 columns, `Copy the file to /srv/releases/2026-10-17/archive.tar.gz and restart the service.` renders as three lines. The path is wider than 30 columns, so it keeps the second line whole.

```text
Copy the file to
/srv/releases/2026-10-17/archive.tar.gz
and restart the service.
```

The view context supplies `expandTabs(text): string`, which replaces each tab in marked text with spaces up to the next multiple of eight columns, counted from the start of the tab's own input line as `width()` counts, so text a view places after a gutter, a label, or another column shows on screen as it measured. The terminal counts a tab's stop from the screen's column 0, so a tab left in text placed at an offset can move by up to seven columns and push the line past `columns`. `expandTabs` measures with that destination's glyph forms, as `width()` does, and keeps every frame header, escape, and ANSI command byte for byte. A tab inside a style frame or a `nowrap` frame expands as any other, and a tab inside an ANSI control string, such as an OSC payload, is no tab and stays. A tab inside a `pad` frame stays, because the frame already expands it from its own start when it resolves. The spaces a tab becomes are ordinary spaces, so `wrap` may break at them outside a `nowrap` frame. `expandTabs('a\tb')` is `a` and seven spaces before `b`, and text without a tab comes back unchanged. It is unconditional: a view that keeps tabs off a terminal calls it only when `columns` is defined, as the marked lanes, the [table](../plugins/pack-views.md#table), and the [records](../plugins/pack-views.md#records) layout do.

There is no align helper. A caller aligns a wrapped block by pairing `wrap` with `pad`, whose alignment applies to each line: `pad(context.wrap(text, 20), 20, { align: 'center' })`.

`splitLines(text)` splits marked text at its line breaks, LF and CRLF, into an array of lines that each stand alone, for a view that places lines beside other text, as a table places a cell's lines beside the next column and the records view places a value's lines after its indent. Every frame open at a line's end, a style, a `pad` frame, or a `nowrap` frame, closes there and opens again at the start of the next line, in its nesting order. An SGR attribute and an OSC 8 hyperlink embedded in the text end at each line's end and start again on the next, so nothing on one line styles or links the text placed after it. A line that sets an SGR attribute sits in a style frame with no operation, whose end restores the style around it and adds no byte to the output. The line breaks themselves are dropped. A trailing line break ends the last line and adds no empty line, the rule `pad` follows for a trailing newline, while a blank line inside the text is a line: `splitLines('a\n')` is `['a']`, and `splitLines('a\n\nb')` is `['a', '', 'b']`. A line break inside an ANSI control string, such as an OSC payload, is not a line break. Text without a line break comes back as one line, unchanged unless it sets an SGR attribute or leaves a hyperlink open. `splitLines` breaks only where the text already has a line break, so a view pairs it with `wrap`: `splitLines(context.wrap(text, width))`. It reads the wire with the parser core's resolver uses, and takes one string, throwing `TypeError('Style helpers require a string.')` for any other value, as `pad` does.

```ts
import { splitLines, style } from '@loomcli/core';

splitLines(style.red('one\ntwo'));
// [style.red('one'), style.red('two')]
```

Lane views receive the original message string, including line breaks and authored styles. Core does not split it into a new data structure or infer that later lines are details. A lane view owns its glyph gutter and continuation indentation. It measures the selected glyph form rather than assuming one column. The built-in `info`, `success`, `warn`, and `error` lanes prefix the first line with the matching glyph and one space. The `debug` lane prefixes it with `glyph.pointerSmall` and one space, and the `trace` lane with two spaces, `glyph.lineVerticalDashed0`, and one space, so a trace line's gutter measures the glyph plus three. The `debug` lane styles its glyph and the message `dim` and the `trace` lane styles them `dim.faint`, the spaces of either gutter unstyled, and the message keeps its author's styles inside that frame. Continuation lines use spaces for that gutter without repeating the glyph. Those six lanes also wrap the message with `wrap` at `columns` minus the measured gutter, which fits the message in the columns right of the gutter, and every continuation line carries the gutter, whether the break is authored or wrapped. When `columns` is defined, before they wrap, they expand each tab in the message to spaces with `expandTabs`, counted from the start of its own line of the message, inside style and `nowrap` frames too, so the gutter moves no tab stop and lane output on a terminal holds no tab. With `columns` undefined, as on a pipe or under an invocation by name, lane output is byte for byte what it would be without wrapping, tabs included. With no column left after the gutter, the message is not wrapped, and its tabs still expand. `print` remains prefix-free and never wraps. An application that wants unwrapped lanes replaces the lane view, as it can replace any lane view. The semantic methods retain their string-only call shape and newline contract. Each lane is a declared view core exports under `lanes`, and an application replaces its function through `views` as [Views](views.md) describes; the newline the semantic method appends is outside the view and survives any override.

### Measuring written text

```ts
function width(text: string): number;
```

```ts
import { width } from '@loomcli/core';

width('\u001b[1mName\u001b[22m  \u001b]8;;https://example.com\u001b\\docs\u001b]8;;\u001b\\'); // 10
width('名前\tok'); // 10
```

- **What it measures.** `width` counts the columns a terminal shows for text as a stream received it, such as a mock's [`stdout.text`](../libs/testing.md#mockprocess), so a test checks a render against a width with the measure core renders with.
- **The same columns.** It skips every terminal control sequence, an SGR style, an OSC 8 hyperlink, and a cursor movement alike, and counts what remains as the view context's `width` counts it: the same grapheme widths, the same tab stops, the widest line, and LF and CRLF as line breaks.
- **Written text, not marked text.** It reads no marked-string frame and resolves no glyph. A view measures its own marked text with the view context's `width`, which resolves the glyph forms of its destination first.

## When author code fails

A view that calls `wrap`, `pad`, `nowrap`, `splitLines`, or a style helper with an argument the call rejects throws the call's `TypeError` or `RangeError` from the view, and a view function that throws takes the [ordinary failure path](failures.md#the-ordinary-failure-path), where an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). Where the failure surfaces follows the write site, under [Views](views.md#when-author-code-fails). A theme mapping value that is neither an unapplied concrete chain nor an adaptive style throws from `plugin()`, as the mapping rules above state.
