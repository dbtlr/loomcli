//! Markdown Details through the help page, ported from the reference's `markdown-details.test.ts`
//! (the block and inline cases of `markdown-cases.ts` through the shipped view, and the manifest's
//! copy of the source) and the help cases of `markdown-parser.test.ts`: the compact pointer, the
//! source help supplies, the whitespace fault, and the themed bytes of each block and inline style.

#![cfg(feature = "help")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod help_support;

use help_support::{markdown_theme, noop, panic_message, plain, run_with, text};
use loomcli_core::{
    AnyPlugin, Application, Done, NoInputs, NoResult, Opt, Plugin, RenderingPolicy, Switch,
    read_extension,
};
use loomcli_plugins::help::extension::{HELP_COMMAND, HelpCommandFacts};
use loomcli_plugins::help::help;
use loomcli_plugins::manifest::extension::{MANIFEST_COMMAND, ManifestCommandFacts};
use loomcli_testing::MockFields;

type App = Application<NoInputs, NoResult, Done>;

/// A stand-in for the manifest plugin's option, so the page lists `--manifest` as the reference's
/// fixture, which installs `manifest()` after `help()`, does.
fn manifest_stand_in() -> Plugin {
    Plugin::new("@loomcli/plugins/manifest").option(
        "manifest",
        Opt::boolean()
            .control()
            .description("Print this command's manifest as JSON."),
    )
}

fn details_app(details: &str, installed: Vec<AnyPlugin>) -> App {
    Application::new("app")
        .plugins(installed)
        .extend([HELP_COMMAND.value(HelpCommandFacts::new().details(details))])
        .action(noop)
}

/// The page of the reference's `markdown-help` fixture: help and the manifest, plain.
async fn fixture_page(details: &str) -> (u8, String, String) {
    let application = details_app(details, vec![help().into(), manifest_stand_in().into()]);
    let (outcome, _) = run_with(
        &application,
        MockFields::new().argv(["--help"]),
        Some(plain()),
    )
    .await;
    (outcome.status, outcome.stdout, outcome.stderr)
}

/// The complete plain page around Details, authored from the contract.
fn fixture(lines: &[&str]) -> (u8, String, String) {
    let mut all = vec!["app", ""];
    all.extend_from_slice(lines);
    if !lines.is_empty() {
        all.push("");
    }
    all.extend([
        "USAGE",
        "  app [options]",
        "",
        "OPTIONS",
        "  -h, --help      Show this help.",
        "      --manifest  Print this command's manifest as JSON.",
    ]);
    (0, text(&all), String::new())
}

#[tokio::test]
async fn details_renders_authored_paragraphs_headings_lists_code_and_links() {
    assert_eq!(
        fixture_page(
            "Intro.\n\n# Title\n- A **key**: `a.b`.\n- See [format](https://example.org).\n\n```ts\n**literal**\n```"
        )
        .await,
        fixture(&[
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

#[tokio::test]
async fn built_markdown_blocks() {
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
        assert_eq!(fixture_page(source).await, fixture(expected), "{name}");
    }
}

#[tokio::test]
async fn built_markdown_inline() {
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
        let line = format!("  {expected}");
        assert_eq!(fixture_page(source).await, fixture(&[&line]), "{name}");
    }
}

#[test]
fn the_manifest_retains_markdown_source_bytes_including_its_final_terminator() {
    let application = details_app(
        "# Heading\n\n- item\n",
        vec![help().into(), manifest_stand_in().into()],
    );
    let graph = application.inspect().unwrap();
    assert_eq!(
        read_extension(&graph.root, &MANIFEST_COMMAND).unwrap(),
        [ManifestCommandFacts::new().details("# Heading\n\n- item\n")]
    );
}

// The help cases of `markdown-parser.test.ts`.

/// The page help prints for `details` with help alone, under the custom three-color theme when
/// `themed`, with modifiers as `modifiers` says.
async fn render(details: &str, argv: &[&str], themed: bool, modifiers: bool) -> String {
    let mut installed: Vec<AnyPlugin> = vec![help().into()];
    if themed {
        installed.push(markdown_theme().into());
    }
    let switch = |on: bool| if on { Switch::Always } else { Switch::Never };
    let policy = RenderingPolicy::new()
        .color(switch(themed))
        .modifiers(switch(modifiers));
    let (outcome, _) = run_with(
        &details_app(details, installed),
        MockFields::new().argv(argv.iter().copied()),
        Some(policy),
    )
    .await;
    assert_eq!((outcome.status, outcome.stderr.as_str()), (0, ""));
    outcome.stdout
}

fn page(lines: &[&str]) -> String {
    let mut all = vec!["app", ""];
    all.extend_from_slice(lines);
    if !lines.is_empty() {
        all.push("");
    }
    all.extend([
        "USAGE",
        "  app [options]",
        "",
        "OPTIONS",
        "  -h, --help  Show this help.",
    ]);
    text(&all)
}

/// The custom theme styles the rest of the page around a hand-written ANSI Details block.
fn themed_page(lines: &[&str], modifiers: bool) -> String {
    let mut all = vec![
        if modifiers {
            "\u{1b}[36;1mapp\u{1b}[39;22m"
        } else {
            "\u{1b}[36mapp\u{1b}[39m"
        },
        "",
    ];
    all.extend_from_slice(lines);
    all.extend([
        "",
        "\u{1b}[35mUSAGE\u{1b}[39m",
        if modifiers {
            "  \u{1b}[36mapp\u{1b}[39m \u{1b}[35;3m[options]\u{1b}[39;23m"
        } else {
            "  \u{1b}[36mapp\u{1b}[39m \u{1b}[35m[options]\u{1b}[39m"
        },
        "",
        "\u{1b}[35mOPTIONS\u{1b}[39m",
        "  \u{1b}[36m-h\u{1b}[35m,\u{1b}[39m \u{1b}[36m--help\u{1b}[39m  \u{1b}[32mShow this help.\u{1b}[39m",
    ]);
    text(&all)
}

#[tokio::test]
async fn empty_markdown_omits_details_and_the_compact_pointer() {
    for source in ["#", "```\n```", "~~~\n\n~~~"] {
        assert_eq!(render(source, &["--help"], false, false).await, page(&[]));
        assert_eq!(render(source, &["-h"], false, false).await, page(&[]));
    }
}

#[tokio::test]
async fn compact_help_omits_rendered_markdown_and_points_to_extended_help() {
    assert_eq!(
        render("# Heading\n- item", &["-h"], false, false).await,
        format!("{}\nRun app --help for details and examples.\n", page(&[]))
    );
}

#[test]
fn help_supplies_the_exact_markdown_source_including_its_final_terminator() {
    let source = "  # Heading\r\n\r\n- **item**\n";
    let application = details_app(source, vec![help().into()]);
    assert_eq!(
        read_extension(&application.inspect().unwrap().root, &MANIFEST_COMMAND).unwrap(),
        [ManifestCommandFacts::new().details(source)]
    );
}

#[test]
fn whitespace_only_details_faults_at_both_declaration_calls() {
    for details in ["", " \t\n\r\u{2028}"] {
        let sentence = "Supply Markdown that holds a character other than whitespace.";
        let help_fault = panic_message(|| {
            drop(
                Application::new("app")
                    .extend([HELP_COMMAND.value(HelpCommandFacts::new().details(details))]),
            );
        });
        assert!(help_fault.unwrap().contains(sentence), "{details:?}");
        let manifest_fault = panic_message(|| {
            drop(
                Application::new("app")
                    .extend([MANIFEST_COMMAND.value(ManifestCommandFacts::new().details(details))]),
            );
        });
        assert!(manifest_fault.unwrap().contains(sentence), "{details:?}");
    }
}

#[tokio::test]
async fn themed_bytes_pin_blocks_nested_modifiers_code_destinations_addresses_and_markers() {
    assert_eq!(
        render(
            "Plain line.\n# Heading `code`\n**bold _nested_**\n**`code`**\n*[link](url)*\n[url](url) <https://a>\n- item\n> quote\n---\n```\n  code\n```",
            &["--help"],
            true,
            true,
        )
        .await,
        themed_page(
            &[
                "  \u{1b}[32mPlain line.\u{1b}[39m",
                "  \u{1b}[35mHeading \u{1b}[36m`code`\u{1b}[39m",
                "  \u{1b}[35m──────────────\u{1b}[39m",
                "  \u{1b}[32;1mbold \u{1b}[3mnested\u{1b}[39;22;23m",
                "  \u{1b}[36;1m`code`\u{1b}[39;22m",
                "  \u{1b}[32;3mlink\u{1b}[39m \u{1b}[35m(url)\u{1b}[39;23m",
                "  \u{1b}[32murl https://a\u{1b}[39m",
                "  \u{1b}[35m●\u{1b}[39m \u{1b}[32mitem\u{1b}[39m",
                "  \u{1b}[35m>\u{1b}[39m \u{1b}[32mquote\u{1b}[39m",
                "  \u{1b}[32m---\u{1b}[39m",
                "    \u{1b}[36m  code\u{1b}[39m",
            ],
            true
        )
    );
}

#[tokio::test]
async fn themed_bytes_pin_a_level_2_heading_and_right_aligned_ordered_markers_as_dim() {
    assert_eq!(
        render("## Sub\n9. nine\n9. ten", &["--help"], true, false).await,
        themed_page(
            &[
                "  \u{1b}[35mSub\u{1b}[39m",
                "  \u{1b}[35m 9.\u{1b}[39m \u{1b}[32mnine\u{1b}[39m",
                "  \u{1b}[35m10.\u{1b}[39m \u{1b}[32mten\u{1b}[39m",
            ],
            false
        )
    );
}

#[tokio::test]
async fn marker_characters_in_headings_spans_code_and_destinations_print_literally() {
    assert_eq!(
        render(
            "# Heading \u{e001}red\u{e002}\n`\u{e003}`\n```\n\u{e001}code\u{e002}\n```\n[text](\u{e001}url\u{e002})",
            &["--help"],
            true,
            true,
        )
        .await,
        themed_page(
            &[
                "  \u{1b}[35mHeading \u{e001}red\u{e002}\u{1b}[39m",
                "  \u{1b}[35m─────────────\u{1b}[39m",
                "  \u{1b}[36m`\u{e003}`\u{1b}[39m",
                "    \u{1b}[36m\u{e001}code\u{e002}\u{1b}[39m",
                "  \u{1b}[32mtext\u{1b}[39m \u{1b}[35m(\u{e001}url\u{e002})\u{1b}[39m",
            ],
            true
        )
    );
}

#[tokio::test]
async fn disabled_modifiers_add_no_escapes_for_emphasis_or_headings() {
    assert_eq!(
        render("# Heading\n**bold** _italic_", &["--help"], true, false).await,
        themed_page(
            &[
                "  \u{1b}[35mHeading\u{1b}[39m",
                "  \u{1b}[35m───────\u{1b}[39m",
                "  \u{1b}[32mbold italic\u{1b}[39m",
            ],
            false
        )
    );
    assert_eq!(
        render("# Heading\n**bold** _italic_", &["--help"], false, false).await,
        page(&["  Heading", "  ───────", "  bold italic"])
    );
}

#[tokio::test]
async fn a_plain_paragraph_keeps_its_spaces_inside_one_primary_themed_run() {
    assert_eq!(
        render("One plain line.", &["--help"], true, false).await,
        themed_page(&["  \u{1b}[32mOne plain line.\u{1b}[39m"], false)
    );
}

#[tokio::test]
async fn an_address_only_link_uses_surrounding_styles_instead_of_its_text_modifiers() {
    assert_eq!(
        render(
            "[**u**](u)\n*[**u**](u)*\n[`u`](`u`)",
            &["--help"],
            true,
            true
        )
        .await,
        themed_page(
            &[
                "  \u{1b}[32mu\u{1b}[39m",
                "  \u{1b}[32;3mu\u{1b}[39;23m",
                "  \u{1b}[32m`u`\u{1b}[39m",
            ],
            true
        )
    );
}
