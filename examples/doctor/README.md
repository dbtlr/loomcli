# doctor

doctor is a private example plugin, `@loom/doctor`, that attaches one ordinary Command named `doctor` to the root of the application that installs it. The Command reports a few checks about the host the application runs on. [`src/plugin.ts`](src/plugin.ts) declares it.

[jsonkit](../jsonkit/README.md) installs it, and `jsonkit doctor` is the Command it adds. textstat does not.

## What it covers

- **Plugin Commands** ([reference](../../docs/core/plugin-contract.md#plugin-commands)). The plugin attaches its `doctor` Command to jsonkit's root, and `jsonkit doctor` routes and runs it. The Command leads the root's Commands, and `jsonkit --help`, `inspect()`, and `--manifest` list it first. The plugin compiles in its own package, outside any Application's `Register` augmentation, so the Command requires no globals. It reads no document and declares no file option, so it runs at a terminal.
- **Pack views** ([reference](../../docs/plugins/pack-views.md)). The action reports its checks through the pack views instead of one `print` line. It renders `Host checks` through `heading()` ([reference](../../docs/plugins/pack-views.md#heading)), then a `list<string>()` ([reference](../../docs/plugins/pack-views.md#list)) of two checks, `Platform: <host.platform>` and `Output: a terminal` or `Output: not a terminal` from `host.terminal.stdout.isTTY`, then `''` through `rule()` ([reference](../../docs/plugins/pack-views.md#rule)), then `All checks passed.` through `box({ title: 'Result' })` ([reference](../../docs/plugins/pack-views.md#box)). The package depends on `@loomcli/plugins`. Piped, it prints:

  ```text
  Host checks
  ───────────
  ● Platform: linux
  ● Output: not a terminal
  ────────────────────────────────────────────────────────────────────────────────
  ╭─ Result ───────────╮
  │ All checks passed. │
  ╰────────────────────╯
  ```
