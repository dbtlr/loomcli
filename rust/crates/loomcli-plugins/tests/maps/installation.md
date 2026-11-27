# Test map: the installation record writer

Reference tests live in `typescript/packages/plugins/tests`. The installed-files module is a private module of `loomcli-plugins` behind the internal `installation` feature, which the `completion`, `manpage`, `skills`, `mcp`, `self-update`, and `service` features turn on. The tests drive it through the `#[doc(hidden)]` `installation_test_support` export:

- `tests/installation.rs`: installs, uninstalls, recovery, folders, startup lines, and registrations. Its cases that need a process killed between two file-system calls, or another run acting between them, run the test binary again as a child (`child_process_entry`) whose probe (`set_probe`) acts at the named step, as the reference's `fixtures/installation-run.mjs` does by replacing `node:fs` functions.
- `tests/installation_umask.rs`: the cases that set the process's umask, in a process of their own.
- `tests/installation_refresh.rs`: the shared refresh on the mock process, and the application-folder refusals.
- `tests/installation_cancellation.rs`: a cancelled install, uninstall, and replacement on the mock process, which end the run silently with 130.

Sandboxes live under the system temporary folder, as the reference's `mkdtemp(tmpdir())`: a folder with a default ACL, such as one inside the checkout, overrides the umask the umask cases set.

| Reference file | Status | Notes |
| --- | --- | --- |
| `change-events.test.ts` | Ported, 1 of 1 | The test in `src/change_events.rs` checks the four event templates, structured fields, and plugin identity, with the exact log lines at `-v`. |
| `installation-events.test.ts` | Ported, 6 of 6 | `installation_events.rs` exercises completion, manpage, and skills Commands. The partial uninstall case requires a non-root user, as in the reference. |
| `refresh-lines.test.ts` | Ported, 6 groups across all 3 plugins | `refresh_lines.rs` checks skipped and executed refreshes, successful and failed children, unavailable record directories, and records created by real install Commands on mock processes. The unreadable directory case requires a non-root user. The original `out`-omission case has no separate form under ADR-0174. |
| `installed-files.test.ts` | ported, 130 reference rows plus 3 Rust rows | `installation.rs` and `installation_umask.rs` cover 133 rows, counted by section below. The format-2 expectations from `cb0f829a` cover committed and pending per-file digests, the format-1 pending read, mixed files and folders, recovery through a stopped swap, and unknown format 3. The staging probe removes a folder before the second exclusive create. Cancellation returns `InstallationError::Cancelled` and also has a run-level test in `installation_cancellation.rs`. A startup file in another encoding returns `InstallationError` with the reference's error text. Installation facts for derived package-manager layouts belong to core. The process fixture's private JavaScript build step has no Rust form. |
| `installation-reach.test.ts` | ported, shared reach behavior | `src/installation/reach.rs` covers blocked paths, permissions, read-only writes, and unrelated errors. Rust maps `EACCES` and `EPERM` to the same `ErrorKind::PermissionDenied`. `installation.rs` checks that a blocked record preserves its folders and directories. `skills_status.rs` covers the stale read below a regular file. The callback-return row has no Rust form because the error mapper runs only when an operation returns an error. |
| `installation-write-errors.test.ts` | skills rows ported | `skills_status.rs` covers the skill folder blocked by a file, a staging folder that cannot be written, a skills home that cannot be searched, and a blocked recorded folder across install, uninstall, and status. The Service, Completion, and Manpage run-level cases are outside the skills increment. |
| `completion-refresh.test.ts` | partly ported, 3 of 4 | The three refresh cases run `refresh_by_running` with completion's words and sentences. Not here: the self-update that rewrites a recorded script, which runs the self-update and completion plugins end to end and belongs to those packages. |
| `manpage-refresh.test.ts` | ported, 3 cases | Through `refresh_by_running` with the manpage plugin's words and sentences. |
| `skills-refresh.test.ts` | partly ported, 5 of 7 | Ported on the mock: the words, a child that exits 1, a binary that cannot start, the escaped path, and a cancelled run (exit 130, `code` 143). Not here: the two real-process cases (a path through a regular file that the runtime's spawn rejects, and a child whose own `SIGTERM` handler chooses its exit code), which run the skills fixture under the real process handle; they reach the same unstarted and exited arms the mock cases prove, and the skills package owns its fixture. |
| `host-facts.test.ts` | partly ported, 1 of 4 | The refresh case: the child's output reaches the host's stdout, it reads no input, and it runs in the run's working directory. The mock does not expose the stream kind the spawn received, so the output reaching the run's stdout stands in for "a `Writable`, never `inherit`". The service, PowerShell, skills, and logging cases belong to those packages. |
| `completion-install.test.ts` | not applicable | Every case drives the completion plugin's Commands and states its operator output; the module behaviors it relies on (record bytes, staging, recovery, startup lines, releases, update mode) are proven by the `installed-files.test.ts` port, and the completion package ports these cases. |
| `manpage-self-update.test.ts`, `skills-self-update.test.ts` | not applicable | Self-update end to end through each plugin's refresh; owned by the self-update package with the plugin. |

## Counts for `installed-files.test.ts`

Count the rows in `v0.20.0:packages/plugins/tests/installed-files.test.ts` starting at
`// Installing`. Each `test.each` entry counts once. The installation facts before
that section belong to core.

| Reference section | v0.20.0 rows | Rows removed |
| --- | ---: | ---: |
| Installing | 20 | 0 |
| Uninstalling | 8 | 0 |
| Recovery | 4 | 0 |
| Recovery from a process that stopped and reading | 9 | 0 |
| Installed folders | 26 | 10 |
| Startup lines | 53 | 0 |
| Registrations | 10 | 0 |
| **Total** | **130** | **10** |

Installed folders includes 4 installs, 9 cases for occupants of the folder path, 2
uninstalls, 3 recovery cases, 3 reads, and 5 writes without a record. Startup lines
includes 23 installs, 12 replacements and removals, 6 reads, and 12 stopped-process
cases.

The installed-folders subsection **The exact-contents check** lost 10 rows.

- One row checked matching contents and named modes, with no mode check for a file that names none.
- Eight rows checked an extra file, an extra file in a subfolder, an extra empty subfolder, a wrong
  mode, wrong content, a missing file, a link in place of a file, and a link to a directory inside.
- One row checked a link at the folder path, a regular file at that path, or an absent path.

The three Rust rows added to the 130 reference rows are in `installation.rs`:

- `format_two_without_folders_is_readable_and_record_writes_format_one_for_files_alone`.
- `a_folder_record_cannot_name_a_file_outside_the_folder`.
- `read_checks_reachability_for_directories_and_folders_before_mutation`.

Of the 105 tests registered in `installation.rs`, the child process entry point and
the worked example sit outside the 133 rows. Expanding the ported `test.each` tables
adds 25 rows to the other 103 tests (5 for Installed folders, 16 for Startup lines,
and 4 for Registrations). The single test in `installation_umask.rs` covers five
more reference rows, two in Installing and three in Startup lines.

Added cases beyond the reference: the module rustdoc's worked example (`the_worked_example_from_the_module_rustdoc`), four application-folder cases (`installation_refresh.rs`): an absolute `XDG_STATE_HOME` needs no home, a record directory that needs a home that is not absolute refuses naming `HOME`, the home refusal, and the absolute-path reads; and three cancellation cases (`installation_cancellation.rs`): an action that cancels its run before an install, an uninstall, or a replacement given the signal ends with exit 130, empty stdout and stderr, and nothing written or removed, as `docs/core/signals.md` states for a thrown reason.
