- Change `applicationDirectory` on `win32` to resolve the `installation`, `logs`, and `cache` directories from `XDG_STATE_HOME`, `XDG_CACHE_HOME`, and `HOME`, as on Linux, in place of `%LOCALAPPDATA%\<app>\installation\`, `Logs\`, and `Cache\`, under [ADR-0100](docs/decisions/0100-acceptance-plans-live-beside-the-tests.md). When the XDG variable gives no absolute path and `HOME` is unset, the answer is `{ variable: 'HOME' }`.
- Change the configuration, logging, skills, completion, and manpage plugins to read the home folder from `HOME` on every platform. They no longer read `USERPROFILE` on `win32`.
- Allow `manpage install`, `manpage update`, and `manpage uninstall` on `win32`, where each resolves its folder from `HOME` as on other platforms, in place of refusing `install` and skipping `update` and `uninstall`.
- Change core on `win32` to choose main glyph forms unless `TERM` is `linux`, to run the background query under the same rules as elsewhere, and to resolve a content operand with the running process's `node:path`, with no Windows exception for a stdin alias.

### Migration

**Affected surface.** Applications run on Windows that read `applicationDirectory`, write logs to the logging plugin's default directory or to a `~/` file, read a configuration file from the home folder, or install skills or man pages, and Windows operators whose environment sets `USERPROFILE` and no `HOME`.

**Why.** No CI job runs Windows, so these branches ran only under a faked platform, and support that no CI entry runs is not shipped, under [ADR-0100](docs/decisions/0100-acceptance-plans-live-beside-the-tests.md).

**Before and after.**

Before, on Windows, the installation record lived at:

```text
%LOCALAPPDATA%\notes\installation\
```

After, it lives where Linux keeps it, under `XDG_STATE_HOME` when that is an absolute path:

```text
%XDG_STATE_HOME%\notes\installation\
%HOME%\.local\state\notes\installation\
```

Before, a Windows operator's home configuration file was `%USERPROFILE%\.notes.toml`. After, it is `%HOME%\.notes.toml`.

**Steps.**

1. Tell Windows operators to set `HOME` where it is not already set, for example with `setx HOME "%USERPROFILE%"`.
2. Tell Windows operators to move a home configuration file, a log file, or an installation record from its `%USERPROFILE%` or `%LOCALAPPDATA%` path to the path above, or to delete it.
3. Where the application's own code read `USERPROFILE` to agree with Loom's folders, read `HOME` instead.

**Validation.** On Windows, with `HOME` set, run the application with a home configuration file at `%HOME%\.<file>` and confirm that it reads the file. Call `applicationDirectory('installation', name, host)` and confirm that it answers a path under `XDG_STATE_HOME` or `%HOME%\.local\state`.
