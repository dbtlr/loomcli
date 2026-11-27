//! The dotenv plugin: imports the variables the process has not set from the dotenv files in the
//! working directory, before defaults, implied values, and inputs validate.
//!
//! The plugin reads up to four files, from the most to the least specific: `.env.<mode>.local`,
//! `.env.local`, `.env.<mode>`, and `.env`. The mode is the value of `NODE_ENV` in the environment
//! the hook receives, as in the reference, and under `NODE_ENV=test` the plugin skips `.env.local`.
//! A variable the environment holds, an empty one included, beats every file.

mod expand;
mod messages;
mod parse;
mod read;

use std::collections::BTreeSet;
use std::marker::PhantomData;
use std::sync::Arc;

use loomcli_core::{
    AnyPlugin, DeclarationError, DiagnosticParts, DiagnosticRule, Finding, Plugin, diagnostic_rule,
};

use crate::PACKAGE_NAME;

const VARIABLE_NAME_RULE: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/dotenv/variable-name",
    "Invalid dotenv variable name",
    "The dotenv plugin compares each name an only or except list holds with the names the assignments in the dotenv files give, and an assignment names a variable with a letter or underscore followed by letters, digits, or underscores. A listed name of another form never matches, so the list would not do what it says.",
);

/// Whether a name follows the environment variable grammar: a letter or underscore, then letters,
/// digits, or underscores.
fn is_variable_name(name: &str) -> bool {
    let mut characters = name.chars();
    characters
        .next()
        .is_some_and(|first| first.is_ascii_alphabetic() || first == '_')
        && characters.all(|character| character.is_ascii_alphanumeric() || character == '_')
}

/// The settings state of a builder that lists no names: it imports every name the files define.
#[derive(Debug)]
pub struct AllNames;

/// The settings state after [`Dotenv::only`].
#[derive(Debug)]
pub struct OnlyListed;

/// The settings state after [`Dotenv::except`].
#[derive(Debug)]
pub struct ExceptListed;

/// Which names the plugin imports.
#[derive(Debug)]
enum Names {
    All,
    Only(BTreeSet<String>),
    Except(BTreeSet<String>),
}

impl Names {
    fn exclusion(&self, name: &str) -> Option<messages::Skip<'static>> {
        match self {
            Names::Only(listed) if !listed.contains(name) => Some(messages::Skip::NotOnly),
            Names::Except(listed) if listed.contains(name) => Some(messages::Skip::Except),
            _ => None,
        }
    }
}

/// The dotenv plugin's settings builder.
///
/// With no list it imports every name the dotenv files define. [`only`](Dotenv::only) is an allow
/// list and [`except`](Dotenv::except) a deny list; a builder takes one of them, so a call that
/// gives both does not compile.
#[derive(Debug)]
#[must_use]
pub struct Dotenv<List = AllNames> {
    names: Names,
    list: PhantomData<List>,
}

/// The dotenv plugin: imports every variable the dotenv files in the working directory define that
/// the process has not set.
pub fn dotenv() -> Dotenv {
    Dotenv {
        names: Names::All,
        list: PhantomData,
    }
}

/// The listed names, or the `@loomcli/plugins/dotenv/variable-name` panic for a name that is not
/// an environment variable name.
#[track_caller]
fn listed_names(call: &str, names: Vec<String>) -> BTreeSet<String> {
    if let Some(invalid) = names.iter().position(|name| !is_variable_name(name)) {
        let fault = DeclarationError::new(
            VARIABLE_NAME_RULE,
            DiagnosticParts::new(format!(
                "Plugin \"{PACKAGE_NAME}/dotenv\" setting \"{}\" lists a name that is not an environment variable name.",
                call.trim_start_matches("dotenv().")
            ))
            .finding(Finding::new(call, vec![names.into()]).mark(format!("0.{invalid}")))
            .correction("Name each variable with a letter or underscore followed by letters, digits, or underscores, such as API_TOKEN."),
        );
        panic!("{}", loomcli_core::FailureFacts::message(&fault));
    }
    names.into_iter().collect()
}

impl Dotenv<AllNames> {
    /// An allow list: the plugin imports only the names it lists. A name of another form than a
    /// letter or underscore followed by letters, digits, or underscores panics at this call with
    /// the `@loomcli/plugins/dotenv/variable-name` diagnostic. A name listed twice is listed once.
    #[track_caller]
    pub fn only(self, names: impl IntoIterator<Item = impl Into<String>>) -> Dotenv<OnlyListed> {
        let names = names.into_iter().map(Into::into).collect();
        Dotenv {
            names: Names::Only(listed_names("dotenv().only", names)),
            list: PhantomData,
        }
    }

    /// A deny list: the plugin imports every name but the ones it lists. A name of another form
    /// panics at this call as [`only`](Dotenv::only) does.
    #[track_caller]
    pub fn except(
        self,
        names: impl IntoIterator<Item = impl Into<String>>,
    ) -> Dotenv<ExceptListed> {
        let names = names.into_iter().map(Into::into).collect();
        Dotenv {
            names: Names::Except(listed_names("dotenv().except", names)),
            list: PhantomData,
        }
    }
}

impl<List> Dotenv<List> {
    /// The plugin. Its `on_environment` hook reads the files in the working directory, warns for
    /// each malformed assignment of a name it imports, and adds the names the environment lacks.
    pub fn plugin(self) -> Plugin {
        let names = Arc::new(self.names);
        Plugin::new(format!("{PACKAGE_NAME}/dotenv")).on_environment(move |context| {
            let names = Arc::clone(&names);
            async move { read::read_dotenv(context, &names).await }
        })
    }
}

impl<List> From<Dotenv<List>> for AnyPlugin {
    fn from(settings: Dotenv<List>) -> Self {
        settings.plugin().into()
    }
}
