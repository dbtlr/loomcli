//! The service plugin: runs one of the application's own Commands as a per-user service the
//! platform supervises, a systemd user unit on Linux and a launchd user agent on macOS, and starts,
//! stops, restarts, reports on, and removes it.
//!
//! [`service()`] contributes the `service` Command group and a graph check. Its six children are
//! `install`, which writes the unit, records it in the installation record's file `service.json`,
//! loads it, and starts it; `uninstall`; `start`; `stop`; `restart`; and `status`, whose result is a
//! [`ServiceStatus`] with the views `text` and `json`. Every call to `systemctl --user`, `loginctl`,
//! and `launchctl` goes through `host.spawn`, so a test scripts the programs on the mock process.
//!
//! `install` is refused for a build that is not distributed. The plugin never touches a file it did
//! not record: a file at the unit's path that the record does not list refuses the install and the
//! uninstall.
//!
//! The settings are the unit's reverse-DNS `label` and the `run` words the unit runs the
//! application with. A label outside the grammar panics at the [`service()`] call with the
//! `@loomcli/plugins/service/settings` diagnostic. On every graph build the plugin checks that the
//! `run` words route to a Command that has an action; words that do not fail the build with
//! `@loomcli/plugins/service/run-unrouted`.
//!
//! Install it once. A root that declares arguments cannot hold children, so such an application
//! cannot install the plugin.
//!
//! ```
//! use loomcli_core::{Application, Command, Context};
//! use loomcli_plugins::service::{ServiceDetail, service};
//!
//! let serve = Command::new("serve").action(|context: Context| async move {
//!     context.out.print("serving").await
//! });
//! let application = Application::new("notes")
//!     .description("Keep notes in sync.")
//!     .plugins((service("com.acme.notes", ["serve"])
//!         // Rows status adds under the unit once it is installed.
//!         .probe(|probe| {
//!             Box::pin(async move {
//!                 let health = if probe.state.running { "ok" } else { "down" };
//!                 Ok(vec![ServiceDetail::new("health", health)])
//!             })
//!         }),))
//!     .command(serve);
//! # let _ = application;
//! ```

mod backend;
mod children;
mod launchd;
mod manager;
mod messages;
mod route;
mod settings;
mod status;
mod systemd;
#[cfg(test)]
mod tests;
mod unit;

use std::sync::Arc;

use loomcli_core::{
    AnyPlugin, BoxFuture, Command, Context, Error, Group, Host, InvocationOutcome,
    InvocationValues, InvokeOptions, Log, NoInputs, NoResult, Plugin, Registration, ResultViews,
    RunSignal, ShutdownEvent, ValueResult, View, ViewContext,
};

use self::children::{ChildRun, Control, control, install_child, prepare, uninstall_child};
use self::manager::OnShutdown;
use self::status::{Subject, status_text};
use crate::PACKAGE_NAME;
use crate::format::json;
use crate::installation::exists;

pub use self::status::{ServiceDetail, ServiceState, ServiceStatus};

/// The rows a probe returns, or the error that fails `status` on the ordinary failure path.
pub type ProbeRows = Result<Vec<ServiceDetail>, Error>;

/// The probe an application sets: called once by `status` for an installed unit.
type Probe = Arc<dyn for<'a> Fn(ProbeContext<'a>) -> BoxFuture<'a, ProbeRows> + Send + Sync>;

/// What the probe receives from `status`.
#[non_exhaustive]
pub struct ProbeContext<'a> {
    /// What `status` read from the manager.
    pub state: &'a ServiceState,
    /// The run's host.
    pub host: Arc<Host>,
    /// The run signal.
    pub signal: RunSignal,
    /// The run's log.
    pub log: Log,
    context: &'a Context<NoInputs, ValueResult<ServiceStatus>>,
}

impl ProbeContext<'_> {
    /// Runs another Command of this run's graph by name, as the `status` action's own `invoke`
    /// does.
    pub async fn invoke<M: Send + 'static>(
        &self,
        path: &[&str],
        values: InvocationValues,
        options: InvokeOptions<M>,
    ) -> InvocationOutcome<M> {
        self.context.invoke(path, values, options).await
    }
}

/// The service plugin's settings builder.
#[must_use]
pub struct Service {
    label: String,
    run: Vec<String>,
    probe: Option<Probe>,
}

/// The service plugin. `label` is the unit's reverse-DNS name, such as `com.acme.notes`, and `run`
/// the argument words the unit runs the application with, such as `["serve"]`.
///
/// # Panics
///
/// At this call, with the `@loomcli/plugins/service/settings` diagnostic, for a label outside the
/// grammar: two or more segments joined by `.`, each a letter or digit followed by letters, digits,
/// and `-`, and 247 characters at most.
#[track_caller]
pub fn service(label: &str, run: impl IntoIterator<Item = impl Into<String>>) -> Service {
    settings::judge_label(label);
    Service {
        label: label.to_owned(),
        run: run.into_iter().map(Into::into).collect(),
        probe: None,
    }
}

impl Service {
    /// Rows `status` adds under the unit, once the unit is installed. The probe is called once with
    /// the state `status` read, whatever it is. A probe that returns an error takes the ordinary
    /// failure path.
    pub fn probe<F>(self, probe: F) -> Self
    where
        F: for<'a> Fn(ProbeContext<'a>) -> BoxFuture<'a, ProbeRows> + Send + Sync + 'static,
    {
        Self {
            probe: Some(Arc::new(probe)),
            ..self
        }
    }

    /// The plugin: the `service` group and the graph check of the `run` words. Its identity is
    /// `@loomcli/plugins/service`.
    pub fn plugin(self) -> Plugin {
        let run = self.run.clone();
        Plugin::new(format!("{PACKAGE_NAME}/service"))
            .commands([service_command(self)])
            .on_graph_built(move |graph| route::judge_run(graph, &run))
    }
}

impl From<Service> for AnyPlugin {
    fn from(settings: Service) -> Self {
        settings.plugin().into()
    }
}

/// What every child shares: the label and the run words.
struct Shared {
    label: String,
    run: Vec<String>,
}

/// The run a child acts on, read from its action context.
fn child_run<'a, I, R>(
    context: &'a Context<I, R>,
    label: &'a str,
    on_shutdown: OnShutdown<'a>,
) -> ChildRun<'a> {
    ChildRun {
        name: &context.graph.name,
        description: context.graph.description.as_deref(),
        label,
        host: &context.host,
        signal: &context.signal,
        on_shutdown,
    }
}

/// The shutdown registration of a context, as the manager calls take it.
fn shutdown_of<I: Sync, R: Sync>(
    context: &Context<I, R>,
) -> impl Fn(Box<dyn FnOnce(ShutdownEvent) + Send>) -> Registration + Send + Sync + '_ {
    move |handler| context.on_shutdown(handler)
}

/// What a child with no result does.
#[derive(Clone, Copy)]
enum Verb {
    Install,
    Uninstall,
    Control(Control),
}

/// One child with no arguments and no options, its action reading the run.
fn child(shared: &Arc<Shared>, name: &str, description: &str, verb: Verb) -> Command {
    let shared = Arc::clone(shared);
    Command::new(name)
        .description(description)
        .action(move |context: Context| {
            let shared = Arc::clone(&shared);
            async move {
                let on_shutdown = shutdown_of(&context);
                let run = child_run(&context, &shared.label, &on_shutdown);
                match verb {
                    Verb::Install => install_child(&run, &context.out, &shared.run).await,
                    Verb::Uninstall => uninstall_child(&run, &context.out).await,
                    Verb::Control(each) => control(&run, &context.out, each).await,
                }
            }
        })
}

/// `status`: the checks, then the manager's state, the probe's rows for an installed unit, and one
/// result. It exits 0 whenever it produced a report.
fn status_command(
    shared: &Arc<Shared>,
    probe: Option<Probe>,
) -> Command<NoInputs, ValueResult<ServiceStatus>> {
    let shared = Arc::clone(shared);
    let views = ResultViews::new()
        .view(
            "text",
            View::new(|status: &ServiceStatus, context: &ViewContext| status_text(status, context)),
        )
        .view("json", json::<ServiceStatus>())
        .default_view("text");
    Command::new("status")
        .description("Report whether the service is running.")
        .result(views)
        .action(
            move |context: Context<NoInputs, ValueResult<ServiceStatus>>| {
                let shared = Arc::clone(&shared);
                let probe = probe.clone();
                async move {
                    let on_shutdown = shutdown_of(&context);
                    let run = child_run(&context, &shared.label, &on_shutdown);
                    let prepared = prepare(&run)?;
                    let installed = exists(&prepared.unit.path)?;
                    let reading = prepared.backend.read(&prepared.unit, installed).await?;
                    let subject = Subject {
                        label: &shared.label,
                        unit: &prepared.unit.path,
                        installed,
                    };
                    let state = ServiceState::of(&subject, reading);
                    let details = match (&probe, installed) {
                        (Some(probe), true) => {
                            probe(ProbeContext {
                                state: &state,
                                host: Arc::clone(&context.host),
                                signal: context.signal.clone(),
                                log: context.log.clone(),
                                context: &context,
                            })
                            .await?
                        }
                        _ => Vec::new(),
                    };
                    context
                        .out
                        .results(ServiceStatus::of(&state, details))
                        .await
                }
            },
        )
}

/// The `service` group and its six children.
fn service_command(settings: Service) -> Command<NoInputs, NoResult, Group> {
    let shared = Arc::new(Shared {
        label: settings.label,
        run: settings.run,
    });
    Command::new("service")
        .description("Run this application as a background service.")
        .command(child(
            &shared,
            "install",
            "Install the service and start it.",
            Verb::Install,
        ))
        .command(child(
            &shared,
            "uninstall",
            "Stop the service and remove it.",
            Verb::Uninstall,
        ))
        .command(child(
            &shared,
            "start",
            "Start the service.",
            Verb::Control(Control::Start),
        ))
        .command(child(
            &shared,
            "stop",
            "Stop the service.",
            Verb::Control(Control::Stop),
        ))
        .command(child(
            &shared,
            "restart",
            "Restart the service.",
            Verb::Control(Control::Restart),
        ))
        .command(status_command(&shared, settings.probe))
}
