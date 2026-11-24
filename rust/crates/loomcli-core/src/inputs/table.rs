//! The spelling table of one option scope, and the declaration rules that compile it: names,
//! aliases, delimiters, keys, spellings, and environment variables.
//!
//! A scope is the options one table holds: one Command's local options, or the global options. The
//! table maps each accepted spelling to the option it binds, in the order the spellings were
//! declared, so `long`, `short`, and `negative` read back the way the reference's map reads them.

use crate::diagnostics::{DiagnosticParts, Finding, Literal, rules};
use crate::failures::DeclarationError;
use crate::failures::sentences::quoted;
use crate::support::is_declared_name;

use super::{OptionDecl, Polarity};

/// The correction every declared-name fault gives.
pub(crate) const DECLARED_NAME_CORRECTION: &str =
    "Use a nonempty name without a leading hyphen, whitespace, or \"=\".";

/// What one spelling is to the option it binds: the long spelling, the generated negative form, the
/// short spelling, or the long form of the alias at `index` in its `aliases` list.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Role {
    Long,
    Negative,
    Short,
    Alias { index: usize, negative: bool },
}

/// How a spelling reads its value: the next word, an implied value, a Boolean's own value, or one
/// more count. The parser reads it; the class decides whether a held occurrence rebinds.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Form {
    Separate { multiple: bool },
    Implied { multiple: bool, implied: String },
    Boolean { value: bool },
    Count,
}

/// One spelling's entry: the option's declared name, its role, and its form.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Spelling {
    pub(crate) name: String,
    pub(crate) role: Role,
    pub(crate) form: Form,
}

/// A scope's spellings, in declaration order.
pub(crate) type Table = Vec<(String, Spelling)>;

/// The table's entry for `spelling`.
pub(crate) fn lookup<'a>(table: &'a Table, spelling: &str) -> Option<&'a Spelling> {
    table
        .iter()
        .find(|(known, _)| known == spelling)
        .map(|(_, entry)| entry)
}

/// The long, negative, and short spellings `name` holds in `table`, aliases aside.
pub(crate) fn spellings_of(table: &Table, name: &str) -> [Option<String>; 3] {
    let mut spellings: [Option<String>; 3] = [None, None, None];
    for (spelling, entry) in table {
        if entry.name != name {
            continue;
        }
        let slot = match entry.role {
            Role::Long => 0,
            Role::Negative => 1,
            Role::Short => 2,
            Role::Alias { .. } => continue,
        };
        spellings[slot] = Some(spelling.clone());
    }
    spellings
}

/// Where one input's declaration sits in the author's code: the call, the Command's path, its name,
/// and the builder chain, with the subject a fault's sentence names it by.
#[derive(Clone, Debug)]
pub(crate) struct InputSite {
    pub(crate) call: &'static str,
    /// The value the call sits on when it is not a Command, such as `Plugin::new("@acme/log")`,
    /// which a finding prints before the call in place of the Command's receiver.
    pub(crate) receiver: Option<String>,
    pub(crate) path: Vec<String>,
    pub(crate) name: String,
    pub(crate) config: Literal,
    pub(crate) subject: String,
}

impl InputSite {
    /// The finding that marks `mark` in the call's arguments.
    pub(crate) fn finding(&self, mark: &str) -> Finding {
        let arguments = vec![self.name.as_str().into(), self.config.clone()];
        let finding = match &self.receiver {
            Some(receiver) => Finding::new(format!("{receiver}.{}", self.call), arguments),
            None => Finding::new(self.call, arguments).path(self.path.clone()),
        };
        finding.mark(mark)
    }

    /// The finding that marks the name, with a note.
    pub(crate) fn named(&self, note: Option<&str>) -> Finding {
        let finding = self.finding("0");
        match note {
            Some(note) => finding.note(note),
            None => finding,
        }
    }

    /// The same site with its config elided, for a fault judged before the config is read.
    pub(crate) fn unread(&self) -> Self {
        Self {
            config: Literal::Opaque,
            ..self.clone()
        }
    }
}

/// The mark that points at the setter that generated a spelling.
pub(crate) fn spelling_mark(role: Role) -> String {
    match role {
        Role::Long => "0".to_owned(),
        Role::Short => "1.short".to_owned(),
        Role::Negative => "1.polarity".to_owned(),
        Role::Alias { index, .. } => format!("1.aliases.0.{index}"),
    }
}

/// One option of a scope as the compiler reads it.
pub(crate) struct ScopeOption<'a> {
    pub(crate) name: &'a str,
    pub(crate) decl: &'a OptionDecl,
    pub(crate) site: InputSite,
}

/// Rejects a name that is not a declared name: the option-name fault.
pub(crate) fn check_option_name(name: &str, site: &InputSite) -> Result<(), DeclarationError> {
    if is_declared_name(name) {
        return Ok(());
    }
    Err(DeclarationError::new(
        rules::DECLARED_NAME,
        DiagnosticParts::new(format!("Option name {} is invalid.", quoted(name)))
            .finding(site.unread().named(None))
            .correction(DECLARED_NAME_CORRECTION),
    ))
}

/// Rejects a builder combination the reference's types rule out, under `option-config`.
pub(crate) fn check_option_config(
    option: &ScopeOption<'_>,
    global: bool,
) -> Result<(), DeclarationError> {
    let Some((setter, reason)) = option.decl.config_conflict(global) else {
        return Ok(());
    };
    Err(DeclarationError::new(
        rules::OPTION_CONFIG,
        DiagnosticParts::new(format!("Option {} {reason}.", quoted(option.name)))
            .finding(option.site.finding(&format!("1.{setter}")))
            .correction("Remove the setter the option kind or its other facts exclude."),
    ))
}

/// The aliases that add a spelling: each alias that repeats neither the option's name nor an
/// earlier alias, with its index in the list.
pub(crate) fn distinct_aliases<'a>(name: &str, decl: &'a OptionDecl) -> Vec<(usize, &'a str)> {
    let mut seen: Vec<&str> = vec![name];
    let mut distinct = Vec::new();
    for (index, alias) in decl.facts().aliases.iter().enumerate() {
        if !seen.contains(&alias.as_str()) {
            seen.push(alias);
            distinct.push((index, alias.as_str()));
        }
    }
    distinct
}

/// The form a positive spelling of `decl` reads.
fn positive_form(decl: &OptionDecl) -> Form {
    match decl {
        OptionDecl::String(option) => match &option.implied {
            Some(implied) => Form::Implied {
                multiple: option.multiple,
                implied: implied.clone(),
            },
            None => Form::Separate {
                multiple: option.multiple,
            },
        },
        OptionDecl::Content(option) => Form::Separate {
            multiple: option.multiple,
        },
        OptionDecl::Boolean(option) => Form::Boolean {
            value: option.polarity != Polarity::Negative,
        },
        OptionDecl::Count(_) => Form::Count,
    }
}

/// A scope's spellings while they compile, with the option that claimed each.
struct Compiling<'a, 'b> {
    claims: Vec<(String, Spelling, &'b ScopeOption<'a>)>,
    names: Vec<&'b ScopeOption<'a>>,
    subject: &'b str,
}

impl<'a, 'b> Compiling<'a, 'b> {
    fn add_spelling(
        &mut self,
        spelling: String,
        entry: Spelling,
        option: &'b ScopeOption<'a>,
    ) -> Result<(), DeclarationError> {
        if let Some((_, existing, owner)) =
            self.claims.iter().find(|(known, _, _)| *known == spelling)
        {
            return Err(DeclarationError::new(
                rules::SPELLING_TAKEN,
                DiagnosticParts::new(format!(
                    "Option spelling {} is used by both {} and {}.",
                    quoted(&spelling),
                    quoted(&existing.name),
                    quoted(&entry.name)
                ))
                .finding(owner.site.finding(&spelling_mark(existing.role)))
                .finding(option.site.finding(&spelling_mark(entry.role)))
                .correction("Change one declaration."),
            ));
        }
        self.claims.push((spelling, entry, option));
        Ok(())
    }

    fn add_long_forms(
        &mut self,
        option: &'b ScopeOption<'a>,
        long: &str,
        alias: Option<usize>,
    ) -> Result<(), DeclarationError> {
        let polarity = option.decl.polarity();
        let mut forms = Vec::new();
        if polarity != Some(Polarity::Negative) {
            let role = alias.map_or(Role::Long, |index| Role::Alias {
                index,
                negative: false,
            });
            forms.push((format!("--{long}"), role, positive_form(option.decl)));
        }
        if matches!(polarity, Some(Polarity::Both | Polarity::Negative)) {
            let role = alias.map_or(Role::Negative, |index| Role::Alias {
                index,
                negative: true,
            });
            forms.push((format!("--no-{long}"), role, Form::Boolean { value: false }));
        }
        for (spelling, role, form) in forms {
            let own = matches!(role, Role::Alias { .. })
                && self
                    .claims
                    .iter()
                    .any(|(known, entry, _)| *known == spelling && entry.name == option.name);
            if !own {
                let entry = Spelling {
                    name: option.name.to_owned(),
                    role,
                    form,
                };
                self.add_spelling(spelling, entry, option)?;
            }
        }
        Ok(())
    }

    fn add_option(&mut self, option: &'b ScopeOption<'a>) -> Result<(), DeclarationError> {
        let name = option.name;
        check_option_name(name, &option.site)?;
        for (index, alias) in option.decl.facts().aliases.iter().enumerate() {
            if !is_declared_name(alias) {
                return Err(DeclarationError::new(
                    rules::DECLARED_NAME,
                    DiagnosticParts::new(format!(
                        "Option {} declares an alias named {}.",
                        quoted(name),
                        quoted(alias)
                    ))
                    .finding(option.site.finding(&format!("1.aliases.0.{index}")))
                    .correction(DECLARED_NAME_CORRECTION),
                ));
            }
        }
        let delimiter = match option.decl {
            OptionDecl::String(option) => option.env_delimiter.as_deref(),
            OptionDecl::Content(option) => option.env_delimiter.as_deref(),
            _ => None,
        };
        if delimiter == Some("") {
            return Err(DeclarationError::new(
                rules::ENV_DELIMITER,
                DiagnosticParts::new(format!(
                    "Option {} declares an empty envDelimiter.",
                    quoted(name)
                ))
                .finding(option.site.finding("1.env_delimiter"))
                .correction("Name the string that separates the items, such as \",\"."),
            ));
        }
        if let Some(first) = self.names.iter().find(|known| known.name == name) {
            return Err(DeclarationError::new(
                rules::OPTION_DECLARED_TWICE,
                DiagnosticParts::new(format!(
                    "Option {} is declared more than once on {}.",
                    quoted(name),
                    self.subject
                ))
                .finding(first.site.named(Some("the first declaration")))
                .finding(option.site.named(Some("the second declaration")))
                .correction("Remove or rename the duplicate."),
            ));
        }
        self.names.push(option);
        let facts = option.decl.facts();
        if !facts.short_only {
            self.add_long_forms(option, name, None)?;
            for (index, alias) in distinct_aliases(name, option.decl) {
                self.add_long_forms(option, alias, Some(index))?;
            }
        }
        if let Some(letter) = facts.short {
            let entry = Spelling {
                name: name.to_owned(),
                role: Role::Short,
                form: positive_form(option.decl),
            };
            self.add_spelling(format!("-{letter}"), entry, option)?;
        }
        Ok(())
    }
}

/// Compiles one scope's options into its spelling table, applying every per-option rule in
/// declaration order: the name, each alias name, the delimiter, the key, then each spelling.
pub(crate) fn compile(
    options: &[ScopeOption<'_>],
    subject: &str,
) -> Result<Table, DeclarationError> {
    let mut compiling = Compiling {
        claims: Vec::new(),
        names: Vec::new(),
        subject,
    };
    for option in options {
        compiling.add_option(option)?;
    }
    Ok(compiling
        .claims
        .into_iter()
        .map(|(spelling, entry, _)| (spelling, entry))
        .collect())
}

/// One variable an option binds, with the phrase a fault names the option by and its site.
pub(crate) struct BoundVariable {
    pub(crate) variable: String,
    pub(crate) phrase: String,
    pub(crate) site: InputSite,
}

/// The variables of each option, in declaration order.
pub(crate) fn bound_variables(
    options: &[ScopeOption<'_>],
    phrase: impl Fn(&ScopeOption<'_>) -> String,
) -> Vec<BoundVariable> {
    options
        .iter()
        .flat_map(|option| {
            let phrase = phrase(option);
            option
                .decl
                .facts()
                .env
                .iter()
                .map(move |variable| BoundVariable {
                    variable: variable.clone(),
                    phrase: phrase.clone(),
                    site: option.site.clone(),
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Claims each variable in order, after those `held` already holds, and rejects one claimed twice.
pub(crate) fn claim_variables(
    held: &[BoundVariable],
    bound: Vec<BoundVariable>,
) -> Result<(), DeclarationError> {
    let mut claimed: Vec<&BoundVariable> = held.iter().collect();
    for binder in &bound {
        if let Some(owner) = claimed
            .iter()
            .find(|owner| owner.variable == binder.variable)
        {
            return Err(DeclarationError::new(
                rules::VARIABLE_BOUND_TWICE,
                DiagnosticParts::new(format!(
                    "Variable {} is bound by {} and {}.",
                    quoted(&binder.variable),
                    owner.phrase,
                    binder.phrase
                ))
                .finding(owner.site.finding("1.env"))
                .finding(binder.site.finding("1.env"))
                .correction("Bind each variable to one option."),
            ));
        }
        claimed.push(binder);
    }
    Ok(())
}
