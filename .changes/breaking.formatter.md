- Add `@loomcli/plugins/format`, the formatter plugin. `format()` puts `--format <format>` on every Command that declares a result, listing the record's view names and declared default in its description and accepting `ndjson` as an unadvertised alias of `jsonl`, and its always-on middleware copies a supplied name into the selected view. `--format` on a Command with no result is the ordinary unknown-option error, and an unknown name is the option's validation issue with exit 2.
- Add `json()` and `jsonl()` from `@loomcli/plugins/format`, whole views with an optional `map`. `json()` writes one indented document and `jsonl()` one compact line per element, each escaping DEL and the C1 controls as `\uXXXX`, and both render with the plugin uninstalled as any bare pack view does. The formatter's hook appends them to every result record that lacks the keys, so an author's own `json` is kept as written.
- Add `onCommandAttach` to the plugin definition, a lifecycle hook core calls at graph build once per Command, the root first and then each child depth first, with the hooks of the installed plugins composing in installation order. It receives the declaration unlocked as `AttachedCommand`, the facts `inspect()` publishes beside the `argument`, `option`, `views`, and `extend` calls with their types erased, and returns the declaration to build. The exported types are `AttachedCommand`, `CommandAttachHook`, and `ResultView`. The [core reference](docs/core.md#lifecycle-hooks) states the hook and its build errors.
- Add `request` to the middleware context, the routed Command's parsed and validated invocation as the exported `Request`, `null` while core holds a fault and on a group, and `view`, the name of the view the result renders through, which a middleware assigns before the dispatch boundary and reads as the declaration's default until one does. A name the record does not hold is an internal error at the boundary naming the plugin.
- Change the middleware chain to run after local parsing and validation. Core parses the routed Command's tokens and validates the invocation before the first middleware runs, holds the fault it finds, and raises it at the dispatch boundary, the point the chain reaches when its last middleware continues, so a takeover still observes no fault and a wrapper installed ahead of help still reaches help's takeover. The [core reference](docs/core.md#invocation) states the order.

### Migration

**Affected surface.** A validator on an argument, a local option, or a global option with a side effect, or one that reads the host or awaits a resource, now runs on an invocation a middleware then takes over, `app get --help` included, because local parsing and validation run ahead of the chain. A middleware that took over and relied on no validator having run is affected the same way. `MiddlewareContext` gains required `request` and `view` members. Core supplies them during a run, but hand-built contexts in middleware unit tests must supply them too.

**Why.** A middleware surrounds the whole request. Running the chain ahead of parsing kept a local option invisible to every middleware, so the formatter could not read `--format`, and any plugin that needs the invocation's values would have needed a second chain.

**Before and after.**

Before, a validator that recorded every invocation as a run:

```ts
const app = new Application('audit').argument('target', {
  required: true,
  validate: z.string().transform((value) => {
    audit.record(value);
    return value;
  }),
});
```

After, the validator answers and the action records, since the action runs only when the chain reaches the dispatch boundary:

```ts
const app = new Application('audit')
  .argument('target', { required: true, validate: z.string() })
  .action(async ({ args }) => {
    audit.record(args.target);
    // ...
  });
```

Before, a middleware test could call `middleware(context)` without `request` or `view`. After, a fixture for a group uses `middleware({ ...context, request: null, view: null })`. For a callable Command, supply its parsed and validated `request`; use `null` only when core holds a fault. Set `view` to the declared default for a result Command, or `null` for a Command with no result.

**Steps.**

1. Read every `validate` and `validateOmitted` schema for a side effect, a host read, or an awaited resource. Move a side effect into the action, or make the schema idempotent where the effect is harmless when repeated.
2. Read every middleware that takes over for an assumption that no validator ran. Remove the assumption; the held fault is still never raised under a takeover.
3. Install `format()` after `help()` and `version()` where the application wants `--format`, and rename a local or global option named `format` that collides with it, or install one of the two plugins when another plugin's option already claims `format`, since build reports the collision and the plugin offers no rename.
4. Add `request` and `view` to hand-built middleware contexts. Run the application's TypeScript check to find incomplete fixtures, then exercise any middleware that reads or assigns these members.

**Validation.** Run the application's tests under both runtimes, `pnpm exec vp test --run` and `LOOM_TEST_RUNTIME=bun pnpm exec vp test --run`, and invoke each takeover path, such as `app get --help` with a required argument missing, to confirm it prints as before with any moved side effect absent.
