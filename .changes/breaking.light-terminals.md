- Add adaptive theme entries. `style.adaptive({ dark, light })` returns a theme entry that holds one unapplied concrete chain for each background, each with its own fallbacks, and core resolves its token to the side that matches the run's background at every color depth, taking the dark side when the background is unknown. A theme mapping may hold adaptive entries beside plain ones, and only the exported `style` carries `adaptive`, so a theme may still name a token `adaptive`. `style.adaptive` checks its argument when it is called and throws `TypeError('Adaptive styles take an unapplied concrete style chain for dark and for light.')` for anything else. See [Background](docs/core.md#background).
- Add the run's background, `'dark'`, `'light'`, or `undefined`, which core settles once per run, right after the color choice and before graph build, from the first source that answers: the operator's background choice, the author's new `rendering.background` (`'auto'`, `'dark'`, or `'light'`), a background a `run({ host: { terminal } })` override states, and then, only when an installed theme entry is adaptive or an option carries the background mark, `undefined` with color off on both streams, dark when `TERM` is `linux`, the terminal's answer to a background query, `COLORFGBG`, and `undefined`. Actions, middleware, and hooks read it as `host.terminal.background`, and every view reads it as the view context's `background`. An invocation by name reads `undefined`.
- Add the background query. On a terminal, core writes OSC 11, `CSI ? 996 n`, and DA1 in one write, reads the replies in raw mode until the DA1 reply or one unreferenced one-second deadline, restores the mode it found, and pushes every byte that is not a reply back onto stdin, so typeahead reaches the action. It writes nothing and reads nothing when stdin is not a terminal or has no raw mode, when no destination is a terminal whose color is on, when `TERM` is unset, empty, or `dumb`, when `STY` or `INSIDE_EMACS` is set, on Windows, and when the run is a background job of its terminal, which raw mode would stop.
- Add the background mark, `background: true` on one string global option, whose `dark` or `light` value core reads from argv beside the color choice. Reject a misplaced mark under `@loomcli/core/background-mark`: the mark on a local option or on a Boolean, content, or counted option, a value other than `true`, a second marked option, and a short alias, `env`, default, implied value, `multiple`, or configuration binding on the marked option. Reject a `rendering.background` other than `'auto'`, `'dark'`, or `'light'` under `@loomcli/core/rendering-policy`.
- Publish `background` on each string `OptionNode` from `inspect()`, `true` on the marked option, and copy it last into each string option entry of the `@loomcli/plugins/manifest` document.
- Add `@loomcli/plugins/background`. `background()` takes no settings and declares the global string option `--background`, validated to `dark` or `light` with the issue `Supply dark or light.`, marked `control` and `background`. Its mark also turns background detection on for a theme that does not adapt. See [Background plugin](docs/core.md#background-plugin).
- Change `loomTheme()` so its six colored tokens adapt: on a light background `dim` is `#5F6B7A`, `highlight` `#9C5A1E`, `success` `#4E6B50`, `warning` `#8A6D0E`, `error` `#C04532`, and `info` `#4A6B91`, with the 256-color fallbacks 243, 130, 65, 94, 131, and 60 and the dark side's 16-color names. A plain override stays one value on both backgrounds. See [Loom theme](docs/core.md#loom-theme).
- Export the types `Background`, `AdaptiveStyle`, `HostTerminal`, and `HostOverrides` from `@loomcli/core`. `RunOptions.host` takes `HostOverrides`, whose `terminal` may omit `background`.

### Migration

**Affected surface.** An option declaration that carries a `background` key, and a `rendering` policy that carries a `background` field, both of which earlier releases ignored. Such a key on a local option, on a Boolean, content, or counted option, with a value other than `true`, beside a short alias, `env`, a default, an implied value, `multiple: true`, or a configuration binding, or on a second option of one Application now throws a `DeclarationError` under `@loomcli/core/background-mark`, and a `rendering.background` other than `'auto'`, `'dark'`, or `'light'` throws under `@loomcli/core/rendering-policy`. An application that declares neither needs no change.

**Why.** `background: true` now marks the string global option whose value sets the run's background, and `rendering.background` states the author's background, so core reads both and rejects a declaration that cannot carry them.

**Before and after.**

Before, a key core ignored, and a background the action guessed from the environment:

```ts
new Application('app', { plugins: [loomTheme()] })
  .globalOption('background', { type: 'string', short: 'b', background: true })
  .action(({ host, out }) =>
    out.print(host.env.COLORFGBG?.endsWith(';15') === true ? 'light' : 'dark'),
  );
```

After, the plugin's `--background` in place of the application's own option, and the settled background read from the host:

```ts
import { background } from '@loomcli/plugins/background';

new Application('app', { plugins: [loomTheme(), background()] }).action(({ host, out }) =>
  out.print(host.terminal.background ?? 'unknown'),
);
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Search the application's option declarations for a `background` key. Remove it, or keep `background: true` on one string global option with no short alias, `env`, default, implied value, `multiple`, or configuration binding, or install `background()` from `@loomcli/plugins/background` in place of the application's own option. `background()` declares the global option `background`, so an application that installs it renames or removes its own option of that name.
3. Search the application's and `run()`'s `rendering` policies for a `background` field, and set it to `'auto'`, `'dark'`, or `'light'`, or remove it.
4. Replace code that reads `COLORFGBG` or guesses the terminal's background with a read of `host.terminal.background`, or of a view context's `background`.

**Validation.** Run `pnpm exec tsc --noEmit`, which reports a misplaced `background` key or a `rendering.background` outside the three values, and run the application once with `--help`, which throws any declaration fault the types cannot see. On a light terminal, run a command that prints themed text and check that `host.terminal.background` reads `'light'`.
