//! A Command's collected declarations, and the rules each declaring call and each attach applies.
//!
//! A Command is a value its builder moves from call to call, so each rule here checks first and
//! changes the declaration only once every check passed: a call that faults changes nothing. A
//! Command does not know where it will attach, so a call-time finding's path is the Command's own
//! name, and an attach-time one the path below the parent it joins.

use std::any::Any;
use std::sync::Arc;

use crate::diagnostics::{DiagnosticParts, Finding, Literal, rules};
use crate::failures::messages::{command_sentence, command_subject, quoted};
use crate::failures::{DeclarationError, FailureFacts};
use crate::inputs::table::{
    self, BoundVariable, InputSite, OptionOrigin, ScopeOption, Table, check_option_config,
    check_option_name,
};
use crate::inputs::{ArgumentDecl, DeclarationCall, OptionDecl, Stdin};
use crate::inspection::{OptionGroup, OptionGroupKind};
use crate::invocation::Outcome;
use crate::plugins::extension::{
    DescriptorRegistry, ExtensionSite, ExtensionStore, ExtensionSubject, admit_descriptor,
    validate_layer, values_literal,
};
use crate::plugins::{AnyProvider, CommandTarget, ExtensionValue, OptionTarget};
use crate::support::{BoxFuture, is_declared_name, is_portable_name};

use super::{Passthrough, messages};

/// The correction every portable-name fault gives.
pub(crate) const PORTABLE_NAME_CORRECTION: &str = "Use a nonempty name of A-Z, a-z, 0-9, \".\", \"_\", and \"-\" that does not start with \"-\" or \".\".";

fn alias_finding(alias: &str, visible: bool) -> Finding {
    let call = if visible { "visible_alias" } else { "alias" };
    Finding::new(call, vec![alias.into()]).mark("0")
}

/// Panics with a fault's whole Developer Diagnostic, at the author's line: the Rust form of the
/// reference's throw while the module evaluates.
#[track_caller]
pub(crate) fn raise<T>(result: Result<T, DeclarationError>) -> T {
    match result {
        Ok(value) => value,
        Err(fault) => panic!("{}", fault.message()),
    }
}

/// An action with its inputs and result types erased: it extracts the inputs struct from the
/// validated values, builds the typed context, and calls the author's handler.
pub(crate) type ErasedAction =
    Arc<dyn Fn(crate::__private::ActionCall) -> BoxFuture<'static, Outcome> + Send + Sync>;

/// One declared option with the extension values it carries.
#[derive(Clone)]
pub(crate) struct OptionInput {
    pub(crate) origin: OptionOrigin,
    pub(crate) name: String,
    pub(crate) decl: OptionDecl,
    pub(crate) extensions: ExtensionStore,
}

impl OptionInput {
    pub(crate) fn site(&self, command: Option<&str>, path: &[String]) -> InputSite {
        option_site(command, path, &self.name, &self.decl, self.origin)
    }
}

/// One declared argument with the extension values it carries.
#[derive(Clone)]
pub(crate) struct ArgumentInput {
    pub(crate) name: String,
    pub(crate) decl: ArgumentDecl,
    pub(crate) extensions: ExtensionStore,
}

/// An input in authoring order.
#[derive(Clone)]
pub(crate) enum InputDeclaration {
    Argument(ArgumentInput),
    Option(OptionInput),
}

/// One result call: the declaring `result()` or `rows()`, or a later `views()`.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResultCallKind {
    Value,
    Rows,
    Views,
}

/// One named view a result call lists, with its media type and the view itself, type erased.
#[derive(Clone)]
pub(crate) struct ViewEntry {
    pub(crate) key: String,
    pub(crate) media_type: Option<String>,
    pub(crate) view: Arc<dyn Any + Send + Sync>,
}

/// One call on a declaration's result.
#[derive(Clone)]
pub(crate) struct ResultCall {
    pub(crate) kind: ResultCallKind,
    pub(crate) entries: Vec<ViewEntry>,
    pub(crate) default: Option<String>,
}

/// The finished result: every call read as one declaration. A later call replaces a key in place
/// and appends a new one, a default once named persists, and the first key answers until one is.
#[derive(Clone)]
pub(crate) struct DeclaredResult {
    pub(crate) kind: ResultCallKind,
    pub(crate) views: Vec<ViewEntry>,
    pub(crate) default: String,
}

/// A Command's collected declarations.
#[derive(Clone, Default)]
pub(crate) struct CommandDeclaration {
    pub(crate) name: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) hidden: bool,
    pub(crate) deprecated: Option<String>,
    pub(crate) aliases: Vec<String>,
    pub(crate) visible_aliases: Vec<String>,
    pub(crate) inputs: Vec<InputDeclaration>,
    pub(crate) stdin: Option<Stdin>,
    pub(crate) passthrough: Option<Passthrough>,
    pub(crate) needs_terminal: bool,
    /// How many inputs the Command declared before `stdin()`, which places the standalone stdin's
    /// validation problem among the input problems in authoring order.
    pub(crate) stdin_position: usize,
    /// Whether an inputs struct declared the standalone stdin, so a typed field reads it and
    /// `ctx.stdin` is `None`.
    pub(crate) typed_stdin: bool,
    pub(crate) groups: Vec<OptionGroup>,
    pub(crate) children: Vec<CommandDeclaration>,
    pub(crate) action: Option<ErasedAction>,
    pub(crate) results: Vec<ResultCall>,
    pub(crate) extensions: ExtensionStore,
    pub(crate) descriptors: DescriptorRegistry,
    pub(crate) uses: Vec<AnyProvider>,
    /// Each input a lifecycle hook declared on this Command, with the plugin whose hook declared
    /// it, which that plugin's middleware reads under `own_options`.
    pub(crate) attached_by: Vec<crate::plugins::hooks::HookInput>,
}

/// Who declared one option of the global table: the application, or an installed plugin.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum OptionOwner {
    Application,
    Plugin(String),
}

impl OptionOwner {
    /// The note beside the finding of an option this owner declared.
    pub(crate) fn note(&self) -> &'static str {
        match self {
            OptionOwner::Application => "the global option",
            OptionOwner::Plugin(_) => "the plugin's global option",
        }
    }

    /// How a spelling collision names an option this owner declared.
    pub(crate) fn used_by(&self, name: &str) -> String {
        match self {
            OptionOwner::Application => format!("the global option {}", quoted(name)),
            OptionOwner::Plugin(identity) => {
                format!("plugin {} option {}", quoted(identity), quoted(name))
            }
        }
    }
}

/// One option the global table holds: its name, where it was declared, and who declared it.
#[derive(Clone)]
pub(crate) struct TableName {
    pub(crate) name: String,
    pub(crate) site: InputSite,
    pub(crate) owner: OptionOwner,
}

/// The global options a local option must stay apart from: their names, their spellings, and the
/// variables they bind. It holds the application's global options and every installed plugin's.
#[derive(Clone, Default)]
pub(crate) struct GlobalTable {
    pub(crate) names: Vec<TableName>,
    pub(crate) table: Table,
    pub(crate) variables: Vec<BoundVariable>,
}

impl Clone for BoundVariable {
    fn clone(&self) -> Self {
        Self {
            variable: self.variable.clone(),
            phrase: self.phrase.clone(),
            site: self.site.clone(),
        }
    }
}

impl GlobalTable {
    /// The table's entry for the option `name`.
    pub(crate) fn entry(&self, name: &str) -> Option<&TableName> {
        self.names.iter().find(|entry| entry.name == name)
    }
}

/// The site of a local input on the Command at `path`.
pub(crate) fn local_site(
    command: Option<&str>,
    path: &[String],
    call: &'static str,
    name: &str,
    config: Literal,
) -> InputSite {
    let kind = if call == "argument" {
        "argument"
    } else {
        "option"
    };
    InputSite {
        call,
        receiver: None,
        path: path.to_vec(),
        name: name.to_owned(),
        origin: Default::default(),
        config,
        subject: format!("{} {kind} {}", command_sentence(command), quoted(name)),
    }
}

/// The Command's own path when nothing above it is known.
fn own_path(name: Option<&str>) -> Vec<String> {
    name.map_or_else(Vec::new, |name| vec![name.to_owned()])
}

fn option_site(
    command: Option<&str>,
    path: &[String],
    name: &str,
    decl: &OptionDecl,
    origin: OptionOrigin,
) -> InputSite {
    let mut site = local_site(command, path, "option", name, decl.literal());
    site.origin = origin;
    if origin == OptionOrigin::Set {
        site.subject = format!("An option set option {}", quoted(name));
    }
    site
}

/// Validates one input's extension values as one layer.
pub(crate) fn input_extensions<T>(
    values: &[ExtensionValue<T>],
    registry: &mut DescriptorRegistry,
    site: &InputSite,
    setter_index: &str,
    subject: ExtensionSubject,
) -> Result<ExtensionStore, DeclarationError> {
    let mut store = ExtensionStore::default();
    if values.is_empty() {
        return Ok(store);
    }
    let call = if site.origin == OptionOrigin::Direct {
        Finding::new(
            site.call,
            vec![site.name.as_str().into(), site.config.clone()],
        )
        .path(site.path.clone())
    } else {
        site.finding(setter_index)
    };
    let place = ExtensionSite {
        call,
        at: site.mark_path(setter_index),
    };
    store.extend(validate_layer(values, registry, &place, &subject)?);
    Ok(store)
}

/// Checks a local option scope against the global options: keys first, then the scope's own
/// compiled table, then each spelling, then each variable.
pub(crate) fn check_local_options(
    options: &[ScopeOption<'_>],
    globals: &GlobalTable,
    subject: &str,
) -> Result<Table, DeclarationError> {
    for option in options {
        if let Some(entry) = globals.entry(option.name) {
            let declared = match &entry.owner {
                OptionOwner::Application => "as a global option".to_owned(),
                OptionOwner::Plugin(identity) => format!("by plugin {}", quoted(identity)),
            };
            return Err(DeclarationError::new(
                rules::OPTION_DECLARED_TWICE,
                DiagnosticParts::new(format!(
                    "Option {} is declared {declared} and as a local option on {subject}.",
                    quoted(option.name)
                ))
                .finding(entry.site.named(Some(entry.owner.note())))
                .finding(option.site.named(Some("the local option")))
                .correction("Rename the local option."),
            ));
        }
    }
    let compiled = table::compile(options, subject)?;
    for (spelling, entry) in &compiled {
        let Some(global) = table::lookup(&globals.table, spelling) else {
            continue;
        };
        let (Some(claimed), Some(option)) = (
            globals.entry(&global.name),
            options.iter().find(|option| option.name == entry.name),
        ) else {
            continue;
        };
        return Err(DeclarationError::new(
            rules::SPELLING_TAKEN,
            DiagnosticParts::new(format!(
                "Option spelling {} is used by {} and the local option {} on {subject}.",
                quoted(spelling),
                claimed.owner.used_by(&global.name),
                quoted(&entry.name)
            ))
            .finding(
                claimed
                    .site
                    .finding(&table::spelling_mark(global.role))
                    .note(claimed.owner.note()),
            )
            .finding(
                option
                    .site
                    .finding(&table::spelling_mark(entry.role))
                    .note("the local option"),
            )
            .correction("Change one declaration."),
        ));
    }
    let bound = table::bound_variables(options, |option| {
        format!("{subject} option {}", quoted(option.name))
    });
    table::claim_variables(&globals.variables, bound)?;
    Ok(compiled)
}

impl CommandDeclaration {
    /// A named Command's declaration, after the portable-name rule.
    pub(crate) fn named(name: &str) -> Result<Self, DeclarationError> {
        if !is_portable_name(name) {
            return Err(DeclarationError::new(
                rules::PORTABLE_NAME,
                DiagnosticParts::new(format!("Command name {} is invalid.", quoted(name)))
                    .finding(Finding::new("Command::new", vec![name.into()]).mark("0"))
                    .correction(PORTABLE_NAME_CORRECTION),
            ));
        }
        Ok(Self {
            name: Some(name.to_owned()),
            ..Self::default()
        })
    }

    /// The local options, in declaration order.
    pub(crate) fn options(&self) -> impl Iterator<Item = &OptionInput> {
        self.inputs.iter().filter_map(|input| match input {
            InputDeclaration::Option(option) => Some(option),
            InputDeclaration::Argument(_) => None,
        })
    }

    /// The arguments, in declaration order.
    pub(crate) fn arguments(&self) -> impl Iterator<Item = &ArgumentInput> {
        self.inputs.iter().filter_map(|input| match input {
            InputDeclaration::Argument(argument) => Some(argument),
            InputDeclaration::Option(_) => None,
        })
    }

    /// The local options as one scope at `path`.
    pub(crate) fn scope_options<'a>(&'a self, path: &[String]) -> Vec<ScopeOption<'a>> {
        self.options()
            .map(|option| ScopeOption {
                name: &option.name,
                decl: &option.decl,
                site: option.site(self.name.as_deref(), path),
            })
            .collect()
    }

    pub(crate) fn argument_site(&self, path: &[String], argument: &ArgumentInput) -> InputSite {
        local_site(
            self.name.as_deref(),
            path,
            "argument",
            &argument.name,
            argument.decl.literal(),
        )
    }

    /// The finding that places a child under this Command.
    fn placement(path: &[String], child: &str) -> Finding {
        Finding::new(
            "command",
            vec![Literal::builder(format!("Command::new({})", quoted(child)))],
        )
        .path(path.to_vec())
        .mark("0")
    }

    /// The local option table, compiled with no global option beside it.
    pub(crate) fn local_table(&self, path: &[String]) -> Result<Table, DeclarationError> {
        table::compile(
            &self.scope_options(path),
            &command_subject(self.name.as_deref()),
        )
    }

    /// Declares one portable alias or makes an earlier declaration of that alias visible.
    pub(crate) fn declare_alias(
        &mut self,
        alias: &str,
        visible: bool,
    ) -> Result<(), DeclarationError> {
        if !is_portable_name(alias) {
            return Err(DeclarationError::new(
                rules::PORTABLE_NAME,
                DiagnosticParts::new(messages::invalid_alias(self.name.as_deref(), alias))
                    .finding(alias_finding(alias, visible).path(own_path(self.name.as_deref())))
                    .correction(PORTABLE_NAME_CORRECTION),
            ));
        }
        if self.name.as_deref() == Some(alias) {
            return Ok(());
        }
        if !self.aliases.iter().any(|known| known == alias) {
            self.aliases.push(alias.to_owned());
        }
        if visible && !self.visible_aliases.iter().any(|known| known == alias) {
            self.visible_aliases.push(alias.to_owned());
        }
        Ok(())
    }

    /// Checks the name, argument order, builder facts, and stdin claim before declaring an argument.
    pub(crate) fn declare_argument(
        &mut self,
        name: &str,
        decl: ArgumentDecl,
    ) -> Result<(), DeclarationError> {
        let path = own_path(self.name.as_deref());
        let command = self.name.as_deref();
        let subject = command_subject(command);
        let site = local_site(command, &path, "argument", name, decl.literal());
        if !is_declared_name(name) {
            return Err(DeclarationError::new(
                rules::DECLARED_NAME,
                DiagnosticParts::new(format!(
                    "{} declares an argument named {}.",
                    command_sentence(command),
                    quoted(name)
                ))
                .finding(site.unread().named(None))
                .correction(table::DECLARED_NAME_CORRECTION),
            ));
        }
        if let Some((setter, reason)) = decl.config_conflict() {
            return Err(DeclarationError::new(
                rules::OPTION_CONFIG,
                DiagnosticParts::new(format!("Argument {} {reason}.", quoted(name)))
                    .finding(site.finding(&format!("1.{setter}")))
                    .correction("Remove the setter the argument kind or its other facts exclude."),
            ));
        }
        if let Some(first) = self.arguments().find(|argument| argument.name == name) {
            return Err(DeclarationError::new(
                rules::ARGUMENT_DECLARED_TWICE,
                DiagnosticParts::new(format!(
                    "Argument {} is declared more than once on {subject}.",
                    quoted(name)
                ))
                .finding(
                    self.argument_site(&path, first)
                        .named(Some("the first declaration")),
                )
                .finding(site.named(Some("the second declaration")))
                .correction("Remove or rename the duplicate."),
            ));
        }
        if let Some(previous) = self.arguments().last() {
            self.check_slot_order(
                previous,
                self.arguments().find(|argument| argument.decl.variadic()),
                (name, &decl, &site),
                &path,
            )?;
        }
        if decl.claims_stdin() {
            self.check_stdin_claims(&path, Some(&site))?;
        }
        // The extension values answer last, as the reference records the input after its rules.
        let mut registry = self.descriptors.clone();
        let extensions = input_extensions(
            decl.extensions(),
            &mut registry,
            &site,
            "1.extend.0",
            ExtensionSubject {
                phrase: format!("on {subject} argument {}", quoted(name)),
                sentence: format!("{} argument {}", command_sentence(command), quoted(name)),
            },
        )?;
        let input = ArgumentInput {
            name: name.to_owned(),
            decl,
            extensions,
        };
        self.descriptors = registry;
        self.inputs.push(InputDeclaration::Argument(input));
        Ok(())
    }

    /// Rejects a second stdin target: the claims the inputs already hold and the standalone
    /// declaration, with the new claim's site when it is an input.
    pub(crate) fn check_stdin_claims(
        &self,
        path: &[String],
        claim: Option<&InputSite>,
    ) -> Result<(), DeclarationError> {
        let mut claimed: Vec<InputSite> = Vec::new();
        for input in &self.inputs {
            match input {
                InputDeclaration::Option(option) if option.decl.claims_stdin() => {
                    claimed.push(option.site(self.name.as_deref(), path));
                }
                InputDeclaration::Argument(argument) if argument.decl.claims_stdin() => {
                    claimed.push(self.argument_site(path, argument));
                }
                _ => {}
            }
        }
        claimed.extend(claim.cloned());
        if claimed.len() + usize::from(self.stdin.is_some()) <= 1 {
            return Ok(());
        }
        let in_set = claim.is_some_and(|site| site.origin == OptionOrigin::Set);
        let (sentence, correction) = if in_set {
            (
                "An option set declares more than one stdin target.",
                "Keep one stdin target in the set.",
            )
        } else {
            (
                "A Command declares more than one stdin target.",
                "Keep one stdin target on the Command.",
            )
        };
        let mut parts = DiagnosticParts::new(sentence);
        for site in &claimed {
            parts = parts.finding(site.named(Some("claims stdin")));
        }
        if let Some(stdin) = &self.stdin {
            parts = parts.finding(
                Finding::new("stdin", vec![stdin.literal()])
                    .path(path.to_vec())
                    .mark("0"),
            );
        }
        Err(DeclarationError::new(
            rules::STDIN_CLAIMED_TWICE,
            parts.correction(correction),
        ))
    }

    /// `option(name, config)` against the global options a root-local option must stay apart
    /// from, or none for a named Command, which meets them when it joins an Application.
    pub(crate) fn declare_option(
        &mut self,
        name: &str,
        decl: OptionDecl,
        globals: &GlobalTable,
    ) -> Result<(), DeclarationError> {
        self.declare_option_in(name, decl, globals, OptionOrigin::Direct)
    }

    /// Uses the ordinary local option rules for entries declared in or applied from a set.
    pub(super) fn declare_option_in(
        &mut self,
        name: &str,
        decl: OptionDecl,
        globals: &GlobalTable,
        origin: OptionOrigin,
    ) -> Result<(), DeclarationError> {
        let path = own_path(self.name.as_deref());
        let command = self.name.as_deref();
        let subject = if origin == OptionOrigin::Set {
            "an option set".to_owned()
        } else {
            command_subject(command)
        };
        let site = option_site(command, &path, name, &decl, origin);
        check_option_name(name, &site)?;
        let mut registry = self.descriptors.clone();
        let extensions = input_extensions(
            &decl.facts().extensions,
            &mut registry,
            &site,
            "1.extend.0",
            ExtensionSubject {
                phrase: format!("on {subject} option {}", quoted(name)),
                sentence: site.subject.clone(),
            },
        )?;
        let candidate = OptionInput {
            origin,
            name: name.to_owned(),
            decl,
            extensions,
        };
        {
            let mut scope = self.scope_options(&path);
            scope.push(ScopeOption {
                name: &candidate.name,
                decl: &candidate.decl,
                site: site.clone(),
            });
            // A key a global option holds reports before the builder's own faults.
            if globals.entry(name).is_some() {
                check_local_options(&scope, globals, &subject)?;
            }
            if let Some(option) = scope.last() {
                check_option_config(option, false)?;
            }
            check_local_options(&scope, globals, &subject)?;
        }
        if candidate.decl.claims_stdin() {
            self.check_stdin_claims(&path, Some(&site))?;
        }
        self.descriptors = registry;
        self.inputs.push(InputDeclaration::Option(candidate));
        Ok(())
    }

    /// `stdin(config)`: one standalone declaration, and no input that already claims stdin.
    pub(crate) fn declare_stdin(&mut self, stdin: Stdin) -> Result<(), DeclarationError> {
        let path = own_path(self.name.as_deref());
        if self.stdin.is_some() {
            return Err(DeclarationError::new(
                rules::STDIN_CLAIMED_TWICE,
                DiagnosticParts::new("A Command declares stdin twice.")
                    .finding(
                        Finding::new("stdin", vec![stdin.literal()])
                            .path(path)
                            .mark("0"),
                    )
                    .correction("Keep one stdin declaration."),
            ));
        }
        let mut declared = self.clone_shallow();
        declared.stdin = Some(stdin.clone());
        declared.check_stdin_claims(&path, None)?;
        self.stdin = Some(stdin);
        self.stdin_position = self.inputs.len();
        Ok(())
    }

    /// Declares the passthrough mode once.
    pub(crate) fn declare_passthrough(
        &mut self,
        mode: Passthrough,
    ) -> Result<(), DeclarationError> {
        if self.passthrough.is_some() {
            return Err(DeclarationError::new(
                rules::PASSTHROUGH_DECLARED_TWICE,
                DiagnosticParts::new(messages::PASSTHROUGH_DECLARED_TWICE)
                    .finding(
                        Finding::new("passthrough", vec![mode.literal()])
                            .path(own_path(self.name.as_deref()))
                            .mark("0"),
                    )
                    .correction("Keep one passthrough declaration."),
            ));
        }
        self.passthrough = Some(mode);
        Ok(())
    }

    /// Declares the terminal need once.
    pub(crate) fn declare_terminal_need(&mut self) -> Result<(), DeclarationError> {
        if self.needs_terminal {
            return Err(DeclarationError::new(
                rules::TERMINAL_NEED_DECLARED_TWICE,
                DiagnosticParts::new(messages::TERMINAL_NEED_DECLARED_TWICE)
                    .finding(
                        Finding::new("needs_terminal", vec![]).path(own_path(self.name.as_deref())),
                    )
                    .correction("Keep one needs_terminal() declaration."),
            ));
        }
        self.needs_terminal = true;
        Ok(())
    }

    /// The declaration without its children, for a check that reads the inputs alone.
    fn clone_shallow(&self) -> Self {
        Self {
            name: self.name.clone(),
            inputs: self.inputs.clone(),
            stdin: self.stdin.clone(),
            stdin_position: self.stdin_position,
            ..Self::default()
        }
    }

    /// An option group over already-declared local options.
    pub(crate) fn declare_group(
        &mut self,
        kind: OptionGroupKind,
        names: &[&str],
    ) -> Result<(), DeclarationError> {
        self.declare_group_in(kind, names, false)
    }

    /// Group calls on Commands and option sets share the same checks.
    pub(super) fn declare_group_in(
        &mut self,
        kind: OptionGroupKind,
        names: &[&str],
        in_set: bool,
    ) -> Result<(), DeclarationError> {
        let (call, word) = match kind {
            OptionGroupKind::Exclusive => ("exclusive", "exclusive"),
            OptionGroupKind::OneRequired => ("one_required", "oneRequired"),
            OptionGroupKind::RequiredTogether => ("required_together", "requiredTogether"),
            OptionGroupKind::Requires => ("requires", "requires"),
        };
        let arguments = if let (OptionGroupKind::Requires, Some((option, needed))) =
            (kind, names.split_first())
        {
            vec![
                (*option).into(),
                Literal::Slice(needed.iter().map(|name| (*name).into()).collect()),
            ]
        } else {
            vec![Literal::List(
                names.iter().map(|name| (*name).into()).collect(),
            )]
        };
        let (subject, finding) = if in_set {
            (
                "An option set".to_owned(),
                Finding::new(format!("OptionSet::new().{call}"), arguments),
            )
        } else {
            (
                command_sentence(self.name.as_deref()),
                Finding::new(call, arguments).path(own_path(self.name.as_deref())),
            )
        };
        let fail = |sentence: String, correction: &str| {
            DeclarationError::new(
                rules::OPTION_GROUP,
                DiagnosticParts::new(sentence)
                    .finding(finding.clone())
                    .correction(correction),
            )
        };
        let Some((first, rest)) = names.split_first().filter(|(_, rest)| !rest.is_empty()) else {
            return Err(fail(
                format!("{subject} declares {word} with fewer than two options."),
                "Name at least two local options.",
            ));
        };
        let mut seen: Vec<&str> = Vec::new();
        for (index, member) in names.iter().enumerate() {
            if kind == OptionGroupKind::Requires && index > 0 && member == first {
                return Err(fail(
                    format!(
                        "{subject} requires names option {} as its own requirement.",
                        quoted(member)
                    ),
                    "Name only other local options after the first.",
                ));
            }
            if seen.contains(member) {
                return Err(fail(
                    format!("{subject} {word} repeats option {}.", quoted(member)),
                    "Name each option once.",
                ));
            }
            seen.push(member);
            if !self.options().any(|option| option.name == *member) {
                return Err(fail(
                    format!(
                        "{subject} {word} names undeclared local option {}.",
                        quoted(member)
                    ),
                    "Declare the local option before naming it in a group.",
                ));
            }
        }
        let members = || names.iter().map(|name| (*name).to_owned()).collect();
        let group = match kind {
            OptionGroupKind::Exclusive => OptionGroup::Exclusive { options: members() },
            OptionGroupKind::OneRequired => OptionGroup::OneRequired { options: members() },
            OptionGroupKind::RequiredTogether => {
                OptionGroup::RequiredTogether { options: members() }
            }
            OptionGroupKind::Requires => OptionGroup::Requires {
                option: (*first).to_owned(),
                requires: rest.iter().map(|name| (*name).to_owned()).collect(),
            },
        };
        let asks_together = |group: &OptionGroup| {
            matches!(
                group,
                OptionGroup::RequiredTogether { .. } | OptionGroup::Requires { .. }
            )
        };
        let exclusive: Vec<&OptionGroup> = if kind == OptionGroupKind::Exclusive {
            vec![&group]
        } else {
            self.groups
                .iter()
                .filter(|each| matches!(each, OptionGroup::Exclusive { .. }))
                .collect()
        };
        let together: Vec<&OptionGroup> = if asks_together(&group) {
            vec![&group]
        } else {
            self.groups
                .iter()
                .filter(|group| asks_together(group))
                .collect()
        };
        for rule in exclusive {
            if let Some(required) = self.options().find(|option| {
                rule.members().any(|name| name == option.name) && option.decl.requires_presence()
            }) {
                return Err(fail(
                    format!(
                        "{subject} exclusive group contains required option {}.",
                        quoted(&required.name)
                    ),
                    "Remove the presence requirement or remove the exclusive group.",
                ));
            }
            if let Some(other) = together.iter().find(|other| {
                other
                    .members()
                    .filter(|name| rule.members().any(|member| member == *name))
                    .take(2)
                    .count()
                    == 2
            }) {
                let conflict = match other {
                    OptionGroup::Requires { .. } => "requires",
                    _ => "requiredTogether",
                };
                return Err(fail(
                    format!(
                        "{subject} exclusive and {conflict} groups share at least two options."
                    ),
                    "Remove one of the conflicting group rules.",
                ));
            }
        }
        self.groups.push(group);
        Ok(())
    }

    /// `extend(values)`: one layer, judged against the descriptors the Command already admitted.
    pub(crate) fn extend(
        &mut self,
        values: &[ExtensionValue<CommandTarget>],
    ) -> Result<(), DeclarationError> {
        let mut registry = self.descriptors.clone();
        let site = ExtensionSite {
            call: Finding::new("extend", vec![values_literal(values.len())])
                .path(own_path(self.name.as_deref())),
            at: "0".to_owned(),
        };
        let subject = ExtensionSubject {
            phrase: format!("on {}", command_subject(self.name.as_deref())),
            sentence: command_sentence(self.name.as_deref()),
        };
        let layer = validate_layer(values, &mut registry, &site, &subject)?;
        self.descriptors = registry;
        self.extensions.extend(layer);
        Ok(())
    }

    /// Applies an inputs struct's collected calls through this declaration's own calls.
    pub(crate) fn declare_all(
        &mut self,
        calls: Vec<DeclarationCall>,
        globals: &GlobalTable,
    ) -> Result<(), DeclarationError> {
        for call in calls {
            match call {
                DeclarationCall::Argument(name, decl) => self.declare_argument(&name, decl)?,
                DeclarationCall::Option(name, decl) => self.declare_option(&name, decl, globals)?,
                DeclarationCall::Options(set) => set.apply(self, globals)?,
                DeclarationCall::Stdin(stdin) => {
                    self.declare_stdin(stdin)?;
                    self.typed_stdin = true;
                }
                DeclarationCall::Passthrough(mode) => self.declare_passthrough(mode)?,
                DeclarationCall::Group(kind, names) => {
                    let names: Vec<&str> = names.iter().map(String::as_str).collect();
                    self.declare_group(kind, &names)?;
                }
            }
        }
        Ok(())
    }

    /// The finished-Command rules attach applies to a child and build to the root: a Command with
    /// no action holds children and leaves action-specific declarations off.
    pub(crate) fn check_finished(
        &self,
        path: &[String],
        placement: Option<Finding>,
    ) -> Result<(), DeclarationError> {
        if self.action.is_some() {
            return Ok(());
        }
        let sentence = command_sentence(self.name.as_deref());
        if self.children.is_empty() {
            let mut parts = DiagnosticParts::new(format!("{sentence} has no action."));
            if let Some(placement) = placement {
                parts = parts.finding(placement.note("no action and no children"));
            }
            return Err(DeclarationError::new(
                rules::COMMAND_WITHOUT_ACTION,
                parts.correction("Register an action."),
            ));
        }
        if let Some(argument) = self.arguments().next() {
            return Err(DeclarationError::new(
                rules::COMMAND_WITHOUT_ACTION,
                DiagnosticParts::new(messages::arguments_without_action(self.name.as_deref()))
                    .finding(self.argument_site(path, argument).named(Some("the first argument")))
                    .correction("Declare the arguments on the Command that reads them, or register an action."),
            ));
        }
        if let Some(mode) = &self.passthrough {
            return Err(DeclarationError::new(
                rules::COMMAND_WITHOUT_ACTION,
                DiagnosticParts::new(messages::passthrough_without_action(self.name.as_deref()))
                    .finding(
                        Finding::new("passthrough", vec![mode.literal()])
                            .path(path.to_vec())
                            .mark("0"),
                    )
                    .correction(
                        "Declare passthrough on the Command that reads it, or register an action.",
                    ),
            ));
        }
        if let Some(stdin) = &self.stdin {
            return Err(DeclarationError::new(
                rules::COMMAND_WITHOUT_ACTION,
                DiagnosticParts::new(format!(
                    "{sentence} declares stdin but registers no action to receive it."
                ))
                .finding(
                    Finding::new("stdin", vec![stdin.literal()])
                        .path(path.to_vec())
                        .mark("0"),
                )
                .correction("Declare stdin on the Command that reads it, or register an action."),
            ));
        }
        if self.needs_terminal {
            return Err(DeclarationError::new(
                rules::COMMAND_WITHOUT_ACTION,
                DiagnosticParts::new(messages::terminal_need_without_action(self.name.as_deref()))
                    .finding(Finding::new("needs_terminal", vec![]).path(path.to_vec()))
                    .correction("Declare needs_terminal() on the Command whose action needs it, or register an action."),
            ));
        }
        Ok(())
    }

    /// `command(child)`: the child is finished, with a name and aliases no sibling holds.
    pub(crate) fn attach(&mut self, child: CommandDeclaration) -> Result<(), DeclarationError> {
        self.check_attach(&child)?;
        self.children.push(child);
        Ok(())
    }

    /// The attach rules, judged before anything changes.
    pub(crate) fn check_attach(&self, child: &CommandDeclaration) -> Result<(), DeclarationError> {
        let path = own_path(self.name.as_deref());
        let child_name = child.name.clone().unwrap_or_default();
        let mut child_path = path.clone();
        child_path.push(child_name.clone());
        child.check_finished(&child_path, Some(Self::placement(&path, &child_name)))?;
        self.check_sibling(&path, child)
    }

    /// Rejects a child whose name or alias a sibling already holds. The checks run in the
    /// reference's order: a twin name among all children, then each alias of the child against a
    /// sibling's name and then a sibling's alias, then the child's name against a sibling's alias.
    fn check_sibling(
        &self,
        path: &[String],
        child: &CommandDeclaration,
    ) -> Result<(), DeclarationError> {
        let sentence = command_sentence(self.name.as_deref());
        let name = child.name.as_deref().unwrap_or_default();
        let name_of = |command: &CommandDeclaration| command.name.clone().unwrap_or_default();
        let fault = |text: String, findings: [Finding; 2]| {
            let parts = findings
                .into_iter()
                .fold(DiagnosticParts::new(text), DiagnosticParts::finding);
            DeclarationError::new(
                rules::SIBLING_NAME_TAKEN,
                parts.correction("Rename or remove one."),
            )
        };
        let child_finding = |command: &CommandDeclaration| {
            let command_name = name_of(command);
            Self::placement(path, &command_name).note(format!("child {}", quoted(&command_name)))
        };
        let aliased = |command: &CommandDeclaration, alias: &str| {
            let command_name = name_of(command);
            let mut child_path = path.to_vec();
            child_path.push(command_name.clone());
            let visible = command.visible_aliases.iter().any(|name| name == alias);
            alias_finding(alias, visible)
                .path(child_path)
                .note(format!("alias of child {}", quoted(&command_name)))
        };
        if let Some(twin) = self.children.iter().find(|entry| name_of(entry) == name) {
            return Err(fault(
                format!("{sentence} attaches two children named {}.", quoted(name)),
                [child_finding(twin), child_finding(child)],
            ));
        }
        for alias in &child.aliases {
            if let Some(holder) = self.children.iter().find(|entry| &name_of(entry) == alias) {
                return Err(fault(
                    messages::alias_hits_sibling_name(&sentence, name, alias),
                    [child_finding(holder), aliased(child, alias)],
                ));
            }
            if let Some(owner) = self
                .children
                .iter()
                .find(|entry| entry.aliases.contains(alias))
            {
                return Err(fault(
                    messages::alias_hits_sibling_alias(&sentence, name, alias, &name_of(owner)),
                    [aliased(owner, alias), aliased(child, alias)],
                ));
            }
        }
        if let Some(owner) = self
            .children
            .iter()
            .find(|entry| entry.aliases.iter().any(|alias| alias == name))
        {
            return Err(fault(
                messages::alias_hits_sibling_name(&sentence, &name_of(owner), name),
                [aliased(owner, name), child_finding(child)],
            ));
        }
        Ok(())
    }

    /// Checks this Command's local options, and every Command below it, against the global
    /// options, with `path` the route from the root.
    pub(crate) fn check_against_globals(
        &self,
        path: &[String],
        globals: &GlobalTable,
    ) -> Result<(), DeclarationError> {
        check_local_options(
            &self.scope_options(path),
            globals,
            &command_subject(self.name.as_deref()),
        )?;
        for child in &self.children {
            let mut child_path = path.to_vec();
            child_path.push(child.name.clone().unwrap_or_default());
            child.check_against_globals(&child_path, globals)?;
        }
        Ok(())
    }

    /// Joins this Command and the Commands below it to an Application, depth first: each node
    /// admits its descriptors into `registry`, then its local options meet the global options,
    /// with `path` the route from the root.
    pub(crate) fn join(
        &self,
        path: &[String],
        globals: &GlobalTable,
        registry: &mut DescriptorRegistry,
    ) -> Result<(), DeclarationError> {
        for descriptor in self.extensions.descriptors() {
            admit_descriptor(registry, descriptor, None)?;
        }
        for input in &self.inputs {
            let store = match input {
                InputDeclaration::Argument(argument) => &argument.extensions,
                InputDeclaration::Option(option) => &option.extensions,
            };
            for descriptor in store.descriptors() {
                admit_descriptor(registry, descriptor, None)?;
            }
        }
        check_local_options(
            &self.scope_options(path),
            globals,
            &command_subject(self.name.as_deref()),
        )?;
        for child in &self.children {
            let mut child_path = path.to_vec();
            child_path.push(child.name.clone().unwrap_or_default());
            child.join(&child_path, globals, registry)?;
        }
        Ok(())
    }

    /// The finished result, or `None` when no call declared one.
    pub(crate) fn result(&self) -> Option<DeclaredResult> {
        let declaration = self
            .results
            .iter()
            .find(|call| call.kind != ResultCallKind::Views)?;
        let mut views: Vec<ViewEntry> = Vec::new();
        let mut selected: Option<String> = None;
        for call in &self.results {
            for entry in &call.entries {
                match views.iter_mut().find(|known| known.key == entry.key) {
                    Some(known) => *known = entry.clone(),
                    None => views.push(entry.clone()),
                }
            }
            if let Some(default) = &call.default {
                selected = Some(default.clone());
            }
        }
        let fallback = views
            .first()
            .map(|entry| entry.key.clone())
            .unwrap_or_default();
        Some(DeclaredResult {
            kind: declaration.kind,
            views,
            default: selected.unwrap_or(fallback),
        })
    }
}

impl CommandDeclaration {
    /// Checks argument ordering, including the required scalar suffix after a variadic.
    pub(crate) fn check_slot_order(
        &self,
        previous: &ArgumentInput,
        variadic: Option<&ArgumentInput>,
        next: (&str, &ArgumentDecl, &InputSite),
        path: &[String],
    ) -> Result<(), DeclarationError> {
        let (name, decl, site) = next;
        if let Some(variadic) = variadic {
            let reason = if matches!(decl, ArgumentDecl::Content(_)) {
                "is a content argument"
            } else if decl.variadic() {
                "is variadic"
            } else if decl.non_interactive() {
                "is required only when input is not interactive"
            } else if !decl.required() {
                "is optional"
            } else {
                return Ok(());
            };
            return Err(DeclarationError::new(
                rules::ARGUMENT_AFTER_VARIADIC,
                DiagnosticParts::new(messages::argument_after_variadic(
                    name,
                    reason,
                    &variadic.name,
                    self.name.as_deref(),
                ))
                .finding(
                    self.argument_site(path, variadic)
                        .named(Some("the variadic argument")),
                )
                .finding(site.named(Some("the argument after it")))
                .correction("Declare only required scalar arguments after a variadic argument."),
            ));
        }
        let subject = command_subject(self.name.as_deref());
        let slot = previous;
        let slot_site = self.argument_site(path, previous);
        let after = site.named(Some("the argument after it"));
        let needs_value = decl.ordered_required();
        if slot.decl.non_interactive() && needs_value {
            return Err(DeclarationError::new(
            rules::OPTIONAL_ARGUMENT_LAST,
            DiagnosticParts::new(format!(
                "Argument {} is required only when input is not interactive and precedes required argument {} on {subject}.",
                quoted(&slot.name),
                quoted(name)
            ))
            .finding(slot_site.named(Some("the conditionally required argument")))
            .finding(after)
            .correction(
                "Declare arguments required only when input is not interactive after required ones.",
            ),
        ));
        }
        if !slot.decl.required()
            && !slot.decl.non_interactive()
            && (needs_value || decl.non_interactive())
        {
            return Err(DeclarationError::new(
                rules::OPTIONAL_ARGUMENT_LAST,
                DiagnosticParts::new(format!(
                    "Argument {} is optional and precedes required argument {} on {subject}.",
                    quoted(&slot.name),
                    quoted(name)
                ))
                .finding(slot_site.named(Some("the optional argument")))
                .finding(after)
                .correction("Declare optional arguments after required ones."),
            ));
        }
        Ok(())
    }
}

/// Validates an option or argument's own values into its store: used where a declaration other
/// than a Command's call carries them, such as a global option.
pub(crate) fn option_extensions(
    decl: &OptionDecl,
    registry: &mut DescriptorRegistry,
    site: &InputSite,
    subject: ExtensionSubject,
) -> Result<ExtensionStore, DeclarationError> {
    input_extensions::<OptionTarget>(
        &decl.facts().extensions,
        registry,
        site,
        "1.extend.0",
        subject,
    )
}

#[cfg(test)]
mod tests {
    use crate::{Command, Opt, Stdin};

    #[test]
    fn a_standalone_stdin_records_how_many_inputs_came_before_it() {
        let command = Command::new("read")
            .option("first", Opt::string())
            .option("second", Opt::string())
            .stdin(Stdin::new())
            .option("third", Opt::string());
        assert_eq!(command.declaration.stdin_position, 2);
    }
}
