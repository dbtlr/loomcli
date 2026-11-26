//! The run-wide marks one global option carries: interaction, color, verbosity, and background.
//!
//! A mark is a setter on a global option builder ([`crate::BooleanOpt::interaction`],
//! [`crate::BooleanOpt::color`], [`crate::CountOpt::verbose`], [`crate::CountOpt::quiet`],
//! [`crate::StringOpt::background`]). One option per Application carries each mark. Core settles
//! each mark once per run, at the moment the reference names:
//!
//! - **Color** at host capture, from `host.argv`, before anything else prints, so a build fault
//!   already honours `--no-color`.
//! - **Background** at host capture, right after color, from `host.argv` or the bounded terminal
//!   query, before graph build.
//! - **Verbosity** right after graph build, from `host.argv` read with the parser's word reader,
//!   before environment preparation and before anything that can write a lane.
//! - **Interaction** after the input sources fill, from the terminal facts, `CI`, and the marked
//!   option's value, before validation.
//!
//! The context reads the result: `interactive`, the color decision inside the style, the verbosity
//! that gates `out.debug` and `out.trace`, and the background a view context reports.

use serde::Serialize;

use crate::application::declaration::ApplicationDeclaration;
use crate::commands::declaration::OptionInput;
use crate::diagnostics::{DiagnosticParts, DiagnosticRule, rules};
use crate::failures::DeclarationError;
use crate::failures::messages::quoted;
use crate::inputs::table::{Form, InputSite, Role};
use crate::invocation::parse::{Grammar, read_words, refuses_value};
use crate::style::ColorChoice;

/// The terminal's background, stated by the operator or detected from the terminal: the
/// `loomcli-style` type, which settlement and adaptive theme entries read.
pub use crate::style::Background;

/// When an input that is not plainly required is required.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum RequiredWhen {
    /// Required only when the run cannot ask the operator, the `'non-interactive'` presence.
    #[serde(rename = "non-interactive")]
    NonInteractive,
}

/// The name of the global option that carries `mark`, if one does: the application's own or an
/// installed plugin's, which join the globals and their table.
fn marked<'a>(application: &'a ApplicationDeclaration, mark: &str) -> Option<&'a str> {
    application
        .globals
        .iter()
        .find(|option| option.decl.marks().contains(&mark))
        .map(|option| option.name.as_str())
}

/// The marks the run settles before configuration, each with its rule, the run-wide fact a binding
/// would be a second source for, and the correction: color, the verbosity pair, and background.
const SETTLED_BEFORE_CONFIGURATION: [(&str, DiagnosticRule, &str, &str); 4] = [
    (
        "color",
        rules::COLOR_MARK,
        "color",
        "Remove the binding; the run reads its color before configuration.",
    ),
    (
        "verbose",
        rules::VERBOSE_MARK,
        "verbosity",
        "Remove the binding; the run settles its verbosity before configuration.",
    ),
    (
        "quiet",
        rules::QUIET_MARK,
        "verbosity",
        "Remove the binding; the run settles its verbosity before configuration.",
    ),
    (
        "background",
        rules::BACKGROUND_MARK,
        "background",
        "Remove the binding; the run reads its background before configuration.",
    ),
];

/// A global option that carries a mark the run settles before configuration carries no value of
/// the installed configuration source's binding: `binding` is that binding's identity when one is
/// installed. A binding of a source the Application does not install is inert.
pub(crate) fn check_mark_binding(
    option: &OptionInput,
    site: &InputSite,
    binding: Option<&str>,
) -> Result<(), DeclarationError> {
    let Some(binding) = binding else {
        return Ok(());
    };
    if !option
        .extensions
        .descriptors()
        .any(|descriptor| descriptor.identity == binding)
    {
        return Ok(());
    }
    let marks = option.decl.marks();
    let Some((fact, rule, settled, correction)) = SETTLED_BEFORE_CONFIGURATION
        .into_iter()
        .find(|(fact, ..)| marks.contains(fact))
    else {
        return Ok(());
    };
    Err(DeclarationError::new(
        rule,
        DiagnosticParts::new(format!(
            "{} declares {fact} and carries configuration binding {}, a second source for the run's {settled}.",
            site.subject,
            quoted(binding)
        ))
        .finding(site.finding("1.extend"))
        .correction(correction),
    ))
}

/// Whether the Application declares the color mark, which turns color off in the report of a run
/// whose host capture failed, before the operator's choice could be read.
pub(crate) fn declares_color(application: &ApplicationDeclaration) -> bool {
    marked(application, "color").is_some()
}

/// Whether the Application declares the background mark, which turns background detection on.
pub(crate) fn declares_background(application: &ApplicationDeclaration) -> bool {
    marked(application, "background").is_some()
}

/// The run's color choice from argv alone: the last word before the first bare `--` that equals a
/// long spelling of the color-marked option, its aliases' included, in the forms its polarity
/// generates. A positive spelling chooses `Always`, a negative one `Never`, and no match leaves the
/// run without a choice. A word that attaches a value equals no spelling.
pub(crate) fn color_choice(
    application: &ApplicationDeclaration,
    argv: &[String],
) -> Option<ColorChoice> {
    let name = marked(application, "color")?;
    let table = &application.global_table.table;
    let mut choice = None;
    for word in argv {
        if word == "--" {
            break;
        }
        let spelling = table
            .iter()
            .find(|(spelling, entry)| {
                spelling == word && entry.name == name && entry.role != Role::Short
            })
            .map(|(_, entry)| &entry.form);
        if let Some(Form::Boolean { value }) = spelling {
            choice = Some(if *value {
                ColorChoice::Always
            } else {
                ColorChoice::Never
            });
        }
    }
    choice
}

/// The run's background choice from argv alone: among the words before the first bare `--`, the
/// last occurrence of a long spelling of the background-marked option, its aliases' included,
/// whose value is `dark` or `light`. The value is attached after `=`, or is the next word unless
/// that word is an option word or the bare `--`. Any other value supplies nothing.
pub(crate) fn background_choice(
    application: &ApplicationDeclaration,
    argv: &[String],
) -> Option<Background> {
    let name = marked(application, "background")?;
    let spellings: Vec<&str> = application
        .global_table
        .table
        .iter()
        .filter(|(_, entry)| entry.name == name && entry.role != Role::Short)
        .map(|(spelling, _)| spelling.as_str())
        .collect();
    let mut choice = None;
    let mut index = 0;
    while let Some(word) = argv.get(index) {
        index += 1;
        if word == "--" {
            break;
        }
        let value = if spellings.contains(&word.as_str()) {
            match argv.get(index) {
                Some(next) if !refuses_value(next) => {
                    index += 1;
                    Some(next.as_str())
                }
                _ => None,
            }
        } else {
            word.split_once('=')
                .filter(|(spelling, _)| spellings.contains(spelling))
                .map(|(_, value)| value)
        };
        if let Some(background) = value.and_then(Background::from_name) {
            choice = Some(background);
        }
    }
    choice
}

/// The run's verbosity from argv, read against the built graph with the parser's own word reader
/// in the partial mode `locate` reads with, up to the first bare `--`: the verbose-marked option's
/// occurrences, at most 2, less the quiet-marked option's, at most 1. An occurrence the parse
/// faults counts nothing, and words that name an unknown command settle 0, as does an Application
/// with neither mark.
pub(crate) fn verbosity(
    application: &ApplicationDeclaration,
    grammar: &Grammar,
    argv: &[String],
) -> i8 {
    let verbose = marked(application, "verbose");
    let quiet = marked(application, "quiet");
    if verbose.is_none() && quiet.is_none() {
        return 0;
    }
    let Ok(read) = read_words(grammar, argv, true) else {
        return 0;
    };
    verbosity_of(&read.values.globals, verbose, quiet)
}

/// The verbosity an invocation by name settles from the values it lowers, so `verbose: 2` reads as
/// `-vv` does and a value the call cannot lower counts nothing. An unknown Command settles 0.
pub(crate) fn named_verbosity(
    application: &ApplicationDeclaration,
    grammar: &Grammar,
    call: &crate::invocation::lower::NamedCall<'_>,
) -> i8 {
    let verbose = marked(application, "verbose");
    let quiet = marked(application, "quiet");
    if verbose.is_none() && quiet.is_none() {
        return 0;
    }
    let Ok(parsed) = crate::invocation::lower::lower_invocation(grammar, call) else {
        return 0;
    };
    verbosity_of(&parsed.values.globals, verbose, quiet)
}

/// The verbose count, read as 2 above 2, less the quiet count, read as 1 above 1.
fn verbosity_of(
    globals: &crate::invocation::parse::OptionValues,
    verbose: Option<&str>,
    quiet: Option<&str>,
) -> i8 {
    let count = |name: Option<&str>, most: u32| {
        name.and_then(|name| globals.count(name))
            .map_or(0, |count| count.min(most))
    };
    let verbose = i8::try_from(count(verbose, 2)).unwrap_or(2);
    let quiet = i8::try_from(count(quiet, 1)).unwrap_or(1);
    verbose - quiet
}
