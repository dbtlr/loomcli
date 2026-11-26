# Test map for external commands

The reference tests live in `typescript/packages/plugins/tests/external-commands.test.ts`.
The Rust fixtures run with
`cargo test -p loomcli-plugins --features external-commands,help,suggestions --test external_commands`.

| Reference file | Status | Notes |
| --- | --- | --- |
| `external-commands.test.ts` | Ported in `tests/external_commands.rs` | All 15 declarations, including the two real Unix child cases. Checks unchanged unknown-command reports with help and suggestions, declared and hidden Commands, argument and host inheritance, the first-word rule, portable spelling, PATH order and executable eligibility, Windows key and extension order and exit code, start failures, the named-invocation exclusion, and both log events. Added lexical PATH joining, aliased Command precedence, an environment hook supplying PATH, and the general start-failure and code-free sentences. |

Rust also tests a real executable script without a shebang on Linux, a mock of the shell retry, and the original error when the shell fails to start. Unit tests check the Win32 error names on every platform.
