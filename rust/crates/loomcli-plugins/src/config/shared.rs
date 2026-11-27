//! What the source and the provider of one `configuration()` call share: the lookup, the read, and
//! the validated result of a run. The result is keyed by the run's host, the one `Arc` core hands
//! both, so each warning and each `-v` line is written once, whichever reads first.

use std::marker::PhantomData;
use std::path::Path;
use std::sync::{Arc, Mutex, Weak};

use loomcli_core::{
    CommandGraph, ContextualStyle, DeclarationError, DiagnosticParts, DiagnosticRule, Error, Host,
    InvokedBy, Log, Out, diagnostic_rule, escape_control_characters,
};
use serde::de::DeserializeOwned;

use super::document::{Step, Value};
use super::drop::{Dropped, Removal, drop_until_passes, shown_path};
use super::lookup::{Line, Lookup, LookupFault, Reach, UsableFile};
use super::strict::RemovalCoverage;
use super::{ConfigurationReader, Strict};
use super::{links::published_schema, messages, unknown};

/// A configuration schema that rejects an empty file, which no type check can see.
pub(crate) const EMPTY_FILE: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/config/empty-file",
    "Configuration schema rejects an empty file",
    "A command-line application runs before its operator has written any configuration, so the configuration schema accepts an empty file. The plugin drops every value the schema rejects and validates again, and a schema that still reports an issue once every key is gone, such as a refinement that fails for an empty object, leaves the plugin no file to give the application.",
);

/// The key a file may hold for the URL of its hosted JSON Schema, which an editor reads.
const POINTER_KEY: &str = "$schema";

enum RemovalReport {
    Debug,
    Failure,
    EarlierFailure,
}

/// A missing key that an earlier round removed takes its issue from that earlier rejection.
fn earlier_rejection<'a>(
    removals: &'a [(Removal, RemovalReport)],
    mut removal: &'a Removal,
) -> Option<usize> {
    let mut earlier = removals;
    while matches!(
        removal.issue_path.get(removal.path.len()..),
        Some([Step::Key(_)])
    ) {
        let Some(index) = earlier
            .iter()
            .rposition(|(rejected, _)| rejected.path == removal.issue_path)
        else {
            break;
        };
        removal = &earlier[index].0;
        earlier = &earlier[..index];
    }
    (earlier.len() < removals.len()).then_some(earlier.len())
}

/// What a run read: the file that passed, when one was found, with every dropped value removed.
#[derive(Clone, Debug)]
pub(crate) struct Loaded {
    pub(crate) usable: Option<UsableFile>,
    pub(crate) file_issues: Vec<String>,
}

impl Loaded {
    /// The document the schema's output reads: the passed file, or an empty one.
    pub(crate) fn document(&self) -> Value {
        self.usable
            .as_ref()
            .map_or_else(Value::empty_object, |usable| usable.object.clone())
    }
}

/// How a run's read failed, kept so a second reader fails the same way.
#[derive(Clone, Debug)]
enum Fault {
    Lookup(LookupFault),
    EmptyFile(String),
}

/// One run's result.
#[derive(Clone, Debug)]
struct Read {
    loaded: Result<Loaded, Fault>,
    invoked_by: InvokedBy,
}

impl Read {
    fn result(&self) -> Result<Loaded, Error> {
        match &self.loaded {
            Ok(loaded) => Ok(loaded.clone()),
            Err(Fault::Lookup(fault)) => Err(fault.error(self.invoked_by).into()),
            Err(Fault::EmptyFile(message)) => Err(empty_file_fault(message).into()),
        }
    }
}

/// The fault of a schema that still rejects an empty file, which is the author's defect.
fn empty_file_fault(message: &str) -> DeclarationError {
    let reason = escape_control_characters(message);
    let stop = if reason.ends_with(['.', '!', '?']) {
        ""
    } else {
        "."
    };
    DeclarationError::new(
        EMPTY_FILE,
        DiagnosticParts::new(format!(
            "The configuration schema rejects an empty file: {reason}{stop}"
        ))
        .correction("Make every key optional, and keep every refinement true for an empty file."),
    )
}

/// What the call fixed for every run: the file pattern's candidates, the other settings, and the
/// type the schema deserializes into.
pub(crate) struct Shared<T> {
    /// The pattern's candidates, or `None` for the default `.<app>.json`.
    pub(crate) candidates: Option<Vec<String>>,
    readers: Vec<ConfigurationReader>,
    pub(crate) strict: Strict,
    /// The variable that names the configuration file, when the settings name one.
    pub(crate) env: Option<String>,
    pub(crate) notice: bool,
    pub(crate) reach: Reach,
    /// The result each run read, by the run's host.
    reads: Mutex<Vec<(Weak<Host>, Read)>>,
    _value: PhantomData<fn() -> T>,
}

/// What a reader hands the shared read: the facts of its run and the plugin's option values.
pub(crate) struct Scene<'a> {
    pub(crate) graph: &'a CommandGraph,
    pub(crate) host: &'a Arc<Host>,
    pub(crate) invoked_by: InvokedBy,
    pub(crate) out: &'a Out,
    pub(crate) log: &'a Log,
    pub(crate) style: &'a ContextualStyle,
    pub(crate) config: Option<&'a str>,
    pub(crate) no_config: bool,
    pub(crate) directory: Option<&'a str>,
}

impl<T: DeserializeOwned + Send + Sync + 'static> Shared<T> {
    pub(crate) fn new(
        candidates: Option<Vec<String>>,
        readers: Vec<ConfigurationReader>,
        strict: Strict,
        env: Option<String>,
        notice: bool,
        reach: Reach,
    ) -> Self {
        Self {
            candidates,
            readers,
            strict,
            env,
            notice,
            reach,
            reads: Mutex::new(Vec::new()),
            _value: PhantomData,
        }
    }

    /// The lookup, the read, and the validation of one run, with the lines it writes in order.
    fn load(&self, scene: &Scene<'_>) -> (Read, Vec<Line>) {
        let mut lines = Vec::new();
        let default_candidates = [format!(".{}.json", scene.graph.name)];
        let candidates = self.candidates.as_deref().unwrap_or(&default_candidates);
        let from_variable = self
            .env
            .as_deref()
            .and_then(|name| scene.host.env.get(name))
            .map(String::as_str);
        let lookup = Lookup {
            candidates,
            readers: &self.readers,
            strict: self.strict.enabled(),
            directory: scene.directory,
            from_variable,
            host: scene.host,
            app: &scene.graph.name,
            notice: self.notice,
            reach: &self.reach,
            named: scene.config,
            ignored: scene.no_config,
            style: scene.style,
        };
        let found = match lookup.find(&mut lines) {
            Ok(found) => found,
            Err(fault) => {
                let read = Read {
                    loaded: Err(Fault::Lookup(fault)),
                    invoked_by: scene.invoked_by,
                };
                return (read, lines);
            }
        };
        // The `$schema` pointer names the file's hosted schema for an editor, and is never a setting.
        let object = found.as_ref().map_or_else(Value::empty_object, |usable| {
            usable.object.without_key(POINTER_KEY)
        });
        let shown = found.as_ref().map(|usable| usable.file.shown.clone());
        let schema = published_schema(scene.graph);
        let mut removals = Vec::new();
        let dropped = drop_until_passes::<T>(object, &mut |removal, round| {
            let coverage = found.as_ref().map_or(RemovalCoverage::Uncovered, |usable| {
                self.strict
                    .removal_coverage(&removal, round, &usable.object, schema)
            });
            let report = match coverage {
                RemovalCoverage::Uncovered => RemovalReport::Debug,
                RemovalCoverage::Covered => RemovalReport::Failure,
                RemovalCoverage::MissingListedKey => {
                    if let Some(index) = earlier_rejection(&removals, &removal) {
                        removals[index].1 = RemovalReport::Failure;
                        RemovalReport::EarlierFailure
                    } else {
                        RemovalReport::Failure
                    }
                }
            };
            removals.push((removal, report));
        });
        let mut file_issues = Vec::new();
        for (removal, report) in removals {
            match (report, shown.as_deref()) {
                (RemovalReport::Failure, Some(file)) => {
                    let path = shown_path(&removal.issue_path);
                    file_issues.push(messages::rejected_value(
                        (!removal.issue_path.is_empty()).then_some(path.as_str()),
                        file,
                        &removal.message,
                    ));
                }
                (RemovalReport::Debug, file) => {
                    let path = shown_path(&removal.path);
                    lines.push(Line::Debug(messages::ignored_value(
                        (!removal.path.is_empty()).then_some(path.as_str()),
                        file,
                        &removal.message,
                    )));
                }
                _ => {}
            }
        }
        let loaded = match dropped {
            Dropped::Passed(object) => {
                if let (Some(schema), Some(file)) = (schema, shown.as_deref()) {
                    unknown::walk(&object, schema, |path| {
                        let shown = unknown::shown_path(path);
                        if self.strict.covers(path) {
                            file_issues.push(messages::strict_unknown_key(&shown, file));
                        } else {
                            lines.push(Line::Debug(messages::ignored_value(
                                Some(&shown),
                                Some(file),
                                messages::UNKNOWN_KEY_ISSUE,
                            )));
                        }
                    });
                }
                Ok(Loaded {
                    file_issues,
                    usable: found.map(|usable| UsableFile {
                        file: usable.file,
                        object,
                    }),
                })
            }
            Dropped::EmptyRejected(message) => Err(Fault::EmptyFile(message)),
        };
        let read = Read {
            loaded,
            invoked_by: scene.invoked_by,
        };
        (read, lines)
    }

    /// The run's shared result: the first reader reads and writes the lines, and every later
    /// reader of the same run takes the result alone.
    pub(crate) async fn load_once(&self, scene: &Scene<'_>) -> Result<Loaded, Error> {
        let known = {
            let mut reads = self
                .reads
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            reads.retain(|(host, _)| host.strong_count() > 0);
            reads
                .iter()
                .find(|(host, _)| {
                    host.upgrade()
                        .is_some_and(|host| Arc::ptr_eq(&host, scene.host))
                })
                .map(|(_, read)| read.clone())
        };
        if let Some(read) = known {
            return read.result();
        }
        let (read, lines) = self.load(scene);
        self.reads
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .push((Arc::downgrade(scene.host), read.clone()));
        for line in lines {
            match line {
                Line::Warn(text) => scene.out.warn(&text).await?,
                Line::Info(text) => scene.out.info(&text).await?,
                Line::Debug((template, fields)) => scene.log.debug(template, fields),
                Line::Trace((template, fields)) => scene.log.trace(template, fields),
            }
        }
        read.result()
    }
}

/// The directory a file-relative path resolves against: the file's own.
pub(crate) fn directory_of(usable: &UsableFile) -> std::path::PathBuf {
    usable
        .file
        .path
        .parent()
        .map_or_else(|| Path::new("/").to_path_buf(), Path::to_path_buf)
}
