- Add `ceiling` to `ProcessHandle` and `Host` in `@loomcli/core`: an optional directory above which the configuration plugin's project walk never looks. Core copies it into `host.ceiling` at entry. The real process's handle names none, so a real run walks as before, and `processHandle({ ceiling })` names one. See [Host](docs/core/host.md#the-process-handle).
- Change the project walk of `@loomcli/plugins/config` to end at the host's ceiling when it has one. The walk looks in the ceiling directory itself and never in an ancestor of it, and ends at whichever it meets first of below home, the ceiling, a root marker, and the filesystem root. The home file, the XDG user file, `--config`, and the author's variable are not bounded. See [Lookup](docs/plugins/config.md#lookup).
- Change `mockProcess` in `@loomcli/testing` to name its `cwd` as its ceiling unless the test supplies `ceiling`, whether or not the `cwd` is inside `home`. A mock run's configuration walk reads from its working directory and never from a directory above it, so a configuration file above a test's sandbox, such as the developer's own above a checkout, no longer reaches the test. `MockProcess` reads the ceiling as `ceiling`. See [mockProcess](docs/libs/testing.md#mockprocess).

### Migration

**Affected surface.** The break has no compile error. It affects tests that run an application on `mockProcess` from `@loomcli/testing` with a `cwd` below the directory that holds the configuration file, and that expect the configuration plugin's walk to climb to that file, such as a test that starts in a project's `src` directory and reads the project's file. Such a test compiles unchanged, and its run now finds no file in the walk: it reads the schema's output for an empty file, or the home file or the XDG user file when the test wrote one. A test whose file is in its `cwd`, a test that names its file with `--config` or the author's variable, and a test that reads the home file are unaffected.

**Why.** A mock with a temporary home and a `cwd` outside that home walked to the filesystem root, so a test run from a checkout under the developer's home read the developer's own configuration file in an ancestor of the checkout. The mock's ceiling keeps every mock run's walk inside its working directory.

**Before and after.**

Before, the walk from `src` climbed to the file in `root` and above it:

```ts
const root = mkdtempSync(join(tmpdir(), 'notes-'));
mkdirSync(join(root, 'src'));
writeFileSync(join(root, '.notes.json'), '{ "limit": 5 }');

const mock = mockProcess({ argv: ['list'], cwd: join(root, 'src') });
await application.run({ process: mock }); // read root/.notes.json
```

After, the walk looks in `src` alone, so the test names `root` as its ceiling:

```ts
const mock = mockProcess({ argv: ['list'], ceiling: root, cwd: join(root, 'src') });
await application.run({ process: mock }); // reads root/.notes.json, and never looks above root
```

**Steps.**

1. Find each test that passes `mockProcess` a `cwd` and writes the configuration file into a directory above that `cwd`.
2. Add `ceiling` to that mock's fields, set to the directory that holds the file or to the test's temporary directory, whichever the walk should stop at. Keep the ceiling inside the test's temporary directory, so the walk never reads a file the test did not write.
3. Where a shared base of fields, such as a `MockFacts` constant, sets `cwd` for several tests, add `ceiling` beside it.

**Validation.** Run the application's test command, such as `vitest run` or `bun test`. A test that relied on the walk climbing above its `cwd` fails its assertion on the configured value before step 2 and passes after it.
