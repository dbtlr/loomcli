# Conformance corpus

The corpus holds invocations of the two TypeScript reference examples, jsonkit and textstat, with the stdout, stderr, and exit code the reference produced. The Rust ports of the examples must reproduce every case byte for byte, or list the difference in `docs/deviations.md`. [ADR-0002](../docs/decisions/0002-the-typescript-reference-is-the-behavioral-contract.md) states the rule.

```text
conformance/
  cases/*.json      the inputs, one file per group
  fixtures/         copied into each case's sandbox home; the working directory is inside the copy
  expected/         the captured results, one folder per case, plus META.json
  capture.mjs       regenerates expected/ from the reference checkout
```

`expected/META.json` records the reference git revision (`reference_revision`), whether that checkout had uncommitted changes, how its build was obtained, the Node version, the platform, and the case count.

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

`{sandbox}` in an `argv` element or an `env` value stands for the case's writable work directory, an empty folder the harness creates fresh for each case. Wherever the work directory's absolute path appears in captured stdout, stderr, or a produced file, it is replaced by the literal text `{sandbox}`. This is the only normalization the corpus applies. A Rust harness creates its own empty folder, substitutes it for `{sandbox}` in `argv` and `env` before running, and replaces its path with `{sandbox}` in the streams and files before comparing. When the folder's path can resolve through a symlink (macOS `/var` to `/private/var`), the harness replaces both the path as written and its canonical form. Only regular files under the work directory are compared; empty directories are ignored.

### Sessions

An MCP server stops reading and drops calls in flight when stdin ends, so a scripted MCP session must wait for each answer. A `session` array holds one stdin line per element. A string element is sent as a raw line; any other element is sent as `JSON.stringify` text. The harness sends elements one at a time, in order. Call an element *answered* when it is a raw non-blank string, or an object that has an `"id"` and neither `"result"` nor `"error"`. The harness keeps N, the number of answered elements sent so far. After it sends each answered element it waits until the process's stdout holds at least N line feeds, counted from process start. It never matches on response ids: a request that makes the server write several lines (`jsonkit-mcp-subscriptions-listen`) would otherwise stall a harness that waits for one specific response, and the extra lines of that case arrive after stdin closes. Other elements (notifications, client responses, blank lines) are sent without waiting. After the last element the harness closes stdin and waits for exit. The exact bytes sent are saved as `expected/<id>/stdin`, so a harness can feed that file's lines directly instead of re-serializing JSON.

## The environment every case runs in

- Program: `node examples/<app>/dist/main.js <argv...>` of the reference build. The Rust harness runs the Rust example binary with the same `argv`.
- Sandbox layout: each case gets a fresh folder `S` holding `S/home` (`HOME`), `S/work` (the `{sandbox}` folder), and `S/tmp` (`TMPDIR`). The harness copies `conformance/fixtures/` to `S/home/fixtures`.
- Working directory: `S/home/fixtures/` joined with the case's `cwd`. It is inside `HOME` on purpose: textstat searches for `.textstat.json` and `.textstat.toml` from the working directory upward, and when the start folder is inside `HOME` the search stops at the folder just below `HOME`, so it never reads a file from an ancestor of the checkout. A harness that runs in the real `conformance/fixtures/` instead lets any stray configuration file above the checkout change nearly every textstat case. Cases only read from the copy; `capture.mjs` fails if a case changes it.
- Environment: only `PATH`, the variables below, and the case's `env`. `HOME` is `S/home`; `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_STATE_HOME` are folders under it; `TMPDIR` is `S/tmp`. All are fresh and never the real home. A Rust harness must set the same variables to its own empty folders and remove every other variable, `TERM`, `COLUMNS`, `CI`, `NO_COLOR`, and `FORCE_COLOR` included.
- Streams: pipes for stdin, stdout, and stderr. Nothing is a terminal.
- Each case times out after 30 seconds.

## Expected layout

`expected/<id>/` holds plain files. Every file is UTF-8 text, read with `std::fs::read_to_string`.

| File            | Content |
| --------------- | ------- |
| `stdout`        | The exact stdout bytes. Empty file when nothing was written. |
| `stderr`        | The exact stderr bytes. |
| `exit`          | The exit code in decimal, then a line feed. |
| `stdin`         | Only when the case has `stdin` or `session`: the exact bytes fed to stdin. |
| `files/<path>`  | Only when the case wrote files into `{sandbox}`: each file, at its path relative to the work directory, with the sandbox rule applied. The harness compares the set of produced paths and their contents. |

Styled output keeps its escape bytes (`\u001b[...m`) in the files. Compare whole files, not trimmed lines.

## Re-capturing

```sh
LOOM_TS_REF=../typescript node conformance/capture.mjs
```

The script needs Node and `git`; it has no other dependencies. Run it from `rust/`. It reads the reference, the TypeScript workspace, from `LOOM_TS_REF`, runs every case, and replaces `expected/` with a fresh tree only after every check passed (a failed run leaves the committed `expected/` untouched). A case's folder is cleared before `--only` rewrites it. `--only <id-prefix>` re-runs the matching cases and leaves everything else alone, which is for authoring cases and does not rewrite `META.json`. It never writes inside the reference checkout.

The reference examples run from their `dist/` folder. When any source file under the reference's `packages/*/src` or `examples/*/src` is newer than `examples/*/dist/main.js`, the dist is stale, and the script builds a private copy under `.scratch/ref-build` (`pnpm build`, then `pnpm run build:examples`, which need pnpm and Bun) and runs the cases against that. `--rebuild` forces this. `META.json` says which path was used.

Two runs against the same reference build produce byte-identical `expected/`. The script fails, naming the case, when a case's output contains the repository path, the reference path (as written and resolved), the Node binary path, or the home folder, or a case has both `stdin` and `session`, or is not valid UTF-8, or when the process ends by signal.

## Cases

The corpus has 687 cases.

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

textstat has no `-v` or `-q`, no `--color` flag, no `help` command, no `completion`, `mcp`, or `manpage`; the corpus records those absences as usage failures.

## Behavior the corpus does not cover

Capture runs on pipes, so these cannot be exercised:

- Terminal-only behavior: wrapping at a live terminal width (pipes print unwrapped), paging, live regions and progress rendering, spinners, and every question or prompt. The "missing required input" failure that appears when `--file` is absent at a terminal never occurs, because an empty stdin pipe counts as an available source (the case `jsonkit-usage-missing-document-empty-stdin` records what happens instead).
- Signals, cancellation exit codes (129, 130, 131, 143), and the closed-reader exit 141.
- Machine-specific output, excluded rather than normalized: `mcp config` and `mcp install` (they embed the absolute path of the program), `manpage install`, `manpage update`, and `completion install` (they write into the home folder and print its path), and the textstat hidden `--timing` line (it prints elapsed milliseconds). The `logging` and `configuration` plugins' on-disk state under the sandbox home is not captured.
- Output that depends on the platform: `jsonkit doctor` prints `Platform: linux`, so its expected files are the Linux capture (see `platform` in `META.json`).
- MCP behavior that needs overlapping requests: cancellation (`notifications/cancelled`), progress notifications from a long call, and the in-flight duplicate-id error. A scripted session answers one request before sending the next.
- Terminal-only textstat input: stdin is always a pipe, and an inherited empty pipe counts as a source, so almost every textstat case that names files ends with a `0  stdin` row. The files-only table in the textstat README, and textstat's "Expected at least 1 readable source" failure, need a terminal stdin and appear in no case.
- Self-update, services, and background plugins, which neither example installs.

## Running the harness

`conformance/harness` is the Rust package `conformance-harness`. It runs every case against the Rust example binaries, reproducing the rules of `capture.mjs` (scrubbed environment, sandbox, fixtures copy, `{sandbox}` substitution, stdin text, scripted sessions, 30-second timeout, produced files), and compares stdout, stderr, the exit code, and files byte for byte. It builds nothing itself.

```sh
cargo build -p jsonkit -p textstat
cargo run -p conformance-harness -- [--only <id prefix or group>] [--show <id>] [--bin-dir <dir>] [--json <file>] [--jobs <n>]
```

- `--bin-dir` names the folder that holds the `jsonkit` and `textstat` binaries. Default: `$CARGO_TARGET_DIR/debug` when that variable is set, else `target/debug`. A missing binary stops the run with the `cargo build` command to run.
- `--only` runs the cases whose id starts with the prefix, or whose group file has that name.
- `--show <id>` runs one case and prints a unified diff of expected against actual for each differing part, with control characters shown as escapes (`\x1b`, `\t`, `\r`).
- `--json <file>` writes the summary: totals, and per group the counts with the failing ids and their differing parts.
- The output is one line per failing case (`FAIL <id>: <parts>`), then a table of passed, failed, accepted, and stale cases per group file. The exit code is 0 when every case passed or is accepted, 1 when a case failed or is stale, and 2 when the harness itself could not run.

`accepted.json` lists differences that are recorded on purpose:

```json
{ "accepted": [ { "id": "<case id>", "parts": ["stdout"], "row": "<text from the docs/deviations.md row>", "reason": "<why>" } ] }
```

`parts` is any of `stdout`, `stderr`, `exit`, `files`. `row` must occur in `docs/deviations.md`. An accepted case still runs; it counts as accepted while it differs only in the listed parts, and as stale when it matches, which fails the run.

The test `cargo test -p conformance-harness -- --ignored` runs the whole corpus and fails on any failing or stale case. It is ignored by default because it needs the built binaries.
