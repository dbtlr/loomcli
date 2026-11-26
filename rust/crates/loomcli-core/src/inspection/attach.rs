//! The lifecycle hooks of graph build: every `on_command_attach` hook over each Command, root first
//! and depth first, the rules over what the hooks declared, and every `on_graph_built` judgment of
//! the built graph.

use std::sync::Arc;

use crate::__private::{AttachedState, PluginState};
use crate::application::declaration::ApplicationDeclaration;
use crate::commands::declaration::{
    CommandDeclaration, GlobalTable, InputDeclaration, OptionOwner, check_local_options, local_site,
};
use crate::diagnostics::{DiagnosticParts, DiagnosticRule, Finding, Literal, rules};
use crate::failures::messages::{as_sentence, command_subject, quoted, reason_of};
use crate::failures::{DeclarationError, Error};
use crate::inputs::table::{self, InputSite, Role, ScopeOption, Spelling, spelling_mark};
use crate::plugins::AttachedCommand;
use crate::plugins::extension::DescriptorRegistry;
use crate::plugins::hooks::HookInput;
use crate::plugins::plugin::plugin_receiver;

use super::CommandGraph;
use super::build::result_node;

/// The note beside a finding for an input a plugin's hook declared.
fn declarer_note(identity: &str) -> String {
    format!("declared by plugin {}", quoted(identity))
}

/// The application with every `on_command_attach` hook applied over its Commands, root first and
/// depth first, and the rules over what the hooks declared; the same declaration when no installed
/// plugin attaches a hook.
pub(crate) fn attach_hooks(
    application: &Arc<ApplicationDeclaration>,
) -> Result<Arc<ApplicationDeclaration>, DeclarationError> {
    if !application
        .plugins
        .iter()
        .any(|plugin| plugin.on_command_attach.is_some())
    {
        return Ok(Arc::clone(application));
    }
    let mut declared = ApplicationDeclaration::clone(application);
    let mut root = std::mem::take(&mut declared.root);
    let mut registry = root.descriptors.clone();
    attach_tree(&mut root, &[], &declared, &mut registry)?;
    root.descriptors = registry;
    declared.root = root;
    Ok(Arc::new(declared))
}

/// One Command's hooks, its rules over what they declared, and then each child's, in authoring
/// order.
fn attach_tree(
    command: &mut CommandDeclaration,
    path: &[String],
    application: &ApplicationDeclaration,
    registry: &mut DescriptorRegistry,
) -> Result<(), DeclarationError> {
    let children = std::mem::take(&mut command.children);
    let (mut attached, hooked) = run_hooks(
        std::mem::take(command),
        path,
        &application.plugins,
        registry,
    )?;
    if !hooked.is_empty() {
        check_attached_inputs(&attached, &hooked, path, &application.global_table)?;
        check_hooked_command(&attached, path, &application.global_table)?;
    }
    attached.children = children;
    if !hooked.is_empty() && !path.is_empty() {
        attached.check_finished(path, None)?;
    }
    attached.attached_by = hooked;
    *command = attached;
    for child in &mut command.children {
        let mut child_path = path.to_vec();
        child_path.push(child.name.clone().unwrap_or_default());
        attach_tree(child, &child_path, application, registry)?;
    }
    Ok(())
}

/// Every installed plugin's hook over one Command, in installation order, each editing what the
/// previous left. The descriptors the Command's values registered join the build's registry.
fn run_hooks(
    command: CommandDeclaration,
    path: &[String],
    plugins: &[Arc<PluginState>],
    registry: &mut DescriptorRegistry,
) -> Result<(CommandDeclaration, Vec<HookInput>), DeclarationError> {
    let (record, owners) = command.extensions.publish();
    let result = result_node(&command);
    let mut attached = AttachedCommand {
        inner: Box::new(AttachedState {
            command,
            path: path.to_vec(),
            identity: String::new(),
            hooked: Vec::new(),
            registry: registry.clone(),
            record,
            owners,
            result,
        }),
    };
    for plugin in plugins {
        let Some(hook) = &plugin.on_command_attach else {
            continue;
        };
        attached.inner.identity.clone_from(&plugin.identity);
        if let Err(error) = hook(&mut attached) {
            let subject = command_subject(attached.inner.command.name.as_deref());
            return Err(error
                .into_declaration()
                .unwrap_or_else(|error| broken_attach_hook(&plugin.identity, &subject, error)));
        }
    }
    let state = attached.inner;
    *registry = state.registry;
    Ok((state.command, state.hooked))
}

/// The fault a hook that returned an error other than a `DeclarationError` is.
fn broken_attach_hook(identity: &str, subject: &str, error: Error) -> DeclarationError {
    DeclarationError::new(
        rules::BROKEN_ATTACH_HOOK,
        DiagnosticParts::new(format!(
            "Plugin {} failed in onCommandAttach for {subject}: {}",
            quoted(identity),
            as_sentence(&reason_of(&error))
        ))
        .finding(
            Finding::new(
                format!("{}.on_command_attach", plugin_receiver(identity)),
                vec![Literal::Opaque],
            )
            .mark("0"),
        )
        .correction(
            "Return Ok(()) from on_command_attach, and return a DeclarationError as its Err only to reject the declaration.",
        ),
    )
    .with_cause(error)
}

/// The site of one input a Command holds.
fn input_site(
    command: &CommandDeclaration,
    path: &[String],
    input: &InputDeclaration,
) -> InputSite {
    match input {
        InputDeclaration::Argument(argument) => command.argument_site(path, argument),
        InputDeclaration::Option(option) => local_site(
            command.name.as_deref(),
            path,
            "option",
            &option.name,
            option.decl.literal(),
        ),
    }
}

/// What one hook-declared name collides with: the clause naming the holder, the kind of input
/// that holds it, the remedy, and the finding for the declaration that holds it.
struct Collision {
    clause: String,
    argument: bool,
    remedy: &'static str,
    held: Finding,
}

/// The rule one name collision breaks: two options or two arguments break the rule the
/// application's own collision of that pair breaks, and an argument and an option under one name
/// break `name-shared-across-kinds`, which only a hook reaches.
fn collision_rule(declared_argument: bool, held_argument: bool) -> DiagnosticRule {
    match (declared_argument, held_argument) {
        (false, false) => rules::OPTION_DECLARED_TWICE,
        (true, true) => rules::ARGUMENT_DECLARED_TWICE,
        _ => rules::NAME_SHARED_ACROSS_KINDS,
    }
}

/// One spelling the scope already holds: the form its option is named by, and the place that
/// declared it.
struct Claimed {
    spelling: String,
    form: String,
    finding: Option<Finding>,
}

/// The spellings one compiled table holds, each with its option's long form, or the spelling itself
/// where the option declares none.
fn claim_spellings(
    claimed: &mut Vec<Claimed>,
    compiled: &[(String, Spelling)],
    place: impl Fn(&str, Role) -> Option<Finding>,
) {
    for (spelling, entry) in compiled {
        if claimed.iter().any(|known| &known.spelling == spelling) {
            continue;
        }
        let form = compiled
            .iter()
            .find(|(_, other)| other.name == entry.name && other.role == Role::Long)
            .map_or_else(|| spelling.clone(), |(long, _)| long.clone());
        claimed.push(Claimed {
            spelling: spelling.clone(),
            form,
            finding: place(&entry.name, entry.role),
        });
    }
}

/// Every input a hook declared, against the names and spellings the Command, the global table, and
/// an earlier hook already hold, before the Command's own inputs compile, so a hook-declared input
/// reports as the plugin's fault and never as the author's. A collision carries a finding for the
/// hook's input and one for the declaration that already holds the name or spelling.
fn check_attached_inputs(
    command: &CommandDeclaration,
    hooked: &[HookInput],
    path: &[String],
    globals: &GlobalTable,
) -> Result<(), DeclarationError> {
    let subject = command_subject(command.name.as_deref());
    // The hook inputs sit after the author's, in the order the hooks declared them.
    let first_hooked = command.inputs.len() - hooked.len();
    let (authored, attached) = command.inputs.split_at(first_hooked);
    let mut claimed: Vec<Claimed> = Vec::new();
    claim_spellings(&mut claimed, &globals.table, |name, role| {
        let entry = globals.entry(name)?;
        let note = match &entry.owner {
            OptionOwner::Plugin(identity) => format!("an option of plugin {}", quoted(identity)),
            OptionOwner::Application => format!("the global option {}", quoted(name)),
        };
        Some(entry.site.finding(&spelling_mark(role)).note(note))
    });
    let locals: Vec<(String, InputSite, &crate::inputs::OptionDecl)> = authored
        .iter()
        .filter_map(|input| match input {
            InputDeclaration::Option(option) => Some((
                option.name.clone(),
                input_site(command, path, input),
                &option.decl,
            )),
            InputDeclaration::Argument(_) => None,
        })
        .collect();
    let scope: Vec<ScopeOption<'_>> = locals
        .iter()
        .map(|(name, site, decl)| ScopeOption {
            name,
            decl,
            site: site.clone(),
        })
        .collect();
    if let Ok(compiled) = table::compile(&scope, &subject) {
        claim_spellings(&mut claimed, &compiled, |name, role| {
            let (_, site, _) = locals.iter().find(|(known, _, _)| known == name)?;
            Some(
                site.finding(&spelling_mark(role))
                    .note(format!("the local option {}", quoted(name))),
            )
        });
    }
    let authored: Vec<&InputDeclaration> = authored.iter().collect();
    for (index, (entry, input)) in hooked.iter().zip(attached).enumerate() {
        let site = input_site(command, path, input);
        let note = declarer_note(&entry.identity);
        if let Some(collision) =
            collision_of(entry, (&hooked[..index], &attached[..index]), command, path)
                .or_else(|| authored_collision(entry, command, path, globals, &authored))
        {
            let kind = if entry.argument { "argument" } else { "option" };
            return Err(DeclarationError::new(
                collision_rule(entry.argument, collision.argument),
                DiagnosticParts::new(format!(
                    "Plugin {} declares {kind} {} on {subject}, which is already declared as {}.",
                    quoted(&entry.identity),
                    quoted(&entry.name),
                    collision.clause
                ))
                .finding(site.named(Some(&note)))
                .finding(collision.held)
                .correction(collision.remedy),
            ));
        }
        let InputDeclaration::Option(option) = input else {
            continue;
        };
        let own = [ScopeOption {
            name: &option.name,
            decl: &option.decl,
            site: site.clone(),
        }];
        let compiled = table::compile(&own, &subject)?;
        for (spelling, spelled) in &compiled {
            if let Some(used) = claimed.iter().find(|known| &known.spelling == spelling) {
                let mut parts = DiagnosticParts::new(format!(
                    "Plugin {} declares option {} with spelling {} on {subject}, which {} already uses.",
                    quoted(&entry.identity),
                    quoted(&option.name),
                    quoted(spelling),
                    quoted(&used.form)
                ))
                .finding(site.finding(&spelling_mark(spelled.role)).note(note.clone()));
                if let Some(finding) = &used.finding {
                    parts = parts.finding(finding.clone());
                }
                return Err(DeclarationError::new(
                    rules::SPELLING_TAKEN,
                    parts.correction("Change one of the two spellings or omit the plugin."),
                ));
            }
        }
        claim_spellings(&mut claimed, &compiled, |_, role| {
            Some(site.finding(&spelling_mark(role)).note(note.clone()))
        });
    }
    Ok(())
}

/// A collision with an input an earlier hook declared on the Command.
fn collision_of(
    entry: &HookInput,
    earlier: (&[HookInput], &[InputDeclaration]),
    command: &CommandDeclaration,
    path: &[String],
) -> Option<Collision> {
    let (hooked, inputs) = earlier;
    let position = hooked
        .iter()
        .position(|known| known.name == entry.name && !known.argument)
        .or_else(|| hooked.iter().position(|known| known.name == entry.name))?;
    let (held, input) = (hooked.get(position)?, inputs.get(position)?);
    let kind = if held.argument { "argument" } else { "option" };
    Some(Collision {
        clause: format!(
            "an {kind} plugin {} declared through onCommandAttach",
            quoted(&held.identity)
        ),
        argument: held.argument,
        remedy: "Install one of them.",
        held: input_site(command, path, input).named(Some(&declarer_note(&held.identity))),
    })
}

/// A collision with what the Command's author, the global table, or another plugin's options hold:
/// a local option, then a global or plugin option, then an argument.
fn authored_collision(
    entry: &HookInput,
    command: &CommandDeclaration,
    path: &[String],
    globals: &GlobalTable,
    authored: &[&InputDeclaration],
) -> Option<Collision> {
    let named = |argument: bool| {
        authored.iter().copied().find(|input| match input {
            InputDeclaration::Argument(held) => argument && held.name == entry.name,
            InputDeclaration::Option(held) => !argument && held.name == entry.name,
        })
    };
    if let Some(local) = named(false) {
        return Some(Collision {
            clause: "a local option".to_owned(),
            argument: false,
            remedy: "Rename the Command's option or omit the plugin.",
            held: input_site(command, path, local).named(Some("the local option")),
        });
    }
    if let Some(global) = globals.entry(&entry.name) {
        return Some(match &global.owner {
            OptionOwner::Plugin(identity) => {
                let clause = format!("an option of plugin {}", quoted(identity));
                Collision {
                    held: global.site.named(Some(&clause)),
                    clause,
                    argument: false,
                    remedy: "Install one of them.",
                }
            }
            OptionOwner::Application => Collision {
                clause: "a global option".to_owned(),
                argument: false,
                remedy: "Rename the global option or omit the plugin.",
                held: global.site.named(Some("the global option")),
            },
        });
    }
    let argument = named(true)?;
    Some(Collision {
        clause: "an argument".to_owned(),
        argument: true,
        remedy: "Rename the Command's argument or omit the plugin.",
        held: input_site(command, path, argument).named(Some("the argument")),
    })
}

/// The rules a hook's inputs meet with the Command's own once every hook has run: one stdin target,
/// the argument order, and the Command's options against the global
/// table, each variable bound once included.
fn check_hooked_command(
    command: &CommandDeclaration,
    path: &[String],
    globals: &GlobalTable,
) -> Result<(), DeclarationError> {
    command.check_stdin_claims(path, None)?;
    let subject = command_subject(command.name.as_deref());
    let arguments: Vec<_> = command.arguments().collect();
    let mut variadic = None;
    for pair in arguments.windows(2) {
        let [previous, next] = pair else {
            continue;
        };
        if previous.decl.variadic() {
            variadic = Some(*previous);
        }
        command.check_slot_order(
            previous,
            variadic,
            (&next.name, &next.decl, &command.argument_site(path, next)),
            path,
        )?;
    }
    check_local_options(&command.scope_options(path), globals, &subject).map(|_| ())
}

/// Every installed plugin's `on_graph_built` judgment of one built graph, in installation order.
/// Each judgment is handed to `fault`, which ends the build for a run and `inspect()` by returning
/// it and keeps it for `check()` by returning `Ok`, so every hook runs there.
pub(crate) fn judge_graph(
    graph: &CommandGraph,
    plugins: &[Arc<PluginState>],
    fault: &mut dyn FnMut(DeclarationError) -> Result<(), DeclarationError>,
) -> Result<(), DeclarationError> {
    for plugin in plugins {
        let Some(hook) = &plugin.on_graph_built else {
            continue;
        };
        if let Err(error) = hook(graph) {
            let judged = error
                .into_declaration()
                .unwrap_or_else(|error| broken_graph_hook(&plugin.identity, error));
            fault(judged)?;
        }
    }
    Ok(())
}

/// The fault a graph hook that returned an error other than a `DeclarationError` is.
fn broken_graph_hook(identity: &str, error: Error) -> DeclarationError {
    DeclarationError::new(
        rules::BROKEN_GRAPH_HOOK,
        DiagnosticParts::new(format!(
            "Plugin {} failed in onGraphBuilt: {}",
            quoted(identity),
            as_sentence(&reason_of(&error))
        ))
        .finding(
            Finding::new(
                format!("{}.on_graph_built", plugin_receiver(identity)),
                vec![Literal::Opaque],
            )
            .mark("0"),
        )
        .correction(
            "Return Ok(()) from on_graph_built, and return a DeclarationError as its Err only to reject the graph.",
        ),
    )
    .with_cause(error)
}
