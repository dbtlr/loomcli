//! One validation pass over an invocation's inputs: the global options, then the routed Command's
//! own declarations, each in authoring order, then the standalone stdin and the option groups.
//!
//! This is the reference's `validateValues`. Every value an input source filled is a supplied value,
//! every problem is collected in reporting order, and the problems aggregate into one `InputError`
//! with core's sentences. A pass records what it settled in the run's [`Ledger`], so a later pass of
//! the same run reads each value an earlier one accepted and calls no validator twice.

use std::path::PathBuf;
use std::sync::Arc;

use crate::__private::RawValue;
use crate::commands::declaration::{InputDeclaration, OptionInput};
use crate::failures::{Error, InputError};
use crate::host::Host;
use crate::inspection::OptionGroup;
use crate::invocation::parse::OptionValues;

use super::content::{ContentScope, ContentSettings, Prepared, PreparedContent, prepare_content};
use super::declared::{
    DeclKey, Declared, DeclaredValues, Presence, messages, reported, text, validate_list,
};
use super::groups::{GroupContext, group_reports};
use super::messages;
use super::{
    Content, InputIdentity, InputKind, InputProblem, Issue, OptionDecl, Polarity, Stdin,
    SuppliedInputs, SuppliedValue, ValidationContext, ValidationPhase, issue_path,
};

/// What the input-source stage leaves for validation, by option name: the label of each value it
/// filled, the variable of each Boolean or counted option whose value is outside its grammar, the
/// configuration fills with the directory of the file each came from, the options a skipped
/// configuration source would have filled, and the members an exclusive group withdrew.
#[derive(Clone, Debug, Default)]
pub(crate) struct Provenance {
    pub(crate) fills: Vec<(String, Option<PathBuf>)>,
    pub(crate) labels: Vec<(String, String)>,
    pub(crate) rejected: Vec<(String, String)>,
    pub(crate) unanswered: Vec<String>,
    pub(crate) withdrawn: Vec<String>,
}

impl Provenance {
    pub(crate) fn label(&self, name: &str) -> Option<&String> {
        lookup(&self.labels, name)
    }

    pub(crate) fn rejected_variable(&self, name: &str) -> Option<&String> {
        lookup(&self.rejected, name)
    }

    pub(crate) fn fill(&self, name: &str) -> Option<&Option<PathBuf>> {
        lookup(&self.fills, name)
    }

    /// Whether `input` is an option a skipped configuration source would have been asked to fill.
    /// The record is keyed by option name, and an argument may share an option's name.
    fn unanswered(&self, input: Declared<'_>) -> bool {
        input.option().is_some() && self.unanswered.iter().any(|known| known == input.name())
    }
}

/// The value of `name` in an ordered list of pairs.
fn lookup<'m, K: PartialEq + ?Sized, T>(map: &'m [(String, T)], name: &K) -> Option<&'m T>
where
    String: PartialEq<K>,
{
    map.iter()
        .find(|(known, _)| known == name)
        .map(|(_, value)| value)
}

/// One validation problem and the lines core's default text holds for it.
#[derive(Clone, Debug)]
pub(crate) struct Report {
    pub(crate) lines: Vec<String>,
    pub(crate) problem: InputProblem,
}

/// Every outcome a run's validation passes settled, which each later pass reads, so a validator
/// runs at most once per run.
#[derive(Default)]
pub(crate) struct Ledger {
    values: Vec<(InputIdentity, RawValue)>,
    reports: Vec<(InputIdentity, Report)>,
}

impl Ledger {
    /// Whether a pass of the run accepted or reported the declaration.
    pub(crate) fn reached(&self, identity: &InputIdentity) -> bool {
        self.value(identity).is_some() || self.report(identity).is_some()
    }

    pub(crate) fn value(&self, identity: &InputIdentity) -> Option<&RawValue> {
        self.values
            .iter()
            .find(|(known, _)| known == identity)
            .map(|(_, value)| value)
    }

    /// Every value the run's passes accepted, by identity.
    pub(crate) fn into_values(self) -> Vec<(InputIdentity, RawValue)> {
        self.values
    }

    fn report(&self, identity: &InputIdentity) -> Option<&Report> {
        self.reports
            .iter()
            .find(|(known, _)| known == identity)
            .map(|(_, report)| report)
    }

    fn record(
        &mut self,
        values: &[(InputIdentity, RawValue)],
        reports: &[(InputIdentity, Report)],
    ) {
        for (identity, value) in values {
            if self.value(identity).is_none() {
                self.values.push((identity.clone(), value.clone()));
            }
        }
        for (identity, report) in reports {
            if self.report(identity).is_none() {
                self.reports.push((identity.clone(), report.clone()));
            }
        }
    }
}

/// One declaration under its scope.
#[derive(Clone, Copy)]
pub(crate) struct Scoped<'a> {
    pub(crate) global: bool,
    pub(crate) input: Declared<'a>,
}

impl Scoped<'_> {
    fn identity(&self) -> InputIdentity {
        self.input.identity(self.global)
    }
}

/// Every declaration in validation order: the global options first, then the routed Command's own.
pub(crate) fn scoped<'a>(
    globals: &'a [OptionInput],
    locals: &'a [InputDeclaration],
) -> Vec<Scoped<'a>> {
    globals
        .iter()
        .map(|option| Scoped {
            global: true,
            input: Declared::Option(option),
        })
        .chain(locals.iter().map(|input| Scoped {
            global: false,
            input: Declared::of(input),
        }))
        .collect()
}

/// Everything one pass validates: its declarations, its raw values, and where they were read.
pub(crate) struct Invocation<'a> {
    pub(crate) globals: &'a [OptionInput],
    /// The routed Command's own declarations, or none while a local fault is held.
    pub(crate) locals: &'a [InputDeclaration],
    pub(crate) groups: &'a [OptionGroup],
    /// The standalone stdin with the number of inputs declared before it.
    pub(crate) stdin: Option<(&'a Stdin, usize)>,
    pub(crate) interactive: bool,
    /// The routed path of canonical names.
    pub(crate) command: &'a [String],
    pub(crate) declared: &'a DeclaredValues,
    pub(crate) host: &'a Arc<Host>,
    /// Present for an invocation by name, which names every option by its declared name, with
    /// each input whose value no token spells and the issue that says what it takes.
    pub(crate) named: Option<&'a [(InputIdentity, String)]>,
    pub(crate) passthrough: &'a [String],
    /// The declarations this pass validates, when it validates only some of them.
    pub(crate) only: Option<&'a [InputIdentity]>,
    pub(crate) sources: &'a Provenance,
    pub(crate) args: &'a [(String, SuppliedValue)],
    pub(crate) options: &'a OptionValues,
    /// The spelling a problem names a routed option by.
    pub(crate) spelling: &'a dyn Fn(&str) -> String,
    pub(crate) cancelled: &'a dyn Fn() -> bool,
}

/// What one pass produced: every value it accepted, the configuration fills it dropped with the
/// debug line that names each, the standalone stdin, and the problems aggregated into one failure.
pub(crate) struct Validation {
    pub(crate) dropped: Vec<(String, String)>,
    pub(crate) stdin: Option<Content>,
    pub(crate) failure: Option<InputError>,
    pub(crate) values: Vec<(InputIdentity, RawValue)>,
}

impl Validation {
    /// Whether the pass rejected a global option. A global option declares no presence rule, so
    /// every problem it reports is a rejected value.
    pub(crate) fn rejects_global(&self) -> bool {
        self.failure.as_ref().is_some_and(|failure| {
            failure.problems().iter().any(|problem| match problem {
                InputProblem::Missing { input, .. } | InputProblem::Invalid { input, .. } => {
                    input.global
                }
                _ => false,
            })
        })
    }
}

/// A Boolean option's absent value: `true` under negative polarity alone.
pub(crate) fn absent_boolean(polarity: Polarity) -> bool {
    polarity == Polarity::Negative
}

/// Each Boolean option's absent value, by name.
pub(crate) fn absent_booleans(locals: &[InputDeclaration]) -> Vec<(String, bool)> {
    locals
        .iter()
        .filter_map(|input| match input {
            InputDeclaration::Option(option) => match &option.decl {
                OptionDecl::Boolean(boolean) => {
                    Some((option.name.clone(), absent_boolean(boolean.polarity)))
                }
                _ => None,
            },
            InputDeclaration::Argument(_) => None,
        })
        .collect()
}

/// The raw values of one invocation, keyed by declared name: every declared input of the routed
/// Command and every global option, so absence reads as the shape its declaration collects.
pub(crate) fn supplied_inputs(
    declarations: &[Scoped<'_>],
    args: &[(String, SuppliedValue)],
    options: &OptionValues,
) -> SuppliedInputs {
    let mut supplied = SuppliedInputs::default();
    for entry in declarations {
        let input = entry.input;
        let name = input.name();
        let collected = input.collects();
        let empty = || collected.then(|| SuppliedValue::Many(Vec::new()));
        match input {
            Declared::Argument(_) => {
                if let Some(value) = lookup(args, name).cloned().or_else(empty) {
                    supplied.args.insert(name.to_owned(), value);
                }
            }
            Declared::Option(option) => {
                let value = match &option.decl {
                    OptionDecl::Boolean(_) => options.boolean(name).map(SuppliedValue::Flag),
                    OptionDecl::Count(_) => options.count(name).map(SuppliedValue::Count),
                    _ if collected => options
                        .list(name)
                        .map(|list| SuppliedValue::Many(list.clone()))
                        .or_else(empty),
                    _ => options
                        .string(name)
                        .map(|value| SuppliedValue::One(value.clone())),
                };
                if let Some(value) = value {
                    supplied.options.insert(name.to_owned(), value);
                }
            }
        }
    }
    supplied
}

/// The issue a variable outside its option's grammar reports.
fn grammar_issue(decl: &OptionDecl) -> Issue {
    match decl {
        OptionDecl::Count(_) => Issue::new(messages::ENVIRONMENT_COUNT),
        _ => Issue::new(messages::ENVIRONMENT_BOOLEAN),
    }
}

/// How a diagnostic names an input: by kind and by the spelling that reaches it, with the source
/// of a value an input source filled in parentheses.
fn supplied_name(input: Declared<'_>, spelling: &str, origin: Option<&str>) -> String {
    match (input, origin) {
        (Declared::Argument(_), _) => messages::argument_subject(spelling),
        (Declared::Option(_), origin) => messages::option_subject(spelling, origin),
    }
}

/// The default sentence for an omitted required input.
fn missing_message(
    input: Declared<'_>,
    spelling: &str,
    collected: bool,
    origin: Option<&str>,
) -> String {
    let conditional = input.presence() == Presence::NonInteractive;
    match input {
        Declared::Argument(_) => messages::required_argument(spelling, collected, conditional),
        Declared::Option(_) => messages::required_option(
            &supplied_name(input, spelling, origin),
            conditional,
            &messages::OptionFix::Value { collected },
        ),
    }
}

/// A raw value as validation reads it: one string, a list, or none.
enum Raw<'a> {
    One(&'a str),
    Many(&'a [String]),
    None,
}

/// One pass's running state.
struct Pass<'i, 'a> {
    invocation: &'i Invocation<'a>,
    supplied: SuppliedInputs,
    values: Vec<(InputIdentity, RawValue)>,
    reports: Vec<(InputIdentity, Report)>,
    dropped: Vec<(String, String)>,
}

impl Pass<'_, '_> {
    fn spelling(&self, input: Declared<'_>) -> String {
        match input {
            Declared::Option(option) if self.invocation.named.is_none() => {
                (self.invocation.spelling)(&option.name)
            }
            _ => input.name().to_owned(),
        }
    }

    /// Where a filled option's value came from, which its diagnostic names; argv names none.
    fn origin(&self, input: Declared<'_>) -> Option<String> {
        match input {
            Declared::Option(option) => self.invocation.sources.label(&option.name).cloned(),
            Declared::Argument(_) => None,
        }
    }

    fn is_dropped(&self, input: Declared<'_>) -> bool {
        matches!(input, Declared::Option(option)
            if self.dropped.iter().any(|(name, _)| *name == option.name))
    }

    /// The host a validator of this input reads: the run's, or, for a value a configuration answer
    /// with a directory filled and that was not dropped, the run's with `cwd` replaced.
    fn host_for(&self, input: Declared<'_>) -> Arc<Host> {
        let directory = match input {
            Declared::Option(option) => self
                .invocation
                .sources
                .fill(&option.name)
                .and_then(Clone::clone),
            Declared::Argument(_) => None,
        };
        match directory {
            Some(directory) if !self.is_dropped(input) => {
                let mut host = Host::clone(self.invocation.host);
                host.cwd = directory;
                Arc::new(host)
            }
            _ => Arc::clone(self.invocation.host),
        }
    }

    fn context(&self, entry: Scoped<'_>) -> ValidationContext {
        ValidationContext {
            phase: ValidationPhase::Invocation,
            host: self.host_for(entry.input),
            input: entry.identity(),
            command: Some(self.invocation.command.to_vec()),
            passthrough: Some(self.invocation.passthrough.to_vec()),
            supplied: Some(self.supplied.clone()),
        }
    }

    fn key(&self, entry: Scoped<'_>) -> DeclKey {
        DeclKey::of(
            (!entry.global).then_some(self.invocation.command),
            entry.input,
        )
    }

    fn set(&mut self, entry: Scoped<'_>, value: RawValue) {
        self.values.push((entry.identity(), value));
    }

    fn requires(&self, input: Declared<'_>) -> bool {
        match input.presence() {
            Presence::Required => true,
            Presence::NonInteractive => !self.invocation.interactive,
            Presence::Optional => false,
        }
    }

    /// One missing input, unless a skipped configuration source would have been asked to fill it.
    fn omit(&mut self, entry: Scoped<'_>, spelling: String, line: String) {
        if self.invocation.sources.unanswered(entry.input) {
            return;
        }
        self.reports.push((
            entry.identity(),
            Report {
                lines: vec![line],
                problem: InputProblem::Missing {
                    input: entry.identity(),
                    spelling,
                },
            },
        ));
    }

    /// One rejected input, whatever rejected it.
    fn reject(&mut self, entry: Scoped<'_>, issues: Vec<Issue>, subject: &str) {
        let spelling = self.spelling(entry.input);
        self.reports.push((
            entry.identity(),
            Report {
                lines: messages(subject, &issues),
                problem: InputProblem::Invalid {
                    input: entry.identity(),
                    spelling,
                    issues,
                },
            },
        ));
    }

    /// Drops a value the configuration source filled, recording the debug line that names its
    /// first issue, and says whether it did. A value from any other tier is never dropped.
    fn drops_fill(
        &mut self,
        entry: Scoped<'_>,
        issues: &[Issue],
        origin: Option<&str>,
        spelling: &str,
    ) -> bool {
        let (Some(origin), Declared::Option(option)) = (origin, entry.input) else {
            return false;
        };
        if self.invocation.sources.fill(&option.name).is_none() {
            return false;
        }
        let first = issues.first();
        let path = first.and_then(issue_path);
        let message = first.map_or("", |issue| issue.message.as_str());
        self.dropped.push((
            option.name.clone(),
            messages::ignored_fill(spelling, path.as_deref(), origin, message),
        ));
        true
    }

    /// Validates one supplied raw value, or the omission for a validator that judges it.
    fn validated(&self, entry: Scoped<'_>, raw: &Raw<'_>) -> Result<RawValue, Vec<Issue>> {
        let input = entry.input;
        let key = self.key(entry);
        let implied = match input {
            Declared::Option(option) => self
                .invocation
                .options
                .implied_positions(&option.name)
                .zip(self.invocation.declared.implied_of(&key)),
            Declared::Argument(_) => None,
        };
        let validator = input.validator();
        match raw {
            Raw::One(value) => {
                if let Some((positions, output)) = implied
                    && positions.contains(&0)
                {
                    // A bare spelling supplied the implied value, prepared before any token.
                    return Ok(RawValue::One(Arc::clone(output)));
                }
                match validator {
                    Some(validator) => validator
                        .validate(value, &self.context(entry))
                        .map(RawValue::One)
                        .map_err(reported),
                    None => Ok(RawValue::One(text(value))),
                }
            }
            Raw::Many(values) => validate_list(
                validator,
                values,
                &|| self.context(entry),
                implied.map(|(positions, output)| (positions.as_slice(), output)),
                self.invocation.cancelled,
            ),
            Raw::None => match validator
                .and_then(|validator| validator.validate_omission(&self.context(entry)))
            {
                Some(verdict) => verdict.map(RawValue::One).map_err(reported),
                None => Ok(RawValue::Absent),
            },
        }
    }

    /// One path for every value a validator reads.
    fn accept(&mut self, entry: Scoped<'_>, raw: &Raw<'_>, origin: Option<&str>, spelling: &str) {
        match self.validated(entry, raw) {
            Ok(value) => self.set(entry, value),
            Err(issues) => {
                if self.drops_fill(entry, &issues, origin, spelling) {
                    // A configuration fill its validator rejects falls back, as if no tier had
                    // supplied it.
                    self.absent(entry, spelling, true);
                    return;
                }
                let subject = supplied_name(entry.input, spelling, origin);
                self.reject(entry, issues, &subject);
            }
        }
    }

    /// One input no tier supplied, or whose configuration fill was dropped: its default, or its
    /// absence rule.
    fn absent(&mut self, entry: Scoped<'_>, spelling: &str, fell_back: bool) {
        let input = entry.input;
        let collected = input.collects();
        let default = self
            .invocation
            .declared
            .default_of(&self.key(entry))
            .cloned();
        if self.requires(input) {
            let line = missing_message(input, spelling, collected, None);
            self.omit(entry, spelling.to_owned(), line);
        } else if collected && default.is_none() {
            // No occurrence has no value to validate, so the action receives an empty list.
            self.set(entry, RawValue::Many(Vec::new()));
        } else if input.validates_omission()
            && (fell_back || !self.invocation.sources.unanswered(input))
        {
            // The omission reaches the validator, in the invocation phase.
            self.accept(entry, &Raw::None, None, spelling);
        } else {
            self.set(entry, default.unwrap_or(RawValue::Absent));
        }
    }

    /// A content input's sources, prepared from its raw operands.
    fn content(
        &mut self,
        entry: Scoped<'_>,
        settings: &ContentSettings,
        raw: &Raw<'_>,
    ) -> Result<(), Error> {
        let input = entry.input;
        let collected = input.collects();
        let spelling = self.spelling(input);
        let origin = self.origin(input);
        let prepare = |pass: &Self, from: &Raw<'_>| {
            let tokens: Vec<String> = match from {
                Raw::One(value) => vec![(*value).to_owned()],
                Raw::Many(values) => values.to_vec(),
                Raw::None => Vec::new(),
            };
            let host = pass.host_for(input);
            prepare_content(
                &tokens,
                settings,
                &ContentScope {
                    host: &host,
                    named: pass.invocation.named.is_some(),
                    collected,
                    cancelled: pass.invocation.cancelled,
                },
            )
        };
        let mut prepared = prepare(self, raw)?;
        if let PreparedContent::Rejected {
            issues,
            missing: false,
        } = &prepared
        {
            let issues = issues.clone();
            if self.drops_fill(entry, &issues, origin.as_deref(), &spelling) {
                // A configuration path its input cannot read falls back, as if no tier had
                // supplied it.
                prepared = prepare(self, &Raw::None)?;
            }
        }
        match prepared {
            PreparedContent::Ready(Prepared::One(content)) => self.set(
                entry,
                content.map_or(RawValue::Absent, |content| RawValue::One(Arc::new(content))),
            ),
            PreparedContent::Ready(Prepared::Many(contents)) => self.set(
                entry,
                RawValue::Many(
                    contents
                        .into_iter()
                        .map(|content| Arc::new(content) as _)
                        .collect(),
                ),
            ),
            PreparedContent::Rejected {
                issues,
                missing: true,
            } => {
                let line = messages(&supplied_name(input, &spelling, None), &issues).join("\n");
                self.omit(entry, spelling, line);
            }
            PreparedContent::Rejected { issues, .. } => {
                let origin = if self.is_dropped(input) { None } else { origin };
                let subject = supplied_name(input, &spelling, origin.as_deref());
                self.reject(entry, issues, &subject);
            }
        }
        Ok(())
    }

    /// One declaration's outcome: what an earlier pass settled, or this pass's own.
    fn settle(&mut self, entry: Scoped<'_>, ledger: &Ledger) -> Result<(), Error> {
        let input = entry.input;
        let identity = entry.identity();
        let invocation = self.invocation;
        if let Some(value) = ledger.value(&identity) {
            // An earlier pass validated this value once, and one value meets its validator once.
            self.values.push((identity, value.clone()));
            return Ok(());
        }
        if let Some(report) = ledger.report(&identity) {
            self.reports.push((identity, report.clone()));
            return Ok(());
        }
        if let Some(issue) = invocation.named.and_then(|unlowered| {
            unlowered
                .iter()
                .find(|(known, _)| *known == identity)
                .map(|(_, issue)| issue)
        }) {
            // A value no token spells supplied nothing, and the caller's value is the problem.
            let subject = supplied_name(input, input.name(), None);
            self.reject(entry, vec![Issue::new(issue.clone())], &subject);
            return Ok(());
        }
        if let Declared::Option(option) = input {
            if let Some(variable) = invocation.sources.rejected_variable(&option.name) {
                // A variable outside its option's grammar filled nothing.
                let subject = supplied_name(input, &self.spelling(input), Some(variable));
                self.reject(entry, vec![grammar_issue(&option.decl)], &subject);
                return Ok(());
            }
            match &option.decl {
                OptionDecl::Boolean(boolean) => {
                    let value = invocation
                        .options
                        .boolean(&option.name)
                        .unwrap_or_else(|| absent_boolean(boolean.polarity));
                    self.set(entry, RawValue::Flag(value));
                    return Ok(());
                }
                OptionDecl::Count(_) => {
                    // A count passes no validator, and no occurrence and no source read 0.
                    let count = invocation.options.count(&option.name).unwrap_or(0);
                    self.set(entry, RawValue::Count(count));
                    return Ok(());
                }
                _ => {}
            }
        }
        let collected = input.collects();
        let spelling = self.spelling(input);
        let raw = match input {
            Declared::Argument(argument) => match lookup(invocation.args, argument.name.as_str()) {
                Some(SuppliedValue::One(value)) => Raw::One(value),
                Some(SuppliedValue::Many(values)) => Raw::Many(values),
                _ => Raw::None,
            },
            Declared::Option(option) if collected => invocation
                .options
                .list(&option.name)
                .map_or(Raw::None, |values| Raw::Many(values)),
            Declared::Option(option) => invocation
                .options
                .string(&option.name)
                .map_or(Raw::None, |value| Raw::One(value)),
        };
        if let Some(settings) = input.content() {
            return self.content(entry, &settings, &raw);
        }
        match raw {
            Raw::None => self.absent(entry, &spelling, false),
            Raw::Many(values) if values.is_empty() && self.requires(input) => {
                // A filled list satisfies the at-least-one rule by its length.
                let origin = self.origin(input);
                let line = missing_message(input, &spelling, collected, origin.as_deref());
                self.omit(entry, spelling, line);
            }
            raw => {
                let origin = self.origin(input);
                self.accept(entry, &raw, origin.as_deref(), &spelling);
            }
        }
        Ok(())
    }
}

/// Validates one invocation in reporting order. A probe of a content source that fails for a
/// reason other than a verdict on the path stops the pass and is the run's failure; what the pass
/// settled before it stays in the ledger.
pub(crate) fn validate_values(
    invocation: &Invocation<'_>,
    ledger: &mut Ledger,
) -> Result<Validation, Error> {
    let declarations = scoped(invocation.globals, invocation.locals);
    let mut pass = Pass {
        invocation,
        supplied: supplied_inputs(&declarations, invocation.args, invocation.options),
        values: Vec::new(),
        reports: Vec::new(),
        dropped: Vec::new(),
    };
    for entry in &declarations {
        if let Some(only) = invocation.only
            && !only.contains(&entry.identity())
        {
            continue;
        }
        if (invocation.cancelled)() {
            // A cancelled run starts no further validator call, and raises nothing collected.
            break;
        }
        if let Err(error) = pass.settle(*entry, ledger) {
            ledger.record(&pass.values, &pass.reports);
            return Err(error);
        }
    }
    ledger.record(&pass.values, &pass.reports);
    let mut stdin = None;
    let mut stdin_report = None;
    if let Some((declared, _)) = invocation.stdin
        && invocation.only.is_none()
    {
        let prepared = prepare_content(
            &[],
            &ContentSettings {
                stdin: true,
                required: declared.required,
                min: None,
                max: None,
            },
            &ContentScope {
                host: invocation.host,
                named: invocation.named.is_some(),
                collected: false,
                cancelled: invocation.cancelled,
            },
        )?;
        match prepared {
            PreparedContent::Rejected { issues, .. } => {
                stdin_report = Some(Report {
                    lines: issues
                        .iter()
                        .map(|issue| messages::stdin_issue(&issue.message))
                        .collect(),
                    problem: InputProblem::Missing {
                        input: InputIdentity {
                            global: false,
                            kind: InputKind::Stdin,
                            name: "stdin".to_owned(),
                        },
                        spelling: "stdin".to_owned(),
                    },
                });
            }
            PreparedContent::Ready(Prepared::One(content)) => stdin = content,
            PreparedContent::Ready(Prepared::Many(_)) => {}
        }
    }
    let mut found = ordered_reports(invocation, &pass.reports, stdin_report);
    // A dropped fill is no value of the option, so no option group counts it.
    let mut group_values = invocation.options.clone();
    for (name, _) in &pass.dropped {
        group_values.withdraw(name);
    }
    let absent = absent_booleans(invocation.locals);
    let spelling = |name: &str| {
        if invocation.named.is_some() {
            name.to_owned()
        } else {
            (invocation.spelling)(name)
        }
    };
    let groups = if invocation.only.is_none() {
        invocation.groups
    } else {
        &[]
    };
    for (lines, problem) in group_reports(&GroupContext {
        absent: &absent,
        groups,
        withdrawn: &invocation.sources.withdrawn,
        values: &group_values,
        spelling: &spelling,
        labels: &invocation.sources.labels,
        unanswered: &invocation.sources.unanswered,
    }) {
        found.push(Report { lines, problem });
    }
    let failure = (!found.is_empty()).then(|| {
        InputError::new(
            found
                .iter()
                .flat_map(|report| report.lines.iter().cloned())
                .collect::<Vec<_>>()
                .join("\n"),
            found.into_iter().map(|report| report.problem).collect(),
        )
    });
    Ok(Validation {
        dropped: pass.dropped,
        stdin,
        failure,
        values: pass.values,
    })
}

/// The reports in reporting order, a standalone stdin's in its authoring position among the
/// routed Command's own inputs.
fn ordered_reports(
    invocation: &Invocation<'_>,
    reports: &[(InputIdentity, Report)],
    stdin: Option<Report>,
) -> Vec<Report> {
    let Some(stdin) = stdin else {
        return reports.iter().map(|(_, report)| report.clone()).collect();
    };
    let position = invocation
        .stdin
        .map_or(invocation.locals.len(), |(_, position)| position);
    let preceding: Vec<InputIdentity> = scoped(
        invocation.globals,
        &invocation.locals[..position.min(invocation.locals.len())],
    )
    .iter()
    .map(Scoped::identity)
    .collect();
    let (before, after): (Vec<_>, Vec<_>) = reports
        .iter()
        .partition(|(identity, _)| preceding.contains(identity));
    before
        .into_iter()
        .map(|(_, report)| report.clone())
        .chain(std::iter::once(stdin))
        .chain(after.into_iter().map(|(_, report)| report.clone()))
        .collect()
}
