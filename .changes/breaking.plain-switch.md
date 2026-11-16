- Add the plain switch, which turns off all redrawing so the screen is only ever appended to, for an operator whose screen reader or terminal copes badly with redrawing and one who keeps a readable record of a run. Core turns it on in every application when `ACCESSIBLE` is set and not empty, and the new plain plugin, `@loomcli/plugins/plain`, gives the operator `--plain` for one run. With it on, a progress line prints its start and end lines and nothing between, a streamed message is written a line at a time, and a question asks line by line: each piece is printed once, with no cursor movement or erase sequence, and the operator types the answer and presses Enter. The question reads its keys in raw mode, as it does when it redraws, and echoes what is typed itself, nothing at a secret, and a search offers its default by label, which Enter alone takes. Messages, color, verbosity, and whether a question asks are unchanged, so `-q`, `--no-input`, and `NO_COLOR` each keep their own job. The [output reference](docs/core/output.md#the-plain-switch) and the [prompts reference](docs/libs/prompts.md#asking-line-by-line) state the contract.
- Add the `plain` mark to `@loomcli/core`'s Boolean global options, which an application puts on its own option for another spelling, under the new rule `@loomcli/core/plain-mark`. `OptionNode`'s Boolean variant and the manifest's Boolean option entry gain `plain`.
- Add `questionLine`, `QuestionLine`, and `NumberedChoice` to `@loomcli/prompts/views`, the declared view and data that draw each piece of a question asked line by line, so an application restyles it with `override`.
- Change a question under `TERM=dumb` to ask line by line, as the plain switch makes it ask, rather than redraw with cursor movement the terminal cannot perform. An input region is not live under `TERM=dumb` or the plain switch, so its `live` reads `false` there, and it still takes its turn among the run's input regions: its `draw` writes nothing and resolves once its turn has come. Under CI nothing changes.

### Migration

**Affected surface.** No compile error: behavior changes at run time. The surface is an action, a middleware, or a library that opens `out.region({ input: true })` itself and draws its frames there, run on a terminal under `TERM=dumb` or with `ACCESSIBLE` set. Such a region's `live` now reads `false`, and its frames draw nothing. A question from `@loomcli/prompts` needs no change, though a test that asks one on a mock terminal with `TERM: 'dumb'` now reads its line-based pieces in `mock.stderr.text` rather than frames.

**Why.** An input region redraws in place with cursor movement and erasure, which a terminal under `TERM=dumb` cannot perform and which the plain switch turns off.

**Before and after.**

Before, the region's frames were the only output:

```ts
const region = out.region({ input: true });
await region.draw(state, pickerFrame);
```

After, the region writes plain lines when it is not live, as `progress()` does:

```ts
const region = out.region({ input: true });
if (region.live) {
  await region.draw(state, pickerFrame);
} else {
  await out.draw(state, pickerLines);
}
```

**Steps.**

1. Find each `out.region({ input: true })` your code opens.
2. Read the region's `live` after opening it, and when it is `false`, print each piece once through `out.draw` or a semantic method, and read the operator's answer as a line.

**Validation.** Run the application at a terminal with `TERM=dumb`, and again with `ACCESSIBLE=1`, through each input region it opens, and confirm the region prints its lines and takes its answer. Record such a run with `script`, and confirm the record holds no cursor movement.
