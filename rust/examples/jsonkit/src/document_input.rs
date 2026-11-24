//! The document input every document Command declares.

use loomcli_core::{Content, ContentOpt, Inputs, Opt};
use loomcli_plugins::help::extension::{HELP_INPUT, HelpInputFacts};

/// Each document Command owns its source; unrelated Commands have no document input. The field
/// type of each Command's inputs makes it required.
pub fn document_input() -> ContentOpt {
    Opt::content()
        .description("The document to read. Omit it to read piped text.")
        .extend([HELP_INPUT.value(HelpInputFacts::placeholder("path"))])
        .short('f')
        .stdin()
}

/// What a Command that reads the document and nothing else declares: the root, `debug`, and
/// `paths`.
#[derive(Inputs)]
pub struct DocumentInputs {
    /// The document, from the shared document input.
    #[option(builder = document_input())]
    pub file: Content,
}
