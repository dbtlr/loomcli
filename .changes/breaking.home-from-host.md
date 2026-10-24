- Change `applicationDirectory(kind, application, from)` to read the home from `from.home`, the run's `host.home`, in place of `HOME` in `from.env`. The XDG variables are still read from `from.env`, and an absolute one still wins over the folder under the home. A home that is empty or not an absolute path still answers `{ variable: 'HOME' }`. See the [installation record reference](docs/core/installation-record.md).
- Change the configuration, completion, logging, manpage, service, skills, and self-update plugins to read the home from `host.home`, and the logging plugin from the log destination's new `home`, in place of `HOME` in the environment. An operator whose `HOME` is unset or relative now has the home the user database holds for them, where every lookup that needed a home used to refuse.
- Change the service plugin's `systemctl`, `loginctl`, and `launchctl`, the completion plugin's PowerShell profile query, the skills, completion, and manpage refreshes, and the update notices' refresh to start through `host.spawn`, so a run on a mock process starts no real program. The service managers now run in `host.cwd`.

### Migration

**Affected surface.** Code that calls `applicationDirectory` with an object it builds itself, `{ env, platform }`, rather than the run's host.

**Why.** The home is a host fact, `host.home`, which follows the process handle's absolute `HOME` and falls back to the user database, so every Loom lookup reads it in one place, under [ADR-0107](docs/decisions/0107-a-run-reads-the-process-through-one-process-handle.md).

**Before and after.**

Before:

```ts
const cache = applicationDirectory('cache', 'notes', { env: host.env, platform: host.platform });
```

After:

```ts
const cache = applicationDirectory('cache', 'notes', host);
// or, from an object of your own:
const logs = applicationDirectory('logs', 'notes', { env, home: '/home/me', platform: 'linux' });
```

**Steps.**

1. Where a call passes the run's host, leave it as it is.
2. Where a call builds its own `from`, pass the run's host instead, or add `home`, the run's `host.home`.
3. In a test that wanted a lookup with no home, supply `home: ''` to the process handle or the object, because an unset or relative `HOME` now falls back to the user database's home.

**Validation.** Run the TypeScript compiler over the application and its tests: every `applicationDirectory` call compiles. Run the application's tests, which pass with the same results.
