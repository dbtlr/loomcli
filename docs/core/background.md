---
description: "How core settles the run's terminal background once, from the operator's choice through the terminal's own answer, and how an adaptive theme entry resolves to it."
---

# Background

This page states the core rule for the run's terminal background: how core settles it once, from the operator's choice through the terminal's own answer, and how an adaptive theme entry resolves to it. The [background plugin](../plugins/background.md) documents the option that gives the operator that choice.

```ts
import type { ConcreteStyle, ExtensionValue, Host, InputTerminal, OutputTerminal, StandardSchemaV1, Style } from '@loomcli/core';

type Background = 'dark' | 'light';

interface AdaptiveStyle { // a theme entry holding one concrete style per background, opaque and branded
  readonly [adaptiveStyle]: true; // adaptiveStyle is an unexported unique symbol
}
declare const style: Style & { // the exported style carries one member; a chain and the contextual style do not
  readonly adaptive: (sides: { readonly dark: ConcreteStyle; readonly light: ConcreteStyle }) => AdaptiveStyle;
};
type ThemeMapping = Readonly<Record<string, ConcreteStyle | AdaptiveStyle | undefined>>;

interface RenderingPolicy {
  color?: 'auto' | 'always' | 'never' | undefined;
  modifiers?: 'auto' | 'always' | 'never' | undefined;
  hyperlinks?: 'auto' | 'always' | 'never' | undefined;
  terminalControls?: 'strip' | 'preserve' | undefined;
  background?: 'auto' | Background | undefined;
}

interface ViewContext {
  // columns, expandTabs, plain, style, width, and wrap are unchanged
  readonly background: Background | undefined; // undefined when nothing settled it
}

interface HostTerminal { // the type of Host['terminal']
  stdin: InputTerminal;
  stdout: OutputTerminal;
  stderr: OutputTerminal;
  readonly background: Background | undefined; // undefined when nothing settled it
}
type HostOverrides = Partial<Omit<Host, 'terminal'>> & { // what RunOptions.host accepts
  terminal?: Omit<HostTerminal, 'background'> & { readonly background?: Background | undefined };
};

interface Unmarked { interaction?: never; color?: never; verbose?: never; quiet?: never; background?: never } // content and unmarked string options, and option()
type BooleanFacts = /* the existing facts */ & { background?: never };
// CountOption declares background?: never beside its interaction?: never and color?: never.

type StringOption =
  | (UnmarkedStringOption & { background?: never }) // the existing shapes, unchanged
  | {
      type: 'string';
      background: true; // the background mark
      aliases?: readonly string[];
      validate?: StandardSchemaV1;
      description?: string;
      hidden?: boolean;
      deprecated?: string;
      control?: boolean;
      extensions?: readonly ExtensionValue<'option'>[];
      short?: never;
      shortOnly?: never;
      env?: never;
      default?: never;
      implied?: never;
      multiple?: false;
      required?: never;
      validateOmitted?: never;
      polarity?: never;
      interaction?: never;
      color?: never;
      verbose?: never;
      quiet?: never;
    };
```

```ts
import { Application, style } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import { theme } from '@loomcli/plugins/theme';

const app = new Application('notes', {
  plugins: [
    theme({
      highlight: style.adaptive({
        dark: style.hex('#C97B36', { ansi256: 172, ansi16: 'yellow' }),
        light: style.hex('#9C5A1E', { ansi256: 130, ansi16: 'yellow' }),
      }),
      identifier: style.cyan,
    }),
    background(),
  ],
}).action(({ host, out, style }) => {
  // On a light terminal, or under notes --background=light, highlight prints #9C5A1E and host.terminal.background reads 'light'.
  // When no source settles the background, host.terminal.background reads undefined and highlight prints its dark side.
  // identifier is a plain entry, so it prints cyan on either background.
  out.success(`${style.highlight('Saved')} to ${style.identifier('notes.md')}.`);
});
```

A themed color that reads well on a dark terminal can vanish on a light one. Core settles each run's background once, right after the [color choice](color.md) and before graph build, so the first themed byte already knows it, and a theme entry declared with `style.adaptive` resolves to the side that matches. [ADR-0092](../decisions/0092-core-settles-each-runs-background-once-and-a-theme-entry-may-adapt-to-it.md) records the decision.

- **Adaptive entries.** `style.adaptive({ dark, light })` returns an adaptive style, a theme entry that holds one style for each background. Each side follows the rule of a plain [theme entry](styles.md#theme-plugins-and-typed-names), an unapplied concrete chain with no semantic token, with its own [fallbacks](styles.md#explicit-color-fallbacks), so the light side carries its own hex value and its own 256- and 16-color fallbacks. Each time core emits the token, it resolves the side that matches the run's background, at every depth: the light side when the background is `'light'`, and the dark side when it is `'dark'` or `undefined`. A plain entry looks the same on both backgrounds. An adaptive style is not a chain: it styles no text and chains no further, so it belongs in a theme mapping alone, and a custom key that maps to one still adds its name to the Application vocabulary. Only the exported `style` carries `adaptive`; a chain such as `style.bold` and the contextual `style` carry none, so a theme may still name a token `adaptive`.
- **Checked at the call.** `style.adaptive` checks its argument when it is called, as the color helpers do, and keeps a copy, so a later change to the object changes nothing. A value that is not a plain object, a key other than `dark` and `light`, a missing side, and a side that is not an unapplied concrete chain without semantic tokens each throw `TypeError('Adaptive styles take an unapplied concrete style chain for dark and for light.')`. The types reject a semantic chain, an adaptive style, or `undefined` as a side.
- **The settled background.** The first of these sources that answers settles the run's background, `'dark'`, `'light'`, or `undefined`, and it never changes within the run:
  1. The operator's background choice, below.
  2. The author's `rendering.background`, `'dark'` or `'light'`, with `run()`'s field over the Application's, as [Rendering policies](styles.md#rendering-policies) merges fields. `'auto'`, the default, answers nothing.
  3. A background a host override states as `host.terminal.background`, so a test settles it without a query.
  4. `undefined`, when stdin, stdout, or stderr is not a terminal, as in `app | fzf`, `app | less`, `app > file`, or `cat notes | app`, or when the run's color is off on both stdout and stderr after the color choice, as under `--no-color` or automatic `NO_COLOR`, so no query runs. A program at the other end of a pipe may read the terminal itself, as fzf reads `/dev/tty`, and would race core for the replies and for the terminal's mode.
  5. Dark, when `TERM` is `linux`, the Linux console, whose background is black.
  6. The terminal's answer to the background query, below.
  7. `COLORFGBG`, when it is set and nonempty: light when its last `;`-separated field is `7` or `15`, the palette's white, and dark otherwise.
  8. `undefined`, so a background no source knows never passes for dark.
- **Detection runs for a reader.** Steps 4 through 8 detect the background, and they run only when an entry of the installed theme is adaptive or the Application declares the background mark, as the [background plugin](../plugins/background.md) does. Otherwise core detects nothing and writes no query, and the background stays `undefined` unless step 1, 2, or 3 states it. An author whose code reads the background installs `background()`, which also gives the operator `--background`.
- **Settled once, before preparation.** Settlement reads `TERM`, `COLORFGBG`, `STY`, and `INSIDE_EMACS` from the captured `host.env`, and the run's color as the color choice and the captured environment leave it, before [environment preparation](plugin-contract.md#environment-preparation). A variable a hook such as [dotenv](../plugins/dotenv.md)'s imports changes no background. So a color change during preparation leaves the background as settled: when the shell sets `NO_COLOR` and a dotenv file imports `FORCE_COLOR=1`, the background settles `undefined` at step 4 with no query, and the run's colored output resolves each adaptive token to its dark side.
- **The background query.** At step 6, unless a skip below applies, core writes three queries in one write: `ESC ] 11 ; ? ESC \`, OSC 11, which asks for the background color; `ESC [ ? 996 n`, which asks whether the color scheme is dark or light; and `ESC [ c`, the Primary Device Attributes query, DA1, as the sentinel. Core writes them itself, ahead of any other byte of the run and outside the rendering policy, to stderr, which step 4 leaves a terminal whose color is on. A terminal answers in the order it was asked and nearly every terminal answers DA1, so once the DA1 reply arrives, any other reply has arrived or never will.
- **The answer.** An OSC 11 reply, `ESC ] 11 ; rgb:R/G/B` ended by BEL or by `ESC \`, with 1 to 4 hex digits in each component, each scaled by its own width, answers light when the color's relative luminance, as WCAG 2 computes it from sRGB, is above 0.5, and dark otherwise, so exactly 0.5 answers dark. When no OSC 11 reply parses, a color-scheme reply answers: `ESC [ ? 997 ; 1 n` dark, and `ESC [ ? 997 ; 2 n` light. With neither, the query has no answer, and settlement continues at step 7.
- **The read.** Core puts `host.stdin` in raw mode and reads until the DA1 reply. It removes every OSC 11 reply, every `ESC [ ? 997 ; <n> n` reply, and the DA1 reply from what it read, and pushes every other byte back onto the front of `host.stdin` in arrival order, so keys the operator typed before, between, or after the replies reach the action's own stdin read. Core reads through a `data` listener and `resume()`. In a `finally`, core restores the mode it found, removes every listener it added, and pauses the flowing stream, which emits `pause`, the event on which the runtime stops a terminal's handle reading, so stdin keeps no run alive and an action that never reads stdin ends without a key pressed. `pause()` leaves the flowing state `false`, so core then sets `readableFlowing` back to the state it found, so an action's own `data` listener starts the stream flowing as it would on a stream core never touched.
- **Interrupt keys.** Raw mode turns `Ctrl-C`, `Ctrl-\`, and `Ctrl-Z` into the bytes 0x03, 0x1c, and 0x1a instead of signals. Core drops each one it read during the wait from the typeahead, and once it has restored the mode, it raises SIGINT, SIGQUIT, or SIGTSTP for each on its own process, in arrival order, so the run behaves as if the key came a moment later. Settlement runs before graph build, before the run's cooperative claim is taken, so a raised SIGINT or SIGQUIT takes the [immediate path](signals.md#the-immediate-path) when core is listening and the runtime's default otherwise: either way the process ends, which a shell reports as status 130 or 131, and SIGTSTP stops it until the shell resumes it.
- **The deadline.** One unref'd timer of 1 second backs the read, for a pseudo-terminal with no emulator behind it, a stalled SSH link, or a terminal without DA1. Core clears it as soon as the DA1 reply arrives. When it fires, core restores the mode and reads the replies that arrived before it as the answer above states, so an OSC 11 reply counts even when the DA1 reply never came. With no reply before it, the query has no answer, and settlement continues at step 7. An abort of the run signal ends the wait at once in the same way. The timer never keeps the process alive. It bounds core's own wait for the reply to a query core wrote, before any author code runs, and cancels and limits no work, so it keeps the timer rule [ADR-0091](../decisions/0091-live-regions-stack-at-the-bottom-of-stderr-and-progress-reaches-invoke-callers-and-mcp-clients-as-typed-events.md) states: "Core never uses a timer to cancel or limit work because it has run too long; that is the author's job, in the author's own action." A reply that arrives after the deadline is not read.
- **Skipped.** At step 6, core writes no byte and reads none when the run signal is already aborted; when `host.stdin` has no `setRawMode`, or its `setRawMode(true)` throws; when `TERM` is unset, empty, or `dumb`; when `STY` or `INSIDE_EMACS` is set and nonempty, because GNU screen and Emacs do not pass the query through; and when `host.stdin` is a real terminal stream and the process is not in that terminal's foreground job. Settlement then continues at step 7. A run that settles at steps 1 through 5, and a run that detects nothing because no theme entry is adaptive and no option carries the background mark, writes no query either. A completion request a shell's completion script makes settles at step 4 and writes no query, because every script the [completion plugin](../plugins/completion.md) prints captures the request's stdout and discards its stderr, so neither is a terminal. Core sees no route before settlement, so a `__complete` request typed by hand at a terminal settles as any other run does.
- **The foreground check.** A background job that switches its terminal to raw mode is stopped by SIGTTOU, and one that reads it by SIGTTIN, under Node and Bun alike. So before the query core compares its process group with its terminal's foreground process group, read from `/proc/self/stat` where it exists and otherwise from `ps -o tpgid=,pgid=` for its own process id, and skips the query unless the two match. A check that cannot tell skips the query. A `host.stdin` that is not a real terminal stream, such as a test's scripted one, is under no job control, so core skips the check for it.
- **Where it reads.** `host.terminal.background` holds the settled background for the action, middleware, validators, and every hook that reads the host. The view context's `background` holds it for every view: core reads it just before each render call, as it reads `columns`, and it holds one value for the whole run. Both read `undefined` when no source settled the background, and until it settles, as in the report of a failed host capture, so an author's code can tell an unknown background from a dark one. `background` is the one terminal fact core settles rather than captures: a host override that states it supplies step 3, and the field reads the settled background either way. A `host.terminal` override that omits it leaves the run to settle as above.
- **Invocations by name.** `app.invoke`, an action's `invoke`, and so every [MCP](../plugins/mcp.md) tool call settle nothing and write no query. Their host has no terminal, their captured text is plain under [Invocation by name](invocation.md#invocation-by-name), and their `host.terminal.background` and view contexts read `undefined`.
- **The background choice.** In an Application that declares the background mark, core reads the operator's background choice from `host.argv` alone, beside the color choice: among the words before the first bare `--`, the last occurrence of a marked spelling whose value is `dark` or `light`. The spellings are the option's long spelling and its aliases' long spellings. The value is attached, as in `--background=light`, or is the next word, as in `--background light`, unless that word is an option word or the bare `--`. An occurrence with any other value supplies nothing, so with no such occurrence the run has no choice and settles from step 2.
- **Exact without parsing.** Under the grammar of [String values and token consumption](options.md#string-values-and-token-consumption), an option word is never a separate value, and a global option's spelling cannot be a local option's, so a word that equals a marked spelling is that option wherever it sits, and the word after it is its value exactly when the parse reads it so. The marked option declares no implied value, so a bare spelling takes the next word as any string option's does. A spelling whose value is not `dark` or `light`, such as `--background=blue`, supplies nothing, and the ordinary parse and validation still report it at their usual place. A repetition such as `--background=dark --background=light` sets `'light'`, and the parse still fails it as the repetition every option that is neither multiple nor counted meets.
- **The option still parses.** The marked option is an ordinary string global option to routing, parsing, validation, and [activation](plugin-contract.md#activation), so its value reaches every action and middleware as `options.background`, `undefined` when the operator typed none. It says what the operator typed, never the settled background, which `host.terminal.background` holds. Core reads only `dark` and `light`; the [background plugin](../plugins/background.md)'s validator rejects any other value, and an application that marks its own option declares its own validator when it wants the same failure.
- **One source.** The marked option binds no environment variable and no configuration key, and takes no default, implied value, `multiple`, or short alias, so argv is its one source. `COLORFGBG` is the environment's standard input for the background, so no application-named variable joins it, the configuration source answers after parsing, too late for the output before it, and the author's own default is `rendering.background`.
- **The mark.** `background: true` on a string global option, the application's or a plugin's, marks it. At most one option of an Application carries the mark. `inspect()` publishes `background` on each string option node, `true` on the marked one, and the [manifest](../plugins/manifest.md) copies it. The [background plugin](../plugins/background.md) declares a marked `--background`.
- **Names.** `Background`, `AdaptiveStyle`, `HostTerminal`, and `HostOverrides` are exported from `@loomcli/core` as types.
- **One mark.** An Application declares one marked option. The fault throws from the call that brings the second mark into the Application, as a [spelling collision](options.md#declaration-and-invocation-errors) does, and names each option as [Input declaration errors](options.md#input-declaration-errors) names it: [`@loomcli/core/background-mark`](diagnostics.md#loomclicorebackground-mark).
- **No configuration binding.** The marked option carries no configuration binding, a second source for the run's background, because the run reads its background before configuration. The fault throws where the [color mark](color.md)'s binding fault does: from `globalOption()` for an application's option and from the constructor for a plugin's option: [`@loomcli/core/background-mark`](diagnostics.md#loomclicorebackground-mark).

The types reject `background` on `option()` and on every option type but `string`, and `short`, `shortOnly`, `env`, `default`, `implied`, and `multiple: true` beside `background: true`. A configuration binding is an ordinary extension value to the types, so that rule reaches the runtime check alone.
