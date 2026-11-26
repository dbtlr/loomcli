# Test map for extended version output

The reference is `packages/plugins/tests/version-extended.test.ts` at `v0.20.0`. The Rust cases are in [controls_version_extended.rs](../controls_version_extended.rs). Tests that install the formatter are in its `formatted` module. The Rust `runtime` fixture is a Cargo target triple.

| Reference case | Rust test |
| --- | --- |
| A distributed release prints the line and six rows for both spellings | `a_distributed_release_prints_six_facts_under_both_version_spellings` |
| A source run on a terminal ends an absent fact at its label | `a_source_run_on_a_terminal_ends_each_absent_fact_at_its_label` |
| A source run off a terminal keeps padding and the gap for absent facts | `a_source_run_off_a_terminal_keeps_padding_on_each_absent_fact` |
| A release without an asset and a handle without a runtime leave facts absent | `a_release_without_an_asset_and_a_handle_without_a_runtime_print_blank_values` |
| A routed Command prints the same bytes as the root | `a_routed_command_prints_the_same_bytes_as_the_root` |
| The postfix stays on the first line | `the_postfix_stays_on_the_first_line` |
| With extended output disabled, the line is unchanged across formats | `without_extended_only_the_line_prints_even_in_json_format` |
| JSON prints one indented object with eight ordered keys | `json_is_one_indented_object_with_eight_keys_in_order` |
| JSON Lines prints one line with null for each absent fact | `jsonl_is_one_line_with_null_for_each_absent_fact` |
| The JSON version is the declared string and omits the postfix | `the_json_version_is_the_declared_string_without_a_postfix` |
| The formatter must run ahead of the version plugin | `a_formatter_after_version_cannot_select_the_media_type_for_it` |
| A Command with an action and no result prints the text block under JSON format | `an_action_with_no_result_prints_the_block_under_format_json` |
| A group root prints the object in JSON and JSON Lines | `a_group_root_prints_json_and_jsonl_in_either_option_order` |
| A nested group prints the same object as the root | `a_nested_group_prints_the_same_json_as_the_root` |
| A Command with a result in a group application prints the same object | `a_group_applications_command_with_a_result_prints_the_same_json` |
| An unknown format prints the block under version and fails without it | `an_unknown_format_prints_the_block_under_version_and_fails_without_it` |
| Without the formatter, a group root holds the unknown-option fault during takeover | `without_the_formatter_the_takeover_holds_the_unknown_option_at_a_group` |
| An author's JSON result view selects the object without the formatter | `an_authors_own_json_view_selects_a_document_without_the_formatter` |
| A version-line override changes the first line above the facts | `an_override_of_version_line_renders_the_first_line_above_the_facts` |
| The block styles values primary and labels dim | `the_block_styles_padded_labels_dim_and_values_primary` |
| A version-facts override restyles the text block and leaves the JSON object intact | `an_override_of_version_facts_restyles_only_the_text_block` |
