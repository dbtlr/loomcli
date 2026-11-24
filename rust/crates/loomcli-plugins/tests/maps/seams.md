# Test map: the plugins installed together

The Rust test is `tests/seams.rs`, run with `cargo test -p loomcli-plugins --all-features --test seams`. It installs help (with its Command), suggestions, version, format, manifest, the Loom theme, color, verbose, interaction, completion, mcp, and manpage in one application. The expected pages are written by hand from the repository's `docs/plugins/help-page.md`.

| Reference file | Status | Notes |
| --- | --- | --- |
| (no reference file) the plugin set together | added, 4 cases | `seams.rs`: the graph assembles with no collision fault and lists plugin Commands ahead of the application's own in installation order; the root page from `--help` and from `help` (COMMANDS, GLOBAL OPTIONS in `graph.globals` order with `-v, --verbose...`, `-q, --quiet`, and `--no-input` with `default: true`, the hint); a leaf page with the formatter's `--format` row and the globals; the Command's text, `json`, and `jsonl` output and `--version` with every plugin installed. The reference proves the set only through the jsonkit conformance captures, which `examples/jsonkit/tests/conformance.rs` replays. |
