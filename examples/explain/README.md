# explain

explain is a private example plugin, `@loom/explain`, that explains the Command an invocation routes to instead of running it. Its `--explain` option, with the short spelling `-e`, prints the routed Command's path, its description, and the details and examples its declaration carries, then ends the invocation without reading a document or file. An unknown option's diagnostic also points at that explanation.

[textstat](../textstat/README.md) and [jsonkit](../jsonkit/README.md) both install it. [`src/plugin.ts`](src/plugin.ts) is the plugin, and [`src/extension.ts`](src/extension.ts) is the declaration they attach to a Command.

## What it covers

- **Extensions** ([reference](../../docs/core/extensions.md)). The plugin defines the `explainCommand` extension, which both examples attach to a Command with `details` and `examples` values. It lives in a separate `@loom/explain/extension` entry, so it is declarations alone: an application that installs no explain plugin still compiles against it, and a projection reads the value without importing the plugin's middleware. The example plugin keeps its own descriptor beside help's, because the two are separate facts.
- **Option-activated middleware** ([reference](../../docs/core/plugin-contract.md#activation)). `--explain` is a control option that activates the middleware, and the implementation loads on demand from [`src/middleware.ts`](src/middleware.ts). The middleware ends the invocation by returning without calling `next()`, so the remaining tokens are never parsed.
- **Failure hints** ([reference](../../docs/core/failures.md)). The plugin's `onFailure` hook adds `Run "<application> <path> --explain" to explain this command.` to an unknown option's diagnostic ([`src/hint.ts`](src/hint.ts)). Every other failure gets no hint, and so does an invocation by name.
