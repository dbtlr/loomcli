# Test map: the pack views

The views are `table`, `records`, `list`, `heading`, `rule`, `prose`, and `box` (module `boxed`). Reference tests live in `typescript/packages/plugins/tests`. The Rust tests are `tests/pack_*.rs`, with the shared run in `tests/pack_support/mod.rs` (the reference's `fixtures/view-run.ts`, `fit-render.ts`, and `pack-render.ts`), and the levelling formula's unit tests in `src/layout/fit.rs`.

The reference's unit cases call a view through `viewContext` with the simple measures of `view-measures.ts` (one column per character, a tab as four spaces) and spy on `style`, `wrap`, and `expandTabs`. The Rust cases call the view's own function through `loomcli_testing::view_context` with core's own measures (a tab to the next stop of eight), and assert what a spy checked through the output instead: the frames a render holds (`"dim"`, `"primary"`), the width a value wrapped at, and the absence of a tab. Several cases that checked a property now also pin exact lines.

| Reference file | Status | Notes |
| --- | --- | --- |
| `table.test.ts` | ported, 12 cases | `pack_table.rs`: explicit columns, discovered keys in first-seen order, a declared whole view through `out.results`, one key twice, null and missing cells, wide and styled cells, authored and escaped cells, an escaped discovered key, 150,000 rows, a centered last column, an empty sequence with and without columns. |
| `table-fit.test.ts` | ported, 33 cases | `pack_table.rs`, with the three `levelWidths` cases in `src/layout/fit.rs`. The levelling renders, floors (a long word, trailing and leading spaces, `nowrap` and `pad` frames), aligned wrapped cells, line ends, headers, empty sequences, the records fallback (blocks, alignment, a colored `format` cell), wrapped styles, hyperlinks and raw SGR, a resize, `COLUMNS` (a terminal that reports no width is `MockTerminal::new(0, _)`), piped and invoked-by-name bytes, and every tab case. Added: a tab in a `nowrap` cell, which the reference's plan names, and a styled cell's exact wrapped lines. |
| `records.test.ts` | ported, 9 cases | `pack_records.rs`: rows and the counted tail, a declared row view, declared field order and width, per-row width, null and missing values, authored and escaped values, an escaped key, an omitted identifier, `0 records`. |
| `records-fit.test.ts` | ported, 18 cases | `pack_records.rs`: wrapping after the key column, a trailing space, hyperlink and SGR continuations, authored breaks, blank lines in styled, `format`, and right-aligned fallback values, no room left, a streamed row after a resize, piped and invoked-by-name bytes, `COLUMNS`, the fallback matching the records blocks, every tab case, and empty values on a terminal and a pipe. |
| `list.test.ts` | ported, 14 cases | `pack_list.rs`: nesting, a declared rows result, ordered markers 1 to 10, two levels of children, null items, escaping and `format`, the sibling index, wrapping and hanging, a nested item's room, piped breaks, blank lines, tabs, dim and primary bytes under color, an empty sequence. |
| `heading.test.ts` | ported, 9 cases | `pack_heading.rs`. |
| `rule.test.ts` | ported, 12 cases | `pack_rule.rs`. |
| `prose.test.ts` | ported, 10 cases | `pack_prose.rs`. |
| `step.test.ts` | ported, 9 tests | `pack_step.rs`: semantic and neutral rendering, both destinations, the pointer gutter, wrapping, authored blank lines, nested styles, compatibility glyphs, and empty text. |
| `box.test.ts` | partly ported, 17 of 18 cases | `pack_box.rs`. Not applicable: "a text box over a value that is not a string fails the run the ordinary way": `BoxConfig::new()` and `BoxConfig::text()` frame only a `str` or an `AsRef<str>` type, so the run cannot reach the reference's `Style helpers require a string.` failure (a recorded deviation). |
| `pack-fit.test.ts` | ported, 7 cases | `pack_fit.rs`. |
| `pty-pack-views.test.ts` | ported, 1 case | `pack_box.rs`: the rule and the box at 100 and then 60 columns, exact bytes, with the mock terminal's `resize` in place of `stty` on a pseudo-terminal. |
| `pty-table.test.ts` | ported, 1 case as 2 | The table half in `pack_table.rs` and the streamed records half in `pack_records.rs`, exact bytes, on the mock terminal's `resize`. |
| `builders.test.ts` | partly ported, 3 of its 9 cases concern the pack | `pack_rule.rs`: the bare line and the labelled line at a stated width; the `dim` call is asserted as the dim frame around the bare line in `a_bare_rule_spans_the_columns_and_styles_its_line_dim`. The other six cases test the format plugin and help's hint, which their packages own. |
| `pack-diagnostics.test.ts` | not applicable | Pins the rules of version, service, skills, self-update, dotenv, and config; the pack views declare no rule. |
| `built-ins.test.ts` | not applicable | Tests the lazy loader of Node's `node:crypto`; Rust links everything ahead of time. |
| `view-measures.test.ts` | not applicable | Tests the TypeScript test helper's simple measures, which the Rust tests replace with core's own. |
| `views.test.ts` | not applicable | Overrides of the help page and the version line, which those packages own. |

Every example block of `docs/plugins/pack-views.md` is a test in `pack_docs.rs` (11 cases), with exact bytes with color off and with color on under a theme that sets `primary` to cyan and `dim` to bright black, as the Loom theme with `primary: style.cyan` resolves on a 16-color terminal.

No reference file covers how a default cell, value, or item prints a Rust number, so `pack_data.rs` (6 cases) pins it with exact bytes through `out.render` on a pipe: a `u64` above 2^53, an `i64` below -2^53, 128-bit integers, `0.1 + 0.2`, `1e21`, `1e-7`, `-0.0`, `NaN` and the infinities, `f32` values, an array, and an object, in the table, the records, and the list, and the `Value` a records `format` callback receives for them (see the Numbers row under Pack views in `docs/deviations.md`).
