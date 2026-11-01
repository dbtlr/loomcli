- Move the post-install declaration from the Application into `loom.config.json`. `new Application(name, options)` no longer takes `postInstall`, `inspect()` no longer reports it, and `@loomcli/core` no longer exports the `PostInstall` type. The package's `loom.config.json` now holds `postInstall`, with the same `message` and `command`, and `loom init` renders it into `install.sh` without loading the application module. See [the post-install command](docs/toolchain/install.md#the-post-install-command).
  - A `command` that is not a non-empty array of strings is dropped, so the script has no post-install command, and `loom -v` names the dropped value. The message stays.
  - The installer script behaves as before: it runs the command once the install is recorded, `--skip-post-install` skips it, and the message prints last.
- Remove `@loomcli/core/post-install-unrouted`. Nothing checks that the post-install command's words route to a Command with an action: not a development build, not `check()`, not `assertAssembles`, and not `loom init`. Words that route nowhere fail on the operator's install, where the script warns that the application is installed and prints the command to run again.
- Change `loom init`'s `install` piece, so an application module that cannot be loaded, that exports no Application, or that throws a declaration fault no longer stops `install.sh` from being written, and a declaration fault no longer makes `init` exit 1.

### Migration

**Affected surface.** Applications that pass `postInstall` to `new Application(name, options)`, and code that reads `postInstall` from `inspect()` or imports the `PostInstall` type from `@loomcli/core`.

**Why.** Only `loom init` reads the declaration, to render it into `install.sh`, so it belongs in the toolchain's configuration file beside the installer's location rather than in the Application.

**Before and after.**

Before, in `src/application.ts`:

```ts
export const notes = new Application('notes', {
  description: 'Take notes.',
  postInstall: { command: ['setup'], message: 'Run notes init in a project.' },
});
```

After, in `src/application.ts`:

```ts
export const notes = new Application('notes', { description: 'Take notes.' });
```

And in `loom.config.json`, beside `package.json`:

```json
{ "postInstall": { "command": ["setup"], "message": "Run notes init in a project." } }
```

**Steps.**

1. Remove `postInstall` from the options of `new Application(name, options)`.
2. Add the same value as the top-level `postInstall` key of the package's `loom.config.json`, creating the file beside `package.json` when the package has none.
3. Remove any read of `inspect().postInstall` and any import of the `PostInstall` type from `@loomcli/core`.
4. Run `loom init --only install` to render `install.sh` from the file.

**Validation.** Run `tsc --noEmit` to confirm the application compiles without `postInstall`. Run `loom init --only install` and confirm `git diff install.sh` shows no change against the script the previous release rendered, or `loom -v init --only install` to see whether the file's `postInstall` was dropped.
