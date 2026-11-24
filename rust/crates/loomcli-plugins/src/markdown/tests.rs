//! The Markdown subset parser, ported from the reference's `markdown-parser.test.ts`,
//! `markdown-cases.ts`, `markdown-details.test.ts`, and `manpage-markdown.test.ts`. The block and
//! inline cases assert the reference's expected page lines through the plain renderer in
//! `test_support`.

use super::test_support::{
    Block, BlockKind, Inline, ListMarker, parse_inline, parse_markdown, plain_inline, render_plain,
};

fn lines(expected: &[&str]) -> Vec<String> {
    expected.iter().map(|line| (*line).to_owned()).collect()
}

fn block_case(name: &str, source: &str, expected: &[&str]) {
    assert_eq!(render_plain(source), lines(expected), "{name}");
}

fn inline_case(name: &str, source: &str, expected: &str) {
    assert_eq!(
        render_plain(source),
        vec![format!("  {expected}")],
        "{name}"
    );
}

#[test]
fn block_cases() {
    let cases: &[(&str, &str, &[&str])] = &[
        (
            "backtick fences ignore an info string and Markdown, and accept a longer close",
            "  ```ts\n  **literal**\n    indented\n  ````\nAfter.",
            &["    **literal**", "      indented", "  After."],
        ),
        (
            "tilde fences and an unclosed fence run to the container end",
            "~~~ language\n*literal*\n~~~\n```\n# literal",
            &["    *literal*", "    # literal"],
        ),
        (
            "a later backtick prevents a backtick fence",
            "```bad`info\nnext",
            &["  ```bad`info", "  next"],
        ),
        (
            "indented code starts after a blank, but indentation continues a paragraph",
            "before\n    continuation\n\n    **code**\n\n        deep\n\nafter",
            &[
                "  before",
                "  continuation",
                "",
                "    **code**",
                "",
                "        deep",
                "",
                "  after",
            ],
        ),
        (
            "headings strip closing runs but preserve C# and seven markers",
            "# one ###\n###### six\n# C#\n####### seven\n#",
            &["  one", "  ───", "  six", "  C#", "  ──", "  ####### seven"],
        ),
        (
            "quotes contain lists and code and end on an unmarked line",
            "> paragraph\n> - one\n>   ```\n>   **code**\n>   ```\n>\n> last\noutside",
            &[
                "  > paragraph",
                "  > ● one",
                "  >     **code**",
                "  >",
                "  > last",
                "  outside",
            ],
        ),
        (
            "thematic breaks win over lists and lose indentation",
            "intro\n  ---\n* * *\n___\nend",
            &["  intro", "  ---", "  * * *", "  ___", "  end"],
        ),
        (
            "bullet lists nest two levels, keep lazy lines and authored separators",
            "intro\n- parent\n  - child\n    - grandchild\n      continued\n\n- next\nlazy\n+ another",
            &[
                "  intro",
                "  ● parent",
                "    ● child",
                "      ● grandchild",
                "        continued",
                "",
                "  ● next",
                "    lazy",
                "  ● another",
            ],
        ),
        (
            "ordered lists count from the authored start and always print a period",
            "3. first\n9. second\n   continued\n\n007) seven\n1) eight\n   later",
            &[
                "  3. first",
                "  4. second",
                "     continued",
                "",
                "  7. seven",
                "  8. eight",
                "     later",
            ],
        ),
        (
            "ordered lists nest two levels and renumber each list independently",
            "3. parent\n   007) child\n        1. grandchild\n9. next",
            &[
                "  3. parent",
                "     7. child",
                "        1. grandchild",
                "  4. next",
            ],
        ),
        (
            "ordered markers right-align against the widest, so 9. sits under 10.",
            "9. nine\n9. ten\n   continued\n9. eleven",
            &["   9. nine", "  10. ten", "      continued", "  11. eleven"],
        ),
        (
            "an ordered list nests under a bullet at the bullet text column",
            "- parent\n  1. one\n  2. two",
            &["  ● parent", "    1. one", "    2. two"],
        ),
        (
            "a level 1 heading is underlined as wide as its text, and levels 2 to 6 are not",
            "# Level one\n## Level two\n###### Level six",
            &["  Level one", "  ─────────", "  Level two", "  Level six"],
        ),
        (
            "authored blank lines stay around underlined headings and between items",
            "Intro.\n\n# Title\n\n- one\n\n- two\n\nEnd.",
            &[
                "  Intro.",
                "",
                "  Title",
                "  ─────",
                "",
                "  ● one",
                "",
                "  ● two",
                "",
                "  End.",
            ],
        ),
        (
            "five marker spaces open code and empty marker lines take their next content",
            "-     code\n-\n  next\n  line",
            &["  ●   code", "  ● next", "    line"],
        ),
        (
            "lists can start directly under a paragraph",
            "Intro\n- first\n- second",
            &["  Intro", "  ● first", "  ● second"],
        ),
        (
            "every marker block interrupts a paragraph without extra blanks",
            "a\n```\ncode\n```\nb\n# h\nc\n> q\nd\n---\ne\n1. item",
            &[
                "  a",
                "    code",
                "  b",
                "  h",
                "  ─",
                "  c",
                "  > q",
                "  d",
                "  ---",
                "  e",
                "  1. item",
            ],
        ),
        (
            "unsupported tables, setext underlines, references, HTML and entities stay text",
            "a | b\n--- | ---\nTitle\n===\n[ref]: https://example.org\n<div>\n&amp;\n</div>",
            &[
                "  a | b",
                "  --- | ---",
                "  Title",
                "  ===",
                "  [ref]: https://example.org",
                "  <div>",
                "  &amp;",
                "  </div>",
            ],
        ),
        (
            "terminators and surrounding whitespace normalize without wrapping",
            " \r\n  first  \rsecond\u{0085}third\u{2028}fourth\u{b}five\u{c}six\u{2029}seven\n\n ",
            &[
                "  first", "  second", "  third", "  fourth", "  five", "  six", "  seven",
            ],
        ),
        (
            "tabs expand in leading indentation and after list and quote markers",
            "\tcode\n\n-\titem\n\tcontinued\n>\tquote",
            &["    code", "", "  ● item", "    continued", "  > quote"],
        ),
        (
            "blank lines collapse between blocks but stay inside code",
            "\n\nfirst\n\n\nsecond\n```\n\ncode  \n\n\nlast\n\n```\n\n",
            &["  first", "", "  second", "    code", "", "", "    last"],
        ),
        (
            "plain multiline Details keeps exact bytes",
            "first line\nsecond line\nthird line",
            &["  first line", "  second line", "  third line"],
        ),
    ];
    for (name, source, expected) in cases {
        block_case(name, source, expected);
    }
}

#[test]
fn inline_cases() {
    let cases: &[(&str, &str, &str)] = &[
        (
            "both emphasis characters and strong emphasis nest",
            "*one* _two_ **three** __four__ **bold _nested_**",
            "one two three four bold nested",
        ),
        (
            "crossing runs leave intervening opening markers literal",
            "*a _b* c_",
            "a _b c_",
        ),
        (
            "unmatched runs, runs of three and underscores in words are literal",
            "*open **open ___three___ snake_case_name",
            "*open **open ___three___ snake_case_name",
        ),
        ("strong closes inside a word", "**pre**fix", "prefix"),
        (
            "one and two backtick spans keep their contents and delimiters",
            "`*literal*` ``a`b`` `C:\\` `open",
            "`*literal*` ``a`b`` `C:\\` `open",
        ),
        (
            "escapes protect punctuation and leave letters alone",
            "\\*literal\\* \\`no code \\q",
            "*literal* `no code \\q",
        ),
        (
            "links and images print text and a destination",
            "[text](url) ![image](image.png)",
            "text (url) image (image.png)",
        ),
        (
            "emphasis outside links and inline syntax in text",
            "*[**text**](url)*",
            "text (url)",
        ),
        (
            "link text balances brackets and destinations balance parentheses",
            "[a [b]](https://example.org/a(b))",
            "a [b] (https://example.org/a(b))",
        ),
        (
            "code and escaped brackets do not close link text",
            "[a \\] `]`](url)",
            "a ] `]` (url)",
        ),
        (
            "a code span ending in an escaped backslash leaves the closing bracket balanced",
            r"[C:\\](url)",
            r"C:\ (url)",
        ),
        (
            "equal text prints the address once",
            "[https://example.org](https://example.org)",
            "https://example.org",
        ),
        (
            "whitespace destinations and unmatched brackets stay literal",
            "[text](bad url) [unclosed",
            "[text](bad url) [unclosed",
        ),
        (
            "autolinks recognize all prefixes and preserve other angle brackets",
            "<http://a> <https://b> <mailto:a@b> <host:port>",
            "http://a https://b mailto:a@b <host:port>",
        ),
        (
            "HTML and entities remain literal",
            "<b>x</b> &amp;",
            "<b>x</b> &amp;",
        ),
    ];
    for (name, source, expected) in cases {
        inline_case(name, source, expected);
    }
}

#[test]
fn inline_constructs_never_span_authored_lines() {
    block_case(
        "spans",
        "*first\nsecond*\n`first\nsecond`\n[text\n](url)",
        &[
            "  *first",
            "  second*",
            "  `first",
            "  second`",
            "  [text",
            "  ](url)",
        ],
    );
}

#[test]
fn empty_markdown_renders_no_lines() {
    for source in ["#", "```\n```", "~~~\n\n~~~"] {
        assert_eq!(render_plain(source), Vec::<String>::new(), "{source:?}");
    }
}

fn kinds(blocks: &[Block]) -> Vec<(bool, &'static str)> {
    blocks
        .iter()
        .map(|block| {
            let kind = match block.kind {
                BlockKind::Paragraph { .. } => "paragraph",
                BlockKind::Table { .. } => "table",
                BlockKind::Heading { .. } => "heading",
                BlockKind::Code { .. } => "code",
                BlockKind::Break { .. } => "break",
                BlockKind::Quote { .. } => "quote",
                BlockKind::List { .. } => "list",
            };
            (block.blank_before, kind)
        })
        .collect()
}

#[test]
fn the_parser_records_authored_separators_on_nested_and_top_level_blocks() {
    let blocks = parse_markdown("one\n\n# two\n- item\n\n  next");
    assert_eq!(
        kinds(&blocks),
        [(false, "paragraph"), (true, "heading"), (false, "list")]
    );
    let BlockKind::List { items, .. } = &blocks[2].kind else {
        panic!("a list");
    };
    assert_eq!(items.len(), 1);
    assert_eq!(
        kinds(&items[0].blocks),
        [(false, "paragraph"), (true, "paragraph")]
    );
}

#[test]
fn container_edges_follow_the_stated_block_rules() {
    block_case("closing run only", "# ###", &[]);
    block_case(
        "lazy line joins the deepest item",
        "- first\n  - nested\nlazy",
        &["  ● first", "    ● nested", "      lazy"],
    );
    block_case(
        "unclosed fence in item",
        "- ```\n  code\noutside",
        &["  ●   code", "  outside"],
    );
}

#[test]
fn a_depth_three_item_retains_all_lazy_paragraph_lines() {
    let source = format!(
        "- outer\n  - middle\n    - inner\n{}",
        "wrapped line\n".repeat(200)
    );
    let mut expected = lines(&["  ● outer", "    ● middle", "      ● inner"]);
    expected.extend(std::iter::repeat_n("        wrapped line".to_owned(), 200));
    assert_eq!(render_plain(&source), expected);
}

#[test]
fn an_image_in_link_text_contributes_its_destination_to_printable_text() {
    inline_case(
        "image in link",
        "[![image](img)](image)",
        "image (img) (image)",
    );
}

#[test]
fn an_unmatched_backtick_run_never_opens_a_span_from_its_middle() {
    inline_case("run", "``open`end", "``open`end");
    assert_eq!(
        parse_inline("``open`end"),
        [Inline::Text("``open`end".to_owned())]
    );
}

#[test]
fn underscore_boundaries_recognize_astral_unicode_letters_on_either_side() {
    inline_case("astral", "𐐀_name_ _name_𐐀", "𐐀_name_ _name_𐐀");
}

#[test]
fn an_autolink_protects_its_address_brackets_inside_link_text() {
    inline_case(
        "autolink in text",
        "[<https://a]>](url)",
        "https://a] (url)",
    );
}

#[test]
fn code_inside_a_list_keeps_every_interior_empty_line() {
    block_case(
        "code in item",
        "- ```\n  code\n\n\n  last\n  ```",
        &["  ●   code", "", "", "      last"],
    );
}

#[test]
fn empty_headings_create_no_block_and_retain_an_authored_separator() {
    assert_eq!(parse_markdown("#\n# ###"), Vec::<Block>::new());
    assert_eq!(
        kinds(&parse_markdown("one\n\n#\ntwo")),
        [(false, "paragraph"), (true, "paragraph")]
    );
}

#[test]
fn the_inline_model_keeps_images_distinct_and_code_content_separate_from_its_delimiters() {
    assert_eq!(
        parse_inline("![x](y) ``a`b`` `C:\\`"),
        [
            Inline::Image {
                children: vec![Inline::Text("x".to_owned())],
                destination: "y".to_owned()
            },
            Inline::Text(" ".to_owned()),
            Inline::Code {
                backtick_length: 2,
                content: "a`b".to_owned()
            },
            Inline::Text(" ".to_owned()),
            Inline::Code {
                backtick_length: 1,
                content: "C:\\".to_owned()
            },
        ]
    );
}

#[test]
fn list_identity_and_numbering_are_recorded() {
    let blocks = parse_markdown("007) a\n1) b\n- c");
    assert_eq!(blocks.len(), 2);
    assert!(matches!(
        blocks[0].kind,
        BlockKind::List {
            marker: ListMarker::Ordered {
                delimiter: ')',
                start: 7
            },
            ..
        }
    ));
    assert!(matches!(
        blocks[1].kind,
        BlockKind::List {
            marker: ListMarker::Bullet { character: '-' },
            ..
        }
    ));
}

#[test]
fn table_rows_stay_one_block_and_do_not_open_indented_code() {
    let blocks = parse_markdown("| a |\n| b |\n    c");
    assert_eq!(kinds(&blocks), [(false, "table"), (false, "paragraph")]);
    assert_eq!(plain_inline(&parse_inline("`x`")), "`x`");
}

fn table_lines(block: &Block) -> Vec<String> {
    match &block.kind {
        BlockKind::Table { lines } => lines.iter().map(|line| plain_inline(line)).collect(),
        other => panic!("a table, not {other:?}"),
    }
}

fn paragraph_lines(block: &Block) -> Vec<String> {
    match &block.kind {
        BlockKind::Paragraph { lines } => lines.iter().map(|line| plain_inline(line)).collect(),
        other => panic!("a paragraph, not {other:?}"),
    }
}

fn only_item_blocks(block: &Block) -> &[Block] {
    let BlockKind::List { items, .. } = &block.kind else {
        panic!("a list");
    };
    assert_eq!(items.len(), 1);
    &items[0].blocks
}

// manpage-markdown.test.ts: rows between paragraph lines, a row in an item, and a lone row.
#[test]
fn table_rows_interrupt_a_paragraph_and_continue_an_item_paragraph_as_rows() {
    let blocks = parse_markdown("intro\n| a | b |\n| c | d |\nafter\n\n| e |\n\n- item\n  | f |");
    assert_eq!(
        kinds(&blocks),
        [
            (false, "paragraph"),
            (false, "table"),
            (false, "paragraph"),
            (true, "table"),
            (true, "list"),
        ]
    );
    assert_eq!(paragraph_lines(&blocks[0]), ["intro"]);
    assert_eq!(table_lines(&blocks[1]), ["| a | b |", "| c | d |"]);
    assert_eq!(paragraph_lines(&blocks[2]), ["after"]);
    assert_eq!(table_lines(&blocks[3]), ["| e |"]);
    let item = only_item_blocks(&blocks[4]);
    assert_eq!(kinds(item), [(false, "paragraph"), (false, "table")]);
    assert_eq!(paragraph_lines(&item[0]), ["item"]);
    assert_eq!(table_lines(&item[1]), ["| f |"]);
}

// manpage-markdown.test.ts: four-space indentation after rows is paragraph text.
#[test]
fn an_indented_line_after_rows_is_paragraph_text_after_a_paragraph() {
    let blocks = parse_markdown("Para.\n| a | b |\n    indented line after rows");
    assert_eq!(
        kinds(&blocks),
        [(false, "paragraph"), (false, "table"), (false, "paragraph")]
    );
    assert_eq!(table_lines(&blocks[1]), ["| a | b |"]);
    assert_eq!(paragraph_lines(&blocks[2]), ["indented line after rows"]);
}

#[test]
fn an_indented_line_after_rows_that_open_the_details_is_paragraph_text() {
    let blocks = parse_markdown("| a | b |\n    indented line after rows");
    assert_eq!(kinds(&blocks), [(false, "table"), (false, "paragraph")]);
    assert_eq!(table_lines(&blocks[0]), ["| a | b |"]);
    assert_eq!(paragraph_lines(&blocks[1]), ["indented line after rows"]);
}

#[test]
fn an_indented_line_past_the_item_column_after_item_rows_is_paragraph_text() {
    let blocks = parse_markdown("- item\n  | a | b |\n      deeper line");
    assert_eq!(kinds(&blocks), [(false, "list")]);
    let item = only_item_blocks(&blocks[0]);
    assert_eq!(
        kinds(item),
        [(false, "paragraph"), (false, "table"), (false, "paragraph")]
    );
    assert_eq!(table_lines(&item[1]), ["| a | b |"]);
    assert_eq!(paragraph_lines(&item[2]), ["deeper line"]);
}

// manpage-markdown.test.ts: a heading parses inside an item.
#[test]
fn a_heading_inside_an_item_is_parsed_with_its_following_paragraph() {
    let blocks = parse_markdown("- # Title *now*\n\n  text");
    let item = only_item_blocks(&blocks[0]);
    assert_eq!(kinds(item), [(false, "heading"), (true, "paragraph")]);
    let BlockKind::Heading { level, text } = &item[0].kind else {
        panic!("a heading");
    };
    assert_eq!((*level, plain_inline(text).as_str()), (1, "Title now"));
    assert_eq!(paragraph_lines(&item[1]), ["text"]);
}

// markdown-details.test.ts, first test: the fixture's page lines.
#[test]
fn details_with_a_heading_list_inline_constructs_and_an_info_fence_render_exact_lines() {
    let source = "Intro.\n\n# Title\n- A **key**: `a.b`.\n- See [format](https://example.org).\n\n```ts\n**literal**\n```";
    assert_eq!(
        render_plain(source),
        lines(&[
            "  Intro.",
            "",
            "  Title",
            "  ─────",
            "  ● A key: `a.b`.",
            "  ● See format (https://example.org).",
            "",
            "    **literal**",
        ])
    );
}
