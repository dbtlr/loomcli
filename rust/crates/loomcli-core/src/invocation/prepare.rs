//! The phases between parsing and the dispatch boundary: the input-source stage, the interaction
//! decision, and validation, which prepare one dispatch and hold whatever fault they find.
//!
//! This is the reference's `prepareDispatch`. The phases run in order: the structural fault parsing
//! held, a group's missing subcommand, the input-source stage, and validation. Either of the first
//! two outranks a configuration source's fault, and a source's fault takes the place of every
//! validation problem. Validation checks the global options whatever was held.

use std::sync::Arc;

use crate::__private::{RawValue, RunState};
use crate::application::declaration::ApplicationDeclaration;
use crate::commands::declaration::{CommandDeclaration, InputDeclaration, OptionInput};
use crate::failures::{Error, NonCallableCommandError};
use crate::host::Host;
use crate::inputs::declared::DeclaredValues;
use crate::inputs::interaction::interaction_decision;
use crate::inputs::pass::{
    Invocation, Ledger, Provenance, Validation, absent_boolean, scoped, supplied_inputs,
    validate_values,
};
use crate::inputs::sources::{SourceCall, StageFacts, StageScope, fill_inputs};
use crate::inputs::{Content, InputIdentity, InputKind, InputValues, OptionDecl, SuppliedInputs};
use crate::inspection::{CommandGraph, OptionNode, reported_spelling};
use crate::output::emit::{Lane, Stream};

use crate::plugins::Request;

use super::chain::{Dispatch, OwnValues};
use super::parse::{OptionValues, ParsedInvocation, candidates_of};
use super::{InvokedBy, RunInputs};

/// One prepared dispatch: what the dispatch boundary does, and what the chain ahead of it reads.
pub(crate) struct Prepared {
    pub(crate) boundary: Boundary,
    pub(crate) chain: ChainFacts,
}

/// What the dispatch boundary does: raise the fault the preparation held, or dispatch the action.
pub(crate) enum Boundary {
    Held(Error),
    Ready(Box<Dispatch>),
}

/// What the middleware chain reads of one preparation: the global options' values after the
/// input-source stage, less each fill validation dropped, which activation and the spellings read; every global option's validated
/// value unless a global option faulted or a source failed; the values each validation pass
/// settled, which a plugin's own record reads; and the routed request on a clean preparation.
pub(crate) struct ChainFacts {
    pub(crate) globals: OptionValues,
    pub(crate) options: Option<InputValues>,
    pub(crate) own: OwnValues,
    pub(crate) request: Option<Request>,
}

/// What a clean preparation hands the dispatch boundary.
pub(crate) struct Ready {
    pub(crate) values: RunInputs,
    pub(crate) supplied: SuppliedInputs,
    pub(crate) stdin: Option<Content>,
    pub(crate) interactive: bool,
}

/// What one preparation reads beside the parsed invocation.
pub(crate) struct Run<'a> {
    pub(crate) application: &'a ApplicationDeclaration,
    pub(crate) graph: &'a Arc<CommandGraph>,
    pub(crate) host: &'a Arc<Host>,
    pub(crate) state: &'a Arc<RunState>,
    pub(crate) declared: &'a DeclaredValues,
    pub(crate) invoked_by: InvokedBy,
    pub(crate) cancelled: &'a (dyn Fn() -> bool + Sync),
}

/// The routed Command's node in the run's graph.
fn routed_node<'g>(
    graph: &'g CommandGraph,
    path: &[String],
) -> Option<&'g Arc<crate::inspection::CommandNode>> {
    let words: Vec<&str> = path.iter().map(String::as_str).collect();
    graph.command(&words)
}

/// The node of one option in the run's graph: a global option, or the routed Command's own.
fn option_node<'g>(
    graph: &'g CommandGraph,
    path: &[String],
    name: &str,
    global: bool,
) -> Option<&'g Arc<OptionNode>> {
    let options = if global {
        &graph.globals
    } else {
        &routed_node(graph, path)?.options
    };
    options.iter().find(|option| option.name() == name)
}

/// The value the interaction mark reads: the marked global option's final value, else none.
fn marked_value(globals: &[OptionInput], values: &OptionValues) -> Option<bool> {
    globals.iter().find_map(|option| match &option.decl {
        OptionDecl::Boolean(boolean) if boolean.interaction => Some(
            values
                .boolean(&option.name)
                .unwrap_or_else(|| absent_boolean(boolean.polarity)),
        ),
        _ => None,
    })
}

/// The table of one scope's validated values, keyed by declared name.
fn scope_values(
    values: &[(InputIdentity, RawValue)],
    global: bool,
    stdin: Option<Content>,
) -> InputValues {
    values
        .iter()
        .filter(|(identity, _)| identity.global == global)
        .fold(
            InputValues::new(),
            |table, (identity, value)| match identity.kind {
                InputKind::Argument => table.with_raw_argument(&identity.name, value.clone()),
                _ => table.with_raw_option(&identity.name, value.clone()),
            },
        )
        .with_stdin(stdin)
}

/// Prepares one dispatch: fills the inputs, decides interaction, and validates, holding whatever
/// fault it finds for the dispatch boundary.
pub(crate) async fn prepare_dispatch(run: &Run<'_>, mut parsed: ParsedInvocation<'_>) -> Prepared {
    let routed = parsed.command;
    let declaration: Option<&CommandDeclaration> = run.application.root.at(&parsed.path);
    // The held structural fault, then the callable check: a group holds its missing subcommand.
    let local_fault: Option<Error> = parsed.fault.take().or_else(|| {
        routed.action.is_none().then(|| {
            NonCallableCommandError::new(parsed.path.clone(), candidates_of(routed)).into()
        })
    });
    let local = declaration.filter(|_| local_fault.is_none());
    let excluded = &parsed.excluded;
    let in_scope = |option: &&OptionInput| !excluded.contains(&option.name);
    let mut globals = StageScope {
        global: true,
        options: run.application.globals.iter().filter(in_scope).collect(),
        values: parsed.values.globals.clone(),
    };
    let mut locals = local.map(|declaration| StageScope {
        global: false,
        options: declaration.options().filter(in_scope).collect(),
        values: parsed.values.locals.clone(),
    });
    let local_inputs: &[InputDeclaration] = local.map_or(&[], |declaration| &declaration.inputs);
    let groups = local.map_or(&[][..], |declaration| &declaration.groups);
    let passthrough: &[String] = if local.is_some() {
        &parsed.passthrough
    } else {
        &[]
    };
    let args: &[(String, crate::inputs::SuppliedValue)] =
        if local.is_some() { &parsed.args } else { &[] };
    let spelling = |name: &str| {
        [true, false]
            .into_iter()
            .find_map(|global| option_node(run.graph, &parsed.path, name, global))
            .map_or_else(|| format!("--{name}"), |node| reported_spelling(node))
    };
    let named = (run.invoked_by == InvokedBy::Name).then_some(parsed.unlowered.as_slice());
    let mut ledger = Ledger::default();
    let request = |name: &str, global: bool| {
        option_node(run.graph, &parsed.path, name, global).map(|node| OptionNode::clone(node))
    };
    let call = |options: InputValues, requests: Vec<OptionNode>| SourceCall {
        options,
        requests,
        host: Arc::clone(run.host),
        graph: Arc::clone(run.graph),
        invoked_by: run.invoked_by,
        run: Arc::clone(run.state),
    };
    let translations: Vec<crate::failures::Translation> =
        run.application.translations().cloned().collect();
    let facts = StageFacts {
        host: run.host,
        groups,
        source: run.application.source.as_ref(),
        request: &request,
        call: &call,
        cancelled: run.cancelled,
        translations: &translations,
    };
    let outcome = {
        let ledger = &mut ledger;
        let validate_own = |own: &[InputIdentity],
                            sources: &Provenance,
                            global_values: &OptionValues,
                            local_values: Option<&OptionValues>| {
            let options = OptionValues::merged(
                global_values,
                local_values.unwrap_or(&OptionValues::default()),
            );
            validate_values(
                &Invocation {
                    globals: &run.application.globals,
                    locals: local_inputs,
                    groups,
                    stdin: None,
                    // A plugin's own options are global, and a global option has no presence rule.
                    interactive: false,
                    command: &parsed.path,
                    declared: run.declared,
                    host: run.host,
                    named,
                    passthrough,
                    only: Some(own),
                    sources,
                    args,
                    options: &options,
                    spelling: &spelling,
                    cancelled: run.cancelled,
                },
                ledger,
            )
        };
        fill_inputs(&mut globals, locals.as_mut(), &facts, validate_own).await
    };
    let interactive = run.invoked_by == InvokedBy::Argv
        && interaction_decision(
            run.host,
            marked_value(&run.application.globals, &globals.values),
        );
    let mut own_run = OwnRun {
        run,
        parsed: &parsed,
        declaration,
        globals: globals.values.clone(),
        interactive,
        named,
        spelling: &spelling,
    };
    if let Some(fault) = outcome.fault {
        return own_run.held(local_fault.unwrap_or(fault), None, ledger);
    }
    let sources = outcome.provenance;
    let options = OptionValues::merged(
        &globals.values,
        locals
            .as_ref()
            .map_or(&OptionValues::default(), |locals| &locals.values),
    );
    let validation: Validation = match validate_values(
        &Invocation {
            globals: &run.application.globals,
            locals: local_inputs,
            groups,
            stdin: local.and_then(|declaration| {
                declaration
                    .stdin
                    .as_ref()
                    .map(|stdin| (stdin, declaration.stdin_position))
            }),
            interactive,
            command: &parsed.path,
            declared: run.declared,
            host: run.host,
            named,
            passthrough,
            only: None,
            sources: &sources,
            args,
            options: &options,
            spelling: &spelling,
            cancelled: run.cancelled,
        },
        &mut ledger,
    ) {
        Ok(validation) => validation,
        Err(error) => return own_run.held(local_fault.unwrap_or(error), None, ledger),
    };
    // A fill validation dropped reads as unfilled, so it activates no middleware, and its line goes
    // through the run's debug lane, ahead of any held fault, so it shows from -v.
    for (name, line) in &validation.dropped {
        own_run.globals.withdraw(name);
        if let Err(error) = run
            .state
            .output
            .emit(Lane::Debug, line, Stream::Stderr)
            .await
        {
            return own_run.held(error, None, ledger);
        }
    }
    // A middleware never reads a global value no validator accepted.
    let global_options = (!parsed.global_fault && !validation.rejects_global())
        .then(|| scope_values(&validation.values, true, None));
    if let Some(fault) = local_fault {
        return own_run.held(fault, global_options, ledger);
    }
    if let Some(failure) = validation.failure {
        return own_run.held(failure.into(), global_options, ledger);
    }
    // The supplied record keeps every value a source filled, so it is taken before a drop.
    let supplied = supplied_inputs(
        &scoped(&run.application.globals, local_inputs),
        args,
        &options,
    );
    let values = RunInputs {
        locals: scope_values(&validation.values, false, validation.stdin.clone()),
        globals: scope_values(&validation.values, true, None),
        invoked_by: run.invoked_by,
    };
    let request = Request {
        values: values.locals.clone(),
        passthrough: parsed.passthrough.clone(),
        stdin: validation.stdin.clone(),
    };
    let chain = ChainFacts {
        globals: own_run.globals,
        options: Some(values.globals.clone()),
        own: OwnValues {
            values: ledger.into_values(),
            faulted: parsed.faulted.clone(),
        },
        request: Some(request),
    };
    let dispatch = Dispatch {
        action: routed.action.clone(),
        path: parsed.path.clone(),
        node: Arc::clone(&routed.node),
        ready: Ready {
            values,
            supplied,
            stdin: validation.stdin,
            interactive,
        },
        passthrough: parsed.passthrough.clone(),
        uses: declaration.map_or_else(Vec::new, |declaration| declaration.uses.clone()),
        typed_stdin: declaration.is_some_and(|declaration| declaration.typed_stdin),
        result: declaration.and_then(CommandDeclaration::result),
    };
    Prepared {
        boundary: Boundary::Ready(Box::new(dispatch)),
        chain,
    }
}

/// What the pass over the plugins' own options under a held fault reads.
struct OwnRun<'r, 'a, 'p> {
    run: &'r Run<'a>,
    parsed: &'r ParsedInvocation<'p>,
    declaration: Option<&'r CommandDeclaration>,
    /// The global options' values after the input-source stage, less each fill validation dropped.
    globals: OptionValues,
    interactive: bool,
    named: Option<&'r [(InputIdentity, String)]>,
    spelling: &'r (dyn Fn(&str) -> String + Sync),
}

impl OwnRun<'_, '_, '_> {
    /// The preparation that holds `fault`, after core validated the plugins' own options the fault
    /// left unvalidated, for their records alone.
    fn held(&self, fault: Error, options: Option<InputValues>, mut ledger: Ledger) -> Prepared {
        self.validate_own(&mut ledger);
        Prepared {
            boundary: Boundary::Held(fault),
            chain: ChainFacts {
                globals: self.globals.clone(),
                options,
                own: OwnValues {
                    values: ledger.into_values(),
                    faulted: self.parsed.faulted.clone(),
                },
                request: None,
            },
        }
    }

    /// The pass over the options a held fault left unvalidated: each plugin's global options and
    /// each local option a hook declared on the routed Command, whose tokens parsed, none of whose
    /// occurrences faulted, and that no earlier pass reached. A group validates no local option.
    /// The held fault stays the one raised, so whatever the validators answer reports nothing.
    fn validate_own(&self, ledger: &mut Ledger) {
        let parsed = self.parsed;
        let unreached = |global: bool, name: &str, supplied: &OptionValues| {
            supplied.is_supplied(name)
                && !parsed.faulted.iter().any(|known| known == name)
                && !ledger.reached(&InputIdentity::new(global, InputKind::Option, name))
        };
        let globals = self
            .run
            .application
            .plugins
            .iter()
            .flat_map(|plugin| plugin.options.iter())
            .filter(|option| unreached(true, &option.name, &parsed.values.globals))
            .map(|option| InputIdentity::new(true, InputKind::Option, option.name.clone()));
        let local = self.declaration.filter(|_| parsed.command.action.is_some());
        let attached = local
            .map(|declaration| declaration.attached_by.as_slice())
            .unwrap_or_default()
            .iter()
            .filter(|input| !input.argument && unreached(false, &input.name, &parsed.values.locals))
            .map(|input| InputIdentity::new(false, InputKind::Option, input.name.clone()));
        let only: Vec<InputIdentity> = globals.chain(attached).collect();
        if only.is_empty() {
            return;
        }
        let options = OptionValues::merged(&self.globals, &parsed.values.locals);
        let sources = Provenance::default();
        // The held fault is the one raised, so this pass's own verdicts report nothing.
        let _ = validate_values(
            &Invocation {
                globals: &self.run.application.globals,
                locals: local.map_or(&[], |declaration| &declaration.inputs),
                groups: &[],
                stdin: None,
                interactive: self.interactive,
                command: &parsed.path,
                declared: self.run.declared,
                host: self.run.host,
                named: self.named,
                passthrough: &[],
                only: Some(&only),
                sources: &sources,
                args: &parsed.args,
                options: &options,
                spelling: self.spelling,
                cancelled: self.run.cancelled,
            },
            ledger,
        );
    }
}
