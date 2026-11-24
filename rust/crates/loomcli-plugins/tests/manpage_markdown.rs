//! Markdown details in roff, ported from the reference's `manpage-markdown.test.ts`.

#![cfg(feature = "manpage")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loomcli_plugins::manpage::test_support::details_lines;

/// The roff lines one Markdown source renders to, as DESCRIPTION opens with it.
fn roff(source: &[&str]) -> Vec<String> {
    details_lines(&source.join("\n"), false)
}

fn bullet() -> &'static str {
    r".IP \(bu 2"
}

#[test]
fn each_block_renders_to_the_pinned_roff() {
    let cases: Vec<(&str, Vec<&str>, Vec<&str>)> = vec![
        (
            "a paragraph keeps its lines as source lines, which man fills",
            vec!["one", "two"],
            vec!["one", "two"],
        ),
        (
            "a paragraph after another opens with .PP",
            vec!["one", "", "two"],
            vec!["one", ".PP", "two"],
        ),
        (
            "table rows read as the paragraph text they follow and lead, which man fills",
            vec![
                "intro",
                "| a | b |",
                "| c | d |",
                "after",
                "",
                "| e |",
                "",
                "- item",
                "  | f |",
            ],
            vec![
                "intro",
                "| a | b |",
                "| c | d |",
                "after",
                ".PP",
                "| e |",
                bullet(),
                "item",
                "| f |",
            ],
        ),
        (
            "a line indented four spaces directly after table rows is paragraph text, which man fills",
            vec!["Para.", "| a | b |", "    indented line after rows"],
            vec!["Para.", "| a | b |", "indented line after rows"],
        ),
        (
            "a line indented four spaces directly after table rows that open details is paragraph text",
            vec!["| a | b |", "    indented line after rows"],
            vec!["| a | b |", "indented line after rows"],
        ),
        (
            "a line indented four spaces past an item directly after its table rows is paragraph text",
            vec!["- item", "  | a | b |", "      deeper line"],
            vec![bullet(), "item", "| a | b |", "deeper line"],
        ),
        (
            "a heading at the top level is .SS with its inline constructs as plain text, and opens no .PP after it",
            vec![
                "intro",
                "",
                "# Read `x` *now* [here](https://x.org)",
                "",
                "text",
            ],
            vec!["intro", r#".SS "Read x now here <https://x.org>""#, "text"],
        ),
        (
            "a heading inside a list item is a paragraph in bold",
            vec!["- # Title *now*", "", "  text"],
            vec![
                bullet(),
                r"\fBTitle \fR\f(BInow\fR",
                ".PP",
                ".RS 2",
                "text",
                ".RE",
            ],
        ),
        (
            "fenced code drops blank lines at its ends, keeps an empty line, and trims each line end",
            vec!["before", "", "```", "", "  code  ", "", r"a\b", "", "```"],
            vec![
                "before", ".PP", ".RS 4", ".nf", "  code", r"\&", r"a\eb", ".fi", ".RE",
            ],
        ),
        (
            "indented code first in details opens no .PP",
            vec!["    one", "    .two", "", "after"],
            vec![
                ".RS 4", ".nf", "one", r"\&.two", ".fi", ".RE", ".PP", "after",
            ],
        ),
        (
            "code with no other line prints nothing",
            vec!["```", "", "```", "after"],
            vec!["after"],
        ),
        (
            "a thematic break is a paragraph that holds it as written",
            vec!["a", "", "---", "", "b"],
            vec!["a", ".PP", r"\-\-\-", ".PP", "b"],
        ),
        (
            "nested bullet lists indent by the parent marker, and an ordered list counts from its first number",
            vec![
                "- parent",
                "  - child",
                "- next",
                "",
                "007. seven",
                "008. eight",
                "010) ten",
            ],
            vec![
                bullet(),
                "parent",
                ".PP",
                ".RS 2",
                bullet(),
                "child",
                ".RE",
                bullet(),
                "next",
                ".IP 7. 3",
                "seven",
                ".IP 8. 3",
                "eight",
                ".IP 10) 4",
                "ten",
            ],
        ),
        (
            "an ordered list nests in a bullet item",
            vec!["- parent", "  1. one", "  2. two"],
            vec![
                bullet(),
                "parent",
                ".PP",
                ".RS 2",
                ".IP 1. 3",
                "one",
                ".IP 2. 3",
                "two",
                ".RE",
            ],
        ),
        (
            "an item whose first block is code holds every block in .RS right after .IP",
            vec!["- ```", "  code", "  ```", "  after"],
            vec![
                bullet(),
                ".RS 2",
                ".RS 4",
                ".nf",
                "code",
                ".fi",
                ".RE",
                ".PP",
                "after",
                ".RE",
            ],
        ),
        (
            "a quote holding a list indents it, with no paragraph request before the first item",
            vec!["> - one", "> - two"],
            vec![".RS 4", bullet(), "one", bullet(), "two", ".RE"],
        ),
        (
            "a quote after a paragraph writes its .PP before the .RS",
            vec!["text", "", "> quoted", "> more"],
            vec!["text", ".PP", ".RS 4", "quoted", "more", ".RE"],
        ),
        (
            "an item with two paragraphs holds the second in .PP and .RS",
            vec!["- first", "", "  second"],
            vec![bullet(), "first", ".PP", ".RS 2", "second", ".RE"],
        ),
        (
            "a paragraph after a list opens with .PP",
            vec!["- one", "", "after"],
            vec![bullet(), "one", ".PP", "after"],
        ),
    ];
    for (name, source, expected) in cases {
        assert_eq!(roff(&source), expected, "{name}");
    }
}

#[test]
fn each_inline_construct_renders_to_the_pinned_roff() {
    let cases: [(&str, &str, &str); 13] = [
        (
            "emphasis is italic",
            "an *open* door",
            r"an \fIopen\fR door",
        ),
        (
            "strong emphasis is bold",
            "a **bold** step",
            r"a \fBbold\fR step",
        ),
        (
            "a code span is bold without its backticks",
            "run `ls -l` now",
            r"run \fBls \-l\fR now",
        ),
        (
            "a code span inside emphasis is bold italic",
            "*read `x` here*",
            r"\fIread \fR\f(BIx\fR\fI here\fR",
        ),
        (
            "a link prints its text and its destination in angle brackets",
            "see [the format](https://www.json.org/json-en.html).",
            r"see the format <https://www.json.org/json\-en.html>.",
        ),
        (
            "a link whose text is its destination prints the destination alone",
            "see [https://x.org](https://x.org)",
            "see https://x.org",
        ),
        (
            "a link whose text is its destination keeps the fonts of its text",
            "see [**https://x.org**](https://x.org) and [`x`](x)",
            r"see \fBhttps://x.org\fR and \fBx\fR",
        ),
        (
            "an image whose text prints empty prints its destination alone, with no space before it",
            "![](logo.png) after",
            "logo.png after",
        ),
        (
            "a link whose text prints empty prints its destination alone",
            "see [](x.org)",
            "see x.org",
        ),
        (
            "a link whose text prints only whitespace prints its destination alone, with no space before it",
            "[ ](x.org) after",
            "x.org after",
        ),
        (
            "an image prints as a link with the same text",
            "![the logo](https://x.org/logo.png)",
            "the logo <https://x.org/logo.png>",
        ),
        (
            "an autolink prints its address",
            "mail <mailto:me@x.org>",
            "mail mailto:me@x.org",
        ),
        (
            "a backslash escape prints its character",
            r"\*not emphasis\*",
            "*not emphasis*",
        ),
    ];
    for (name, source, expected) in cases {
        assert_eq!(roff(&[source]), [expected], "{name}");
    }
}

#[test]
fn details_after_a_deprecation_paragraph_open_with_pp() {
    assert_eq!(details_lines("text", true), [".PP", "text"]);
    assert_eq!(details_lines("- item", true), [bullet(), "item"]);
    assert_eq!(details_lines("# Heading", true), [r#".SS "Heading""#]);
}

#[test]
fn a_tab_in_a_paragraph_is_a_space_and_one_in_code_is_kept() {
    assert_eq!(
        roff(&["a\tb", "", "```", "c\td", "```"]),
        ["a b", ".PP", ".RS 4", ".nf", "c\td", ".fi", ".RE"]
    );
}
