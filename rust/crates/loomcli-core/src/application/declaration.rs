//! An Application's collected declarations: the root Command, the global options and their table,
//! and the facts and contributions only the root has.

use std::sync::Arc;

use crate::__private::PluginState;
use crate::commands::declaration::{
    CommandDeclaration, GlobalTable, OptionInput, OptionOwner, PORTABLE_NAME_CORRECTION, TableName,
    option_extensions,
};
use crate::diagnostics::{DiagnosticParts, DiagnosticRule, Finding, Literal, rules};
use crate::failures::messages::{mid_sentence, quoted};
use crate::failures::{DeclarationError, FailureEncoding, Translation};
use crate::inputs::OptionDecl;
use crate::inputs::table::{
    self, InputSite, ScopeOption, Spelling, check_option_config, check_option_name, spelling_mark,
};
use crate::output::{ViewContribution, ViewOverride};
use crate::plugins::extension::{ExtensionSubject, admit_descriptor};
use crate::plugins::plugin::{plugin_option_site, plugin_receiver, plugin_sentence};
use crate::style::RenderingPolicy;
use crate::support::is_portable_name;

/// The shutdown budget an application that sets none gets, in milliseconds.
pub(crate) const DEFAULT_SHUTDOWN_TIMEOUT: u32 = 500;

/// The longest shutdown budget, the largest delay a timer takes.
const LONGEST_SHUTDOWN_TIMEOUT: u32 = 2_147_483_647;

/// An Application's collected declarations.
#[derive(Clone)]
pub(crate) struct ApplicationDeclaration {
    pub(crate) name: String,
    pub(crate) version: Option<String>,
    pub(crate) description: Option<String>,
    pub(crate) root: CommandDeclaration,
    /// The application's own global options, in authoring order.
    pub(crate) own_globals: Vec<OptionInput>,
    /// Every global option: the application's own, then each installed plugin's in installation
    /// order, the order the input-source stage fills them, validation checks them, and `inspect()`
    /// lists them.
    pub(crate) globals: Vec<OptionInput>,
    pub(crate) global_table: GlobalTable,
    /// The installed plugins, in installation order.
    pub(crate) plugins: Vec<Arc<PluginState>>,
    pub(crate) overrides: Vec<ViewOverride>,
    pub(crate) translators: Vec<Translation>,
    pub(crate) shutdown_timeout: u32,
    pub(crate) rendering: RenderingPolicy,
    /// The configuration source the one claiming plugin installed.
    pub(crate) source: Option<crate::inputs::sources::SourceSlot>,
    /// The configuration schema the claiming plugin's source publishes on the graph.
    pub(crate) configuration: Option<crate::inspection::InputSchema>,
    /// The installed `on_log` hooks, in installation order.
    pub(crate) log_hooks: Vec<crate::output::LogHook>,
}

/// The site of a global option the application declares.
pub(crate) fn global_site(name: &str, decl: &OptionDecl) -> InputSite {
    InputSite {
        call: "global_option",
        receiver: None,
        path: Vec::new(),
        name: name.to_owned(),
        config: decl.literal(),
        subject: format!("Global option {}", quoted(name)),
    }
}

/// The run-wide marks, each with the rule a second marked option breaks.
const MARKS: [(&str, DiagnosticRule); 5] = [
    ("interaction", rules::INTERACTION_MARK),
    ("color", rules::COLOR_MARK),
    ("verbose", rules::VERBOSE_MARK),
    ("quiet", rules::QUIET_MARK),
    ("background", rules::BACKGROUND_MARK),
];

/// One side of a collision inside the global table: the option's name, its owner, and its site.
struct Side<'a> {
    name: &'a str,
    owner: &'a OptionOwner,
    site: &'a InputSite,
}

/// The two sides of a collision in the order its sentence names them: a plugin first, then the
/// application; two plugins in installation order, which is the order the table met them.
fn ordered<'a>(claimed: Side<'a>, joining: Side<'a>) -> (Side<'a>, Side<'a>) {
    match (claimed.owner, joining.owner) {
        (OptionOwner::Application, OptionOwner::Plugin(_)) => (joining, claimed),
        _ => (claimed, joining),
    }
}

/// How one owner reads in a key collision; a repeated preposition is dropped after the first.
fn declared_by(owner: &OptionOwner, leading: bool) -> String {
    match owner {
        OptionOwner::Plugin(identity) => format!(
            "{}plugin {}",
            if leading { "by " } else { "" },
            quoted(identity)
        ),
        OptionOwner::Application => "as a global option".to_owned(),
    }
}

/// One key the table already holds, claimed again by a plugin's option.
fn key_collision(claimed: Side<'_>, joining: Side<'_>) -> DeclarationError {
    let (leading, trailing) = ordered(claimed, joining);
    let plugins = matches!(leading.owner, OptionOwner::Plugin(_))
        && matches!(trailing.owner, OptionOwner::Plugin(_));
    DeclarationError::new(
        rules::OPTION_DECLARED_TWICE,
        DiagnosticParts::new(format!(
            "Option {} is declared {} and {}.",
            quoted(leading.name),
            declared_by(leading.owner, true),
            declared_by(trailing.owner, false)
        ))
        .finding(leading.site.named(Some(leading.owner.note())))
        .finding(trailing.site.named(Some(trailing.owner.note())))
        .correction(if plugins {
            "Install one of them or rename the option."
        } else {
            "Rename one declaration."
        }),
    )
}

/// One spelling the table already holds, claimed again by a plugin's option.
fn spelling_collision(
    spelling: &str,
    claimed: (Side<'_>, &Spelling),
    joining: (Side<'_>, &Spelling),
) -> DeclarationError {
    let claimed_role = claimed.1.role;
    let joining_role = joining.1.role;
    let swapped = matches!(
        (claimed.0.owner, joining.0.owner),
        (OptionOwner::Application, OptionOwner::Plugin(_))
    );
    let (leading, trailing) = ordered(claimed.0, joining.0);
    let (leading_role, trailing_role) = if swapped {
        (joining_role, claimed_role)
    } else {
        (claimed_role, joining_role)
    };
    DeclarationError::new(
        rules::SPELLING_TAKEN,
        DiagnosticParts::new(format!(
            "Option spelling {} is used by {} and {}.",
            quoted(spelling),
            leading.owner.used_by(leading.name),
            trailing.owner.used_by(trailing.name)
        ))
        .finding(
            leading
                .site
                .finding(&spelling_mark(leading_role))
                .note(leading.owner.note()),
        )
        .finding(
            trailing
                .site
                .finding(&spelling_mark(trailing_role))
                .note(trailing.owner.note()),
        )
        .correction("Change one declaration."),
    )
}

/// Compiles the global options into the table every local option stays apart from: the
/// application's own in authoring order, then each installed plugin's in installation order. Every
/// collision between two scopes, by key or by spelling, is reported here, then one option per
/// run-wide mark, then each variable once.
pub(crate) fn global_table(
    own: &[OptionInput],
    plugins: &[Arc<PluginState>],
) -> Result<GlobalTable, DeclarationError> {
    let application: Vec<ScopeOption<'_>> = own
        .iter()
        .map(|option| ScopeOption {
            name: &option.name,
            decl: &option.decl,
            site: global_site(&option.name, &option.decl),
        })
        .collect();
    let mut compiled = table::compile(&application, "the global options")?;
    let mut names: Vec<TableName> = application
        .iter()
        .map(|option| TableName {
            name: option.name.to_owned(),
            site: option.site.clone(),
            owner: OptionOwner::Application,
        })
        .collect();
    let mut scope: Vec<ScopeOption<'_>> = application;
    for plugin in plugins {
        let owner = OptionOwner::Plugin(plugin.identity.clone());
        let joining: Vec<ScopeOption<'_>> = plugin
            .options
            .iter()
            .map(|option| ScopeOption {
                name: &option.name,
                decl: &option.decl,
                site: plugin_option_site(&plugin.identity, &option.name, &option.decl),
            })
            .collect();
        for option in &joining {
            if let Some(claimed) = names.iter().find(|entry| entry.name == option.name) {
                return Err(key_collision(
                    Side {
                        name: &claimed.name,
                        owner: &claimed.owner,
                        site: &claimed.site,
                    },
                    Side {
                        name: option.name,
                        owner: &owner,
                        site: &option.site,
                    },
                ));
            }
            names.push(TableName {
                name: option.name.to_owned(),
                site: option.site.clone(),
                owner: owner.clone(),
            });
        }
        let own_table = table::compile(&joining, &format!("plugin {}", quoted(&plugin.identity)))?;
        for (spelling, entry) in own_table {
            if let Some(existing) = table::lookup(&compiled, &spelling) {
                let claimed = names.iter().find(|known| known.name == existing.name);
                let joined = names.iter().find(|known| known.name == entry.name);
                if let (Some(claimed), Some(joined)) = (claimed, joined) {
                    return Err(spelling_collision(
                        &spelling,
                        (
                            Side {
                                name: &claimed.name,
                                owner: &claimed.owner,
                                site: &claimed.site,
                            },
                            existing,
                        ),
                        (
                            Side {
                                name: &joined.name,
                                owner: &joined.owner,
                                site: &joined.site,
                            },
                            &entry,
                        ),
                    ));
                }
            }
            compiled.push((spelling, entry));
        }
        scope.extend(joining);
    }
    check_marks(&scope)?;
    let mut variables = table::bound_variables(&scope[..own.len()], |option| {
        format!("global option {}", quoted(option.name))
    });
    let mut offset = own.len();
    for plugin in plugins {
        let count = plugin.options.len();
        variables.extend(table::bound_variables(
            &scope[offset..offset + count],
            |option| {
                format!(
                    "plugin {} option {}",
                    quoted(&plugin.identity),
                    quoted(option.name)
                )
            },
        ));
        offset += count;
    }
    table::claim_variables(&[], variables.clone())?;
    Ok(GlobalTable {
        names,
        table: compiled,
        variables,
    })
}

/// One option per run-wide mark across every global option, the plugins' included.
fn check_marks(scope: &[ScopeOption<'_>]) -> Result<(), DeclarationError> {
    for (fact, rule) in MARKS {
        let marked: Vec<&ScopeOption<'_>> = scope
            .iter()
            .filter(|option| option.decl.marks().contains(&fact))
            .collect();
        if marked.len() < 2 {
            continue;
        }
        let subjects: Vec<String> = marked
            .iter()
            .enumerate()
            .map(|(index, option)| {
                if index == 0 {
                    option.site.subject.clone()
                } else {
                    mid_sentence(&option.site.subject)
                }
            })
            .collect();
        let parts = marked.iter().fold(
            DiagnosticParts::new(format!("{} both declare {fact}.", subjects.join(" and "))),
            |parts, option| parts.finding(option.site.finding(&format!("1.{fact}"))),
        );
        return Err(DeclarationError::new(
            rule,
            parts.correction("Mark one option."),
        ));
    }
    Ok(())
}

impl ApplicationDeclaration {
    /// A new Application's declaration, after the portable-name rule.
    pub(crate) fn new(name: &str) -> Result<Self, DeclarationError> {
        if !is_portable_name(name) {
            return Err(DeclarationError::new(
                rules::PORTABLE_NAME,
                DiagnosticParts::new(format!("Application name {} is invalid.", quoted(name)))
                    .finding(Finding::new("Application::new", vec![name.into()]).mark("0"))
                    .correction(PORTABLE_NAME_CORRECTION),
            ));
        }
        Ok(Self {
            name: name.to_owned(),
            version: None,
            description: None,
            root: CommandDeclaration::default(),
            own_globals: Vec::new(),
            globals: Vec::new(),
            global_table: GlobalTable::default(),
            plugins: Vec::new(),
            overrides: Vec::new(),
            translators: Vec::new(),
            shutdown_timeout: DEFAULT_SHUTDOWN_TIMEOUT,
            rendering: RenderingPolicy::default(),
            source: None,
            configuration: None,
            log_hooks: Vec::new(),
        })
    }

    /// `global_option(name, config)`: the option's own rules, the global table with it, and every
    /// local option already declared, at the root and on each attached Command.
    pub(crate) fn declare_global(
        &mut self,
        name: &str,
        decl: OptionDecl,
    ) -> Result<(), DeclarationError> {
        let site = global_site(name, &decl);
        check_option_name(name, &site)?;
        check_option_config(
            &ScopeOption {
                name,
                decl: &decl,
                site: site.clone(),
            },
            true,
        )?;
        let mut registry = self.root.descriptors.clone();
        let extensions = option_extensions(
            &decl,
            &mut registry,
            &site,
            ExtensionSubject {
                phrase: format!("on the global option {}", quoted(name)),
                sentence: site.subject.clone(),
            },
        )?;
        let mut own = self.own_globals.clone();
        own.push(OptionInput {
            name: name.to_owned(),
            decl,
            extensions,
        });
        let table = global_table(&own, &self.plugins)?;
        self.root.check_against_globals(&[], &table)?;
        if let Some(declared) = own.last() {
            crate::marks::check_mark_binding(
                declared,
                &site,
                self.source.as_ref().map(|source| source.binding),
            )?;
        }
        self.root.descriptors = registry;
        self.own_globals = own;
        self.refresh_globals();
        self.global_table = table;
        Ok(())
    }

    /// One call of a `GlobalInputs` struct's declarations, applied as `global_option()`. A struct
    /// whose `GlobalInputs` impl was written by hand can still list an input no global option can
    /// be, which is `option-config` here.
    pub(crate) fn declare_global_call(
        &mut self,
        call: crate::inputs::DeclarationCall,
    ) -> Result<(), DeclarationError> {
        use crate::inputs::DeclarationCall;
        let (sentence, finding) = match call {
            DeclarationCall::Option(name, OptionDecl::Content(content)) => (
                format!(
                    "Global option {} is a content option, which stays local to its Command.",
                    quoted(&name)
                ),
                Finding::new(
                    "option",
                    vec![name.as_str().into(), OptionDecl::Content(content).literal()],
                )
                .mark("1"),
            ),
            DeclarationCall::Option(name, decl) => return self.declare_global(&name, decl),
            DeclarationCall::Argument(name, decl) => (
                format!(
                    "Global inputs declare argument {}, which only a Command takes.",
                    quoted(&name)
                ),
                Finding::new("argument", vec![name.as_str().into(), decl.literal()]).mark("0"),
            ),
            DeclarationCall::Stdin(stdin) => (
                "Global inputs declare stdin, which only a Command reads.".to_owned(),
                Finding::new("stdin", vec![stdin.literal()]).mark("0"),
            ),
            DeclarationCall::Group(_, names) => (
                "Global inputs declare an option group, which only a Command declares.".to_owned(),
                Finding::new("exclusive", vec![crate::diagnostics::Literal::from(names)]).mark("0"),
            ),
        };
        Err(DeclarationError::new(
            rules::OPTION_CONFIG,
            DiagnosticParts::new(sentence)
                .finding(finding)
                .correction("Declare it on the Command with inputs::<I>() instead."),
        ))
    }

    /// Every global option in reading order: the application's own, then each plugin's.
    fn refresh_globals(&mut self) {
        self.globals = self
            .own_globals
            .iter()
            .chain(self.plugins.iter().flat_map(|plugin| plugin.options.iter()))
            .cloned()
            .collect();
    }

    /// Every translation in resolution order: the application's, then each plugin's in
    /// installation order.
    pub(crate) fn translations(&self) -> impl Iterator<Item = &Translation> {
        self.translators.iter().chain(
            self.plugins
                .iter()
                .flat_map(|plugin| plugin.translators.iter()),
        )
    }

    /// Every contribution an installed plugin's `views` list makes, in installation order.
    pub(crate) fn plugin_views(&self) -> Vec<ViewContribution> {
        self.plugins
            .iter()
            .flat_map(|plugin| plugin.views.iter().cloned())
            .collect()
    }

    /// `plugins(list)`: the installed list in composition order, with every rule that reads two
    /// plugins together, then each plugin's options joining the global table and its Commands
    /// attaching to the root, ahead of the application's own. Each plugin's own rules already ran
    /// at its own calls.
    pub(crate) fn install(&mut self, plugins: Vec<PluginState>) -> Result<(), DeclarationError> {
        let entries: Vec<Literal> = plugins
            .iter()
            .map(|plugin| Literal::builder(plugin_receiver(&plugin.identity)))
            .collect();
        let place = |index: usize, note: &str| {
            let finding = Finding::new("plugins", vec![Literal::List(entries.clone())])
                .path(Vec::new())
                .mark(format!("0.{index}"));
            if note.is_empty() {
                finding
            } else {
                finding.note(note)
            }
        };
        let mut registry = self.root.descriptors.clone();
        let mut theme: Option<usize> = None;
        let mut source: Option<usize> = None;
        let mut encoders: Vec<(&FailureEncoding, usize)> = Vec::new();
        // The application's overrides, even those listed before `plugins()`, register their view
        // identities first, so each plugin's list meets them.
        let mut views: Vec<ViewContribution> = self
            .overrides
            .iter()
            .cloned()
            .map(ViewContribution::Override)
            .collect();
        for (index, plugin) in plugins.iter().enumerate() {
            let identity = &plugin.identity;
            if let Some(first) = plugins[..index]
                .iter()
                .position(|earlier| &earlier.identity == identity)
            {
                return Err(DeclarationError::new(
                    rules::PLUGIN_INSTALLED_TWICE,
                    DiagnosticParts::new(format!(
                        "The Application installs plugin {} twice.",
                        quoted(identity)
                    ))
                    .finding(place(first, "the first installation"))
                    .finding(place(index, "the second installation"))
                    .correction("Install each plugin once."),
                ));
            }
            if plugin.theme.is_some() {
                if let Some(owner) = theme {
                    return Err(slot_fault(
                        (&plugins[owner].identity, owner),
                        (identity, index),
                        &place,
                        Slot::Theme,
                    ));
                }
                theme = Some(index);
            }
            for descriptor in plugin.descriptors.values() {
                admit_descriptor(&mut registry, descriptor, Some(place(index, "")))?;
            }
            if plugin.source.is_some() {
                if let Some(owner) = source {
                    return Err(slot_fault(
                        (&plugins[owner].identity, owner),
                        (identity, index),
                        &place,
                        Slot::Source,
                    ));
                }
                source = Some(index);
            }
            for encoding in &plugin.failure_encoders {
                if let Some((_, first)) = encoders
                    .iter()
                    .find(|(known, _)| known.media_type == encoding.media_type)
                {
                    return Err(DeclarationError::new(
                        rules::FAILURE_ENCODER_TAKEN,
                        DiagnosticParts::new(format!(
                            "{} registers a failure encoder for {}, which plugin {} already registers.",
                            plugin_sentence(identity),
                            quoted(&encoding.media_type),
                            quoted(&plugins[*first].identity)
                        ))
                        .finding(place(*first, "the first encoder"))
                        .finding(place(index, "the second encoder"))
                        .correction("Install one of them."),
                    ));
                }
                encoders.push((encoding, index));
            }
            crate::output::registry::check_contributions(&views, &plugin.views, |_| {
                place(index, "")
            })?;
            views.extend(plugin.views.iter().cloned());
        }
        let installed: Vec<Arc<PluginState>> = plugins.into_iter().map(Arc::new).collect();
        let table = global_table(&self.own_globals, &installed)?;
        // Only installation holds every plugin, so it judges each plugin's marked options against
        // the source another one installs.
        let binding = installed
            .iter()
            .find_map(|plugin| plugin.source.as_ref())
            .map(|claimed| claimed.binding);
        for plugin in &installed {
            for option in &plugin.options {
                crate::marks::check_mark_binding(
                    option,
                    &plugin_option_site(&plugin.identity, &option.name, &option.decl),
                    binding,
                )?;
            }
        }
        self.root.descriptors = registry;
        self.plugins = installed;
        self.refresh_globals();
        self.global_table = table;
        let plugins = self.plugins.clone();
        for plugin in &plugins {
            for command in &plugin.commands {
                self.attach(command.clone())?;
            }
            if let Some(claimed) = &plugin.source {
                self.source = Some(crate::inputs::sources::SourceSlot {
                    plugin: plugin.identity.clone(),
                    binding: claimed.binding,
                    own: plugin
                        .options
                        .iter()
                        .map(|option| option.name.clone())
                        .collect(),
                    resolve: Arc::clone(&claimed.resolve),
                });
                self.configuration = Some(claimed.schema.clone());
            }
            if let Some(hook) = &plugin.on_log {
                self.log_hooks.push(Arc::clone(hook));
            }
        }
        Ok(())
    }

    /// `command(child)` on the Application: the attach rules, then the subtree joins the
    /// Application one node at a time, each admitting its descriptors and then checking its local
    /// options against the globals.
    pub(crate) fn attach(&mut self, child: CommandDeclaration) -> Result<(), DeclarationError> {
        self.root.check_attach(&child)?;
        let path = vec![child.name.clone().unwrap_or_default()];
        let mut registry = self.root.descriptors.clone();
        child.join(&path, &self.global_table, &mut registry)?;
        self.root.children.push(child);
        self.root.descriptors = registry;
        Ok(())
    }

    /// `shutdown_timeout(ms)`: a whole number of milliseconds from 0 through 2147483647.
    pub(crate) fn set_shutdown_timeout(
        &mut self,
        milliseconds: u32,
    ) -> Result<(), DeclarationError> {
        if milliseconds > LONGEST_SHUTDOWN_TIMEOUT {
            return Err(DeclarationError::new(
                rules::INVALID_SHUTDOWN_TIMEOUT,
                DiagnosticParts::new(format!(
                    "The Application declares shutdown timeout {milliseconds}, which is not a whole number of milliseconds from 0 through {LONGEST_SHUTDOWN_TIMEOUT}."
                ))
                .finding(
                    Finding::new("shutdown_timeout", vec![milliseconds.into()])
                        .path(Vec::new())
                        .mark("0"),
                )
                .correction(format!(
                    "Set the shutdown timeout to a whole number of milliseconds from 0 through {LONGEST_SHUTDOWN_TIMEOUT}, or leave it out for {DEFAULT_SHUTDOWN_TIMEOUT}."
                )),
            ));
        }
        self.shutdown_timeout = milliseconds;
        Ok(())
    }
}

/// The slots one plugin at most may claim.
#[derive(Clone, Copy)]
enum Slot {
    Source,
    Theme,
}

/// A second claim on one slot, which marks the owner's entry and the claimant's in `plugins`.
fn slot_fault(
    owner: (&str, usize),
    claimant: (&str, usize),
    place: &dyn Fn(usize, &str) -> Finding,
    slot: Slot,
) -> DeclarationError {
    let (clause, held, correction) = match slot {
        Slot::Source => (
            format!(
                "declares a configuration source, which plugin {} already declares.",
                quoted(owner.0)
            ),
            "declares the configuration source",
            "Install one source.",
        ),
        Slot::Theme => (
            format!(
                "claims the theme slot, which plugin {} already holds.",
                quoted(owner.0)
            ),
            "holds the theme slot",
            "Install one owner.",
        ),
    };
    DeclarationError::new(
        rules::SLOT_TAKEN,
        DiagnosticParts::new(format!("{} {clause}", plugin_sentence(claimant.0)))
            .finding(place(owner.1, held))
            .finding(place(claimant.1, "claims it again"))
            .correction(correction),
    )
}
