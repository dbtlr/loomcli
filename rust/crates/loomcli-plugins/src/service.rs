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
//! The required settings are the unit's reverse-DNS `label` and the `run` words the unit runs the
//! application with. The builder can also set the unit's environment, output file, and stop
//! timeout. A label outside the grammar panics at the [`service()`] call with the
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

use std::num::NonZeroU64;
use std::sync::Arc;

use loomcli_core::{
    AnyPlugin, BoxFuture, Command, Context, Env, Error, Group, Host, InvocationOutcome,
    InvocationValues, InvokeOptions, Log, NoInputs, NoResult, Plugin, Registration, ResultViews,
    RunSignal, ShutdownEvent, ValueResult, View, ViewContext,
};

use self::children::{ChildRun, Control, control, install_child, prepare, uninstall_child};
use self::manager::OnShutdown;
use self::status::{Subject, logs_of, output_of, status_text};
use crate::PACKAGE_NAME;
use crate::format::json;
use crate::installation::exists;

pub use self::status::{
    ServiceConsoleCapture, ServiceDetail, ServiceFile, ServiceLogs, ServiceState, ServiceStatus,
};

/// The rows a probe returns, or the error that fails `status` on the ordinary failure path.
pub type ProbeRows = Result<Vec<ServiceDetail>, Error>;

/// The probe an application sets: called once by `status` for an installed unit.
type Probe = Box<dyn for<'a> Fn(ProbeContext<'a>) -> BoxFuture<'a, ProbeRows> + Send + Sync>;

type Environment = Box<dyn Fn(&Host) -> Result<Env, Error> + Send + Sync>;

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
    environment: Option<Environment>,
    output: Option<String>,
    stop_timeout: Option<NonZeroU64>,
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
        environment: None,
        output: None,
        stop_timeout: None,
        probe: None,
    }
}

impl Service {
    /// Sets the unit's environment from the host running `service install`. Use values safe to
    /// write to a unit file that other local users can read. A callback error fails install
    /// through the ordinary failure path.
    pub fn environment<F>(mut self, environment: F) -> Self
    where
        F: Fn(&Host) -> Result<Env, Error> + Send + Sync + 'static,
    {
        self.environment = Some(Box::new(environment));
        self
    }

    /// Sends the unit's stdout and stderr to the same file. A relative path resolves from the
    /// host's home. Install creates the file's parent folder, and the manager opens the file.
    ///
    /// # Panics
    ///
    /// An empty path raises the `@loomcli/plugins/service/settings` diagnostic at this call.
    #[track_caller]
    pub fn output(mut self, path: impl Into<String>) -> Self {
        let path = path.into();
        settings::judge_output(&path);
        self.output = Some(path);
        self
    }

    /// Sets the manager's stop timeout in milliseconds. Set it above the Application's shutdown
    /// timeout. Loom writes launchd's `ExitTimeOut` in whole seconds rounded up. On macOS 26.4
    /// and later, launchd caps the effective timeout at 60 seconds.
    ///
    /// # Panics
    ///
    /// Zero raises the `@loomcli/plugins/service/settings` diagnostic at this call.
    #[track_caller]
    pub fn stop_timeout(mut self, milliseconds: u64) -> Self {
        self.stop_timeout = Some(settings::judge_stop_timeout(milliseconds));
        self
    }

    /// Rows `status` adds under the unit, once the unit is installed. The probe is called once with
    /// the state `status` read, whatever it is. A probe that returns an error takes the ordinary
    /// failure path.
    pub fn probe<F>(mut self, probe: F) -> Self
    where
        F: for<'a> Fn(ProbeContext<'a>) -> BoxFuture<'a, ProbeRows> + Send + Sync + 'static,
    {
        self.probe = Some(Box::new(probe));
        self
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
fn child(settings: &Arc<Service>, name: &str, description: &str, verb: Verb) -> Command {
    let settings = Arc::clone(settings);
    Command::new(name)
        .description(description)
        .action(move |context: Context| {
            let settings = Arc::clone(&settings);
            async move {
                let on_shutdown = shutdown_of(&context);
                let run = child_run(&context, &settings.label, &on_shutdown);
                match verb {
                    Verb::Install => install_child(&run, &context.out, &settings).await,
                    Verb::Uninstall => uninstall_child(&run, &context.out).await,
                    Verb::Control(each) => control(&run, &context.out, each).await,
                }
            }
        })
}

/// `status`: the checks, then the manager's state, the probe's rows for an installed unit, and one
/// result. It exits 0 whenever it produced a report.
fn status_command(settings: &Arc<Service>) -> Command<NoInputs, ValueResult<ServiceStatus>> {
    let settings = Arc::clone(settings);
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
                let settings = Arc::clone(&settings);
                async move {
                    let on_shutdown = shutdown_of(&context);
                    let run = child_run(&context, &settings.label, &on_shutdown);
                    let prepared = prepare(&run)?;
                    // Snapshot the destinations before the manager calls can log to them.
                    let output = prepared.output_path(&settings).map(output_of);
                    let logs = logs_of(&context.graph, &context.host, output.is_some())?;
                    let installed = exists(&prepared.unit.path)?;
                    let reading = prepared.backend.read(&prepared.unit, installed).await?;
                    let subject = Subject {
                        label: &settings.label,
                        unit: &prepared.unit.path,
                        installed,
                    };
                    let state = ServiceState::of(&subject, reading);
                    let details = match (&settings.probe, installed) {
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
                        .results(ServiceStatus {
                            output,
                            logs,
                            ..ServiceStatus::of(&state, details)
                        })
                        .await
                }
            },
        )
}

/// The `service` group and its six children.
fn service_command(settings: Service) -> Command<NoInputs, NoResult, Group> {
    let settings = Arc::new(settings);
    Command::new("service")
        .description("Run this application as a background service.")
        .command(child(
            &settings,
            "install",
            "Install the service and start it.",
            Verb::Install,
        ))
        .command(child(
            &settings,
            "uninstall",
            "Stop the service and remove it.",
            Verb::Uninstall,
        ))
        .command(child(
            &settings,
            "start",
            "Start the service.",
            Verb::Control(Control::Start),
        ))
        .command(child(
            &settings,
            "stop",
            "Stop the service.",
            Verb::Control(Control::Stop),
        ))
        .command(child(
            &settings,
            "restart",
            "Restart the service.",
            Verb::Control(Control::Restart),
        ))
        .command(status_command(&settings))
}
