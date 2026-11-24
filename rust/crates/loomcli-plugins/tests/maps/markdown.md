# Test map: the Markdown subset parser

Reference tests live in `typescript/packages/plugins/tests`. The parser is a private module of `loomcli-plugins` behind the internal `markdown` feature and exports nothing. Its tests are unit tests in `src/markdown/tests.rs` (run with `cargo test -p loomcli-plugins --no-default-features --features markdown`); the plain renderer in `src/markdown/test_support.rs`, compiled only for tests, follows help's off-terminal layout.

| Reference file | Status | Notes |
| --- | --- | --- |
| `markdown-cases.ts` | ported, 37 cases | 22 block cases and 15 inline cases, asserted as the reference's expected page lines (`block_cases`, `inline_cases`). |
| `markdown-parser.test.ts` | partly ported, parser tests ported; renderer tests left to help | Ported: inline constructs never span lines; separators on nested and top-level blocks; container edges (3 sources); depth-three item with 200 lazy lines; image in link text; unmatched backtick run; astral underscore boundaries; autolink inside link text; code inside a list; empty headings; inline model of images and code spans; empty Markdown (parser half). Not applicable here, owned by the help package: compact-help pointer, `helpCommand` and `manifestCommand` source and whitespace faults, all themed-byte tests (theme, modifiers, marker characters, address-only links, primary-run value), which test the renderer and styles. |
| `markdown-details.test.ts` | partly ported, 1 case | Ported: the first test's fixture (heading followed by a list, inline constructs in items, info-string fence after a blank line) as exact page lines. The `blockCases` and `inlineCases` re-runs are ported above. Left to help: the fixture process, manifest check, and terminal wrapping. |
| `manpage-markdown.test.ts` | partly ported, 5 parser cases | Ported as exact block trees: rows between paragraph lines with an item holding a row; an indented line after rows following a paragraph; the same after rows that open the details; the same past an item column after item rows; a heading inside an item. Left to the manpage package: the roff output of every case and the remaining renderer cases. |

Added cases beyond the reference: list identity and start numbers (`list_identity_and_numbering_are_recorded`) and table rows not opening indented code (`table_rows_stay_one_block_and_do_not_open_indented_code`).
