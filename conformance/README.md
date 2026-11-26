# Shared conformance cases

The TypeScript and Rust runners share invocations of jsonkit and textstat and compare their output with the files captured from the TypeScript build. [ADR-0217](../docs/decisions/0217-parity-between-looms-implementations-is-the-operators-experience.md) defines parity between the implementations.

```text
conformance/
  cases/*.json      the inputs, one file per group
  fixtures/         copied into each case's sandbox home
  expected/         the captured results, one folder per case, plus META.json
```

`expected/META.json` records the Git revision of the TypeScript reference, whether the workspace had uncommitted changes, how its build was obtained, the Node version, the platform, and the case count.

## Case files

`cases/<group>.json` is `{ "description": string, "cases": [Case, ...] }`. A case is:

| Field      | Type                 | Meaning |
| ---------- | -------------------- | ------- |
| `id`       | string               | Unique, matching `[a-z0-9][a-z0-9-]*`. Starts with the application name. Names the folder under `expected/`. |
| `app`      | `"jsonkit"` or `"textstat"` | The application to run. |
| `argv`     | string array         | The arguments after the program name. |
| `stdin`    | string, optional     | Text written to stdin in one piece, then stdin is closed. Absent means stdin is an empty pipe. |
| `session`  | array, optional      | An interactive stdin script, see below. Never combined with `stdin`. |
| `env`      | object, optional     | Environment variables to set, string to string. |
| `cwd`      | string, optional     | A folder under `fixtures/`, relative to it, used as the working directory. Default: the fixtures root. Used to exercise configuration file discovery. |
| `fixtures` | string array, optional | Files under `fixtures/` the case reads. Documentation for the reader; the harness needs no use for it. |
| `note`     | string, optional     | Why the case exists, or a caveat. |

### Sandbox token

`{sandbox}` in an `argv` element or an `env` value stands for the case's writable work directory, an empty folder the harness creates fresh for each case. Wherever the work directory's absolute path appears in captured stdout, stderr, or a produced file, it is replaced by the literal text `{sandbox}`. This is the only normalization either runner applies. Each runner creates its own empty folder, substitutes it for `{sandbox}` in `argv` and `env` before running, and replaces its path with `{sandbox}` in the streams and files before comparing. When the folder's path can resolve through a symlink (macOS `/var` to `/private/var`), the runner replaces both the path as written and its canonical form. Only regular files under the work directory are compared; empty directories are ignored.

### Sessions

An MCP server stops reading and drops calls in flight when stdin ends, so a scripted MCP session must wait for each answer. A `session` array holds one stdin line per element. A string element is sent as a raw line; any other element is sent as `JSON.stringify` text. The harness sends elements one at a time, in order. Call an element *answered* when it is a raw non-blank string, or an object that has an `"id"` and neither `"result"` nor `"error"`. The harness keeps N, the number of answered elements sent so far. After it sends each answered element it waits until the process's stdout holds at least N line feeds, counted from process start. It never matches on response ids: a request that makes the server write several lines (`jsonkit-mcp-subscriptions-listen`) would otherwise stall a harness that waits for one specific response, and the extra lines of that case arrive after stdin closes. Other elements (notifications, client responses, blank lines) are sent without waiting. After the last element the harness closes stdin and waits for exit. The exact bytes sent are saved as `expected/<id>/stdin`, so a harness can feed that file's lines directly instead of re-serializing JSON.

## The environment every case runs in

- Program: `node typescript/examples/<app>/dist/main.js <argv...>`. The Rust harness runs the Rust example binary with the same `argv`.
- Sandbox layout: each case gets a fresh folder `S` holding `S/home` (`HOME`), `S/work` (the `{sandbox}` folder), and `S/tmp` (`TMPDIR`). The harness copies `conformance/fixtures/` to `S/home/fixtures`.
- Working directory: `S/home/fixtures/` joined with the case's `cwd`. It is inside `HOME` on purpose: textstat searches for `.textstat.json` and `.textstat.toml` from the working directory upward, and when the start folder is inside `HOME` the search stops at the folder just below `HOME`, so it never reads a file from an ancestor of the checkout. A harness that runs in the real `conformance/fixtures/` instead lets any stray configuration file above the checkout change nearly every textstat case. Cases read from the copy. Both runners fail if a case changes it.
- Environment: only `PATH`, the variables below, and the case's `env`. `HOME` is `S/home`; `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME` are folders under it; `TMPDIR` is `S/tmp`. All are fresh and never the real home. A Rust harness must set the same variables to its own empty folders and remove every other variable, `TERM`, `COLUMNS`, `CI`, `NO_COLOR`, and `FORCE_COLOR` included.
- Streams: pipes for stdin, stdout, and stderr. Nothing is a terminal.
- Each case times out after 30 seconds.

## Expected layout

`expected/<id>/` holds plain files. Each file contains UTF-8 text. The runners compare the exact bytes.

| File            | Content |
| --------------- | ------- |
| `stdout`        | The exact stdout bytes. Empty file when nothing was written. |
| `stderr`        | The exact stderr bytes. |
| `exit`          | The exit code in decimal, then a line feed. |
| `stdin`         | Only when the case has `stdin` or `session`: the exact bytes fed to stdin. |
| `files/<path>`  | Only when the case wrote files into `{sandbox}`: each file, at its path relative to the work directory, with the sandbox rule applied. The harness compares the set of produced paths and their contents. |

Styled output keeps its escape bytes (`\u001b[...m`) in the files. [.gitattributes](.gitattributes) turns off Git's line-ending conversion under `expected/` and `fixtures/`, so a carriage return a case reads or writes is stored as captured. Compare whole files, not trimmed lines.

## Check the TypeScript examples

Run these commands from `typescript/` on Linux to build the examples and check their output.

```sh
pnpm run build
pnpm run build:examples
pnpm run check:conformance
```

The check lists the id and differing parts of each case that disagrees with the committed expectations. Pass `--only <id-prefix>` to check a selection while authoring cases. Both runners also fail on an entry under `expected/` that no case owns, in a full run, and on an entry in a checked case's folder other than `exit`, `stdout`, `stderr`, `files/`, and, for a case with `stdin` or `session`, `stdin`. An update replaces the folders it writes, so a refresh of a renamed case leaves the old folder for the next full check to report.

To refresh the expectations for all cases, run `pnpm run check:conformance --update` after building. The script stages a fresh tree and replaces `expected/` only after every case passes the capture checks. To refresh only a selection, run `pnpm run check:conformance --update --only <id-prefix>`. The selected case folders are replaced and `META.json` keeps the revision of the last full capture. A failed capture leaves the existing expected files untouched. A refresh that changes expected output also lists, in Rust's [behind.json](../rust/conformance/behind.json), each case Rust no longer matches, as [Running the harness](#running-the-harness) describes.

The script uses the workspace's built examples and never rebuilds them. Repeat captures of the same build and metadata produce byte-identical files. The check and the update fail with the case id when output embeds the repository path, TypeScript workspace path, Node binary path, or invoking user's home path. They also reject invalid UTF-8, signals, and cases that specify both `stdin` and `session`.

## Cases

The shared set has 687 cases.

| Group file               | Cases | Covers |
| ------------------------ | ----: | ------ |
| `jsonkit-help`           |    73 | Root, every command (nested, hidden, deprecated, plugin), `-h` and `--help`, the `help` command, held faults, color |
| `jsonkit-meta`           |    23 | `--version`, `--explain`, `doctor` |
| `jsonkit-usage`          |    90 | Every usage failure class, validation issues, option value forms, `--`, plain words such as `-5` |
| `jsonkit-actions`        |    89 | Each command's results over fixtures and stdin, exit 65 failures, the translator, `-v`, `-vv`, `-q` |
| `jsonkit-formats`        |    40 | `json`, `jsonl`, `ndjson`, `records`, `list`, `table`, failures under a format, incomplete sequences |
| `jsonkit-manifest`       |    25 | `--manifest` at the root and at commands |
| `jsonkit-completion`     |    63 | The four scripts, the hidden `completion __complete -- words...` protocol |
| `jsonkit-mcp`            |    77 | Scripted sessions on all three protocol revisions |
| `jsonkit-manpage`        |     8 | `manpage generate` into `{sandbox}` with the produced files |
| `jsonkit-color`          |    27 | `FORCE_COLOR`, `NO_COLOR`, `--color`, `--no-color` |
| `textstat-help`          |    21 | Help, version, explain, manifest |
| `textstat-usage`         |    56 | Usage failures and option forms |
| `textstat-actions`       |    95 | Counting, stdin placement, `TEXTSTAT_MIN_BYTES` and `TEXTSTAT_TOTAL`, configuration files, formats, color |

textstat has no `-v` or `-q`, no `--color` flag, no `help` command, no `completion`, `mcp`, or `manpage`; the cases record those absences as usage failures.

## Behavior outside the shared cases

Capture runs on pipes, so these cannot be exercised:

- Terminal-only behavior: wrapping at a live terminal width (pipes print unwrapped), paging, live regions and progress rendering, spinners, and every question or prompt. The "missing required input" failure that appears when `--file` is absent at a terminal never occurs, because an empty stdin pipe counts as an available source (the case `jsonkit-usage-missing-document-empty-stdin` records what happens instead).
- Signals, cancellation exit codes (129, 130, 131, 143), and the closed-reader exit 141.
- Machine-specific output, excluded rather than normalized: `mcp config` and `mcp install` (they embed the absolute path of the program), `manpage install`, `manpage update`, and `completion install` (they write into the home folder and print its path), and the textstat hidden `--timing` line (it prints elapsed milliseconds). The `logging` and `configuration` plugins' on-disk state under the sandbox home is not captured.
- Output that depends on the platform: `jsonkit doctor` prints `Platform: linux`, so its expected files are the Linux capture (see `platform` in `META.json`).
- MCP behavior that needs overlapping requests: cancellation (`notifications/cancelled`), progress notifications from a long call, and the in-flight duplicate-id error. A scripted session answers one request before sending the next.
- Terminal-only textstat input: stdin is always a pipe, and an inherited empty pipe counts as a source, so almost every textstat case that names files ends with a `0  stdin` row. The files-only table in the textstat README, and textstat's "Expected at least 1 readable source" failure, need a terminal stdin and appear in no case.
- Self-update, services, and background plugins, which neither example installs.

## Running the harness

Run these commands from `rust/` to build the example binaries and check their output.

```sh
cargo build -p jsonkit -p textstat
cargo run -p conformance-harness
```

The harness reads the shared inputs and compares stdout, stderr, the exit code, and produced files. Options go after `cargo run -p conformance-harness --`.

- `--bin-dir <dir>` names the folder that holds the binaries. The default is `$CARGO_TARGET_DIR/debug` when that variable is set, or `rust/target/debug` from the repository root.
- `--only <id-prefix-or-group>` runs the cases in the named group or with the given id prefix.
- `--show <id>` runs one case and prints a unified diff for each differing part, with control characters shown as escapes (`\x1b`, `\t`, `\r`).
- `--json <file>` writes the totals and per-group counts, including failing ids with their differing parts and stale ids.
- `--jobs <n>` sets the number of workers.
- `--write-behind <file>` writes a candidate behind list from a full run. The harness still reports the verdict using the committed lists.
- `--check-growth <base-behind.json> --changed <file>` runs no case. It compares the committed behind list with a base branch's copy and names each case the list adds or widens, with the added parts, whose files under `conformance/expected/<id>/` the change leaves unchanged. `--changed` names a file of the repository-relative paths the change touches, one per line. It exits 0 when every such case's expected output changed, 1 when one did not, and 2 if the check cannot run.

The table reports passed, failed, accepted, behind, and stale cases. The harness exits 0 when every case passes, is accepted, or is behind. It exits 1 if a case fails or is stale, and 2 if the harness cannot run.

[accepted.json](../rust/conformance/accepted.json) lists intentional Rust differences. Each entry gives the case id, the differing parts, a snippet from its row in [the deviation register](../rust/docs/deviations.md), and a reason.

[behind.json](../rust/conformance/behind.json) lists cases where Rust has yet to match the shared expectations. Each entry gives the case id and the exact set of differing parts. Rust work only shrinks the list. Remove the parts that now match, or remove the entry once every part matches. A TypeScript change that intentionally alters expected output adds the new differences in the same change. On a pull request, the `rust_linux` CI job runs `--check-growth` against the base branch, so a case can join the list or gain a part only in the change that alters its expected files. Run with `--write-behind` to generate a candidate list with the exact differing parts for each case outside `accepted.json`. It refuses to run while either list names a case that no longer exists, so a change that renames or removes a case edits that entry by hand first. Rust's plugin tests under `rust/crates/loomcli-plugins/tests` declare their own copies of the examples' Commands, so a Rust fix to an example's declaration updates those copies too, or `cargo test` fails on the cases it fixed.

Both lists use the part names `stdout`, `stderr`, `exit`, and `files`. In either list, any difference outside the listed parts fails the case. A case counts as accepted while it differs in one or more parts listed in `accepted.json`. An accepted case that matches in full is stale. A case counts as behind when its differing parts are exactly the parts listed in `behind.json`. If the remaining differences cover fewer parts than the entry lists, the entry is stale.

`cargo test -p conformance-harness -- --ignored` runs the same check after the example binaries have been built.
