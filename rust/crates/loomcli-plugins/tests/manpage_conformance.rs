//! The structure of the conformance corpus's generated pages (`jsonkit-manpage-generate`), run on
//! a reduced jsonkit: the `get` Command with its details, argument, content option, and examples,
//! and the manpage plugin's own pages. Each page must equal the corpus file byte for byte. The
//! full set, with every plugin's pages, is asserted by the jsonkit example's own tests.

#![cfg(feature = "manpage")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loomcli_core::{Application, Arg, Command, Context, Opt, Outcome};
use loomcli_plugins::help::extension::{
    CommandExample, HELP_COMMAND, HELP_INPUT, HelpCommandFacts, HelpInputFacts,
};
use loomcli_plugins::manpage::manpage;
use loomcli_plugins::manpage::test_support::man_pages;

async fn noop(_context: Context) -> Outcome {
    Ok(())
}

/// The corpus file of one page of `jsonkit manpage generate`.
macro_rules! corpus {
    ($file:literal) => {
        include_str!(concat!(
            "../../../conformance/expected/jsonkit-manpage-generate/files/man/",
            $file
        ))
    };
}

fn reduced_jsonkit() -> Vec<(String, String)> {
    let get = Command::new("get")
        .description("Read one value at a path.")
        .extend([HELP_COMMAND.value(
            HelpCommandFacts::new()
                .details(
                    "A path is a dot-separated walk from the root of the document.\n\n- A **key** reads an object's member, such as `user.name`.\n- A **whole number** reads an array's item, such as `items.0`.\n\nThe document is *JSON*; see [the format](https://www.json.org/json-en.html).\n",
                )
                .examples(vec![
                    CommandExample::new("get name -f doc.json"),
                    CommandExample::new("get nested.deep.value -f doc.json"),
                ])
                .section(&["Document commands", "Read"]),
        )])
        .option(
            "file",
            Opt::content()
                .description("The document to read. Omit it to read piped text.")
                .extend([HELP_INPUT.value(HelpInputFacts::placeholder("path"))])
                .short('f')
                .stdin()
                .required(),
        )
        .argument("path", Arg::string().description("Dot path to read.").required())
        .action(noop);
    let graph = Application::new("jsonkit")
        .plugins((manpage(),))
        .description("Read and reshape one JSON document.")
        .command(get)
        .inspect()
        .unwrap();
    man_pages(&graph)
        .unwrap()
        .into_iter()
        .map(|page| (page.file, page.text))
        .collect()
}

#[test]
fn the_pages_of_the_reduced_application_equal_the_corpus_files() {
    let pages = reduced_jsonkit();
    let page = |file: &str| {
        pages
            .iter()
            .find(|(each, _)| each == file)
            .map(|(_, text)| text.as_str())
            .unwrap_or_else(|| panic!("no page {file}"))
    };
    assert_eq!(page("jsonkit-get.1"), corpus!("jsonkit-get.1"));
    assert_eq!(page("jsonkit-manpage.1"), corpus!("jsonkit-manpage.1"));
    assert_eq!(
        page("jsonkit-manpage-generate.1"),
        corpus!("jsonkit-manpage-generate.1")
    );
    assert_eq!(
        page("jsonkit-manpage-install.1"),
        corpus!("jsonkit-manpage-install.1")
    );
    assert_eq!(
        page("jsonkit-manpage-update.1"),
        corpus!("jsonkit-manpage-update.1")
    );
    assert_eq!(
        page("jsonkit-manpage-uninstall.1"),
        corpus!("jsonkit-manpage-uninstall.1")
    );
}
