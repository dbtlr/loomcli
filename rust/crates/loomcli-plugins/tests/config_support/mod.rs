//! The fixture of the configuration plugin's tests, ported from the reference's
//! `fixtures/config-run.ts`: an application that installs `configuration()` with the settings a
//! case names and binds its options to keys with `CONFIG_INPUT`, run on a mock process in a
//! temporary workspace whose home is a folder of its own.
//!
//! The reference installs the help plugin beside the configuration plugin; help is another
//! package, so the fixture installs a stand-in that declares the same `--help` control option,
//! takes the run over when it is given, and adds help's hint line under a usage failure.

#![allow(dead_code, clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use loomcli_core::{
    Activation, Application, Context, Done, Error, FailureView, InputError, InputProblem, Inputs,
    InvocationOutcome, InvocationValues, InvokeOptions, InvokedBy, Issue, MiddlewareContext, Next,
    NoInputs, NoResult, Opt, Plugin, Polarity, ProcessHandle, Provider, RunOptions, UsageError,
    ValidationContext, Validator, failure, override_view,
};
use loomcli_plugins::config::extension::{CONFIG_INPUT, ConfigInputFacts};
use loomcli_plugins::config::{ConfigurationSettings, DirectoryOption, Scope, configuration};
use loomcli_testing::{MockFields, MockTerminal, mock_process};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value, json};

pub type App = Application<NoInputs, NoResult, Done>;

/// The settings a case gives besides the schema, as the reference's settings object holds them.
#[derive(Clone, Debug, Default)]
pub struct Settings {
    pub file: Option<String>,
    pub short: Option<char>,
    pub env: Option<String>,
    pub directory: Option<(String, Option<char>, Option<String>)>,
    pub notice: bool,
    pub scopes: Option<Vec<Scope>>,
}

impl Settings {
    pub fn file(file: &str) -> Self {
        Self {
            file: Some(file.to_owned()),
            ..Self::default()
        }
    }

    pub fn with_file(self, file: &str) -> Self {
        Self {
            file: Some(file.to_owned()),
            ..self
        }
    }

    pub fn with_short(self, letter: char) -> Self {
        Self {
            short: Some(letter),
            ..self
        }
    }

    pub fn with_env(self, variable: &str) -> Self {
        Self {
            env: Some(variable.to_owned()),
            ..self
        }
    }

    pub fn with_directory(self, name: &str) -> Self {
        Self {
            directory: Some((name.to_owned(), None, None)),
            ..self
        }
    }

    pub fn with_notice(self) -> Self {
        Self {
            notice: true,
            ..self
        }
    }

    pub fn with_scopes(self, scopes: Vec<Scope>) -> Self {
        Self {
            scopes: Some(scopes),
            ..self
        }
    }

    /// The plugin's settings for a schema type.
    pub fn apply<T: DeserializeOwned + Send + Sync + 'static>(
        &self,
        schema: Option<Map<String, Value>>,
    ) -> ConfigurationSettings<T> {
        let mut settings = ConfigurationSettings::<T>::new(schema);
        if let Some(file) = &self.file {
            settings = settings.file(file);
        }
        if let Some(letter) = self.short {
            settings = settings.short(letter);
        }
        if let Some(env) = &self.env {
            settings = settings.env(env);
        }
        if let Some((name, short, description)) = &self.directory {
            let mut option = DirectoryOption::new(name);
            if let Some(letter) = short {
                option = option.short(*letter);
            }
            if let Some(text) = description {
                option = option.description(text);
            }
            settings = settings.directory(option);
        }
        if self.notice {
            settings = settings.notice();
        }
        if let Some(scopes) = &self.scopes {
            settings = settings.scopes(scopes);
        }
        settings
    }
}

/// The project scope with root markers.
pub fn project(root: &[&str]) -> Scope {
    Scope::Project {
        root: root.iter().map(|name| (*name).to_owned()).collect(),
    }
}

/// The schema a case picks by name.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SchemaName {
    /// Accepts whatever a file holds.
    #[default]
    Loose,
    /// Rejects an empty file.
    Refined,
    /// A refinement on the top-level object, which has no path.
    TopRefined,
    /// The sections the drop tests break: a default, a transform, a nested table, an array of
    /// units, and a map of units.
    Typed,
}

/// `loose`: a map of anything.
pub type Loose = Map<String, Value>;

/// `refined`: a map that must hold `present`.
#[derive(Serialize, Deserialize)]
#[serde(try_from = "Map<String, Value>")]
pub struct Refined(Map<String, Value>);

impl TryFrom<Map<String, Value>> for Refined {
    type Error = String;

    fn try_from(map: Map<String, Value>) -> Result<Self, String> {
        if map.contains_key("present") {
            Ok(Refined(map))
        } else {
            Err("Add present.".to_owned())
        }
    }
}

/// `topRefined`: a map whose `mode` must not be `bad`.
#[derive(Serialize, Deserialize)]
#[serde(try_from = "Map<String, Value>")]
pub struct TopRefined(Map<String, Value>);

impl TryFrom<Map<String, Value>> for TopRefined {
    type Error = String;

    fn try_from(map: Map<String, Value>) -> Result<Self, String> {
        if map.get("mode") == Some(&json!("bad")) {
            Err("Pick another mode.".to_owned())
        } else {
            Ok(TopRefined(map))
        }
    }
}

#[derive(Serialize, Deserialize)]
pub enum Mode {
    #[serde(rename = "fast")]
    Fast,
    #[serde(rename = "slow")]
    Slow,
}

#[derive(Serialize, Deserialize)]
pub struct Owner {
    pub id: String,
}

#[derive(Serialize, Deserialize)]
pub struct Source {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub dir: Option<String>,
    pub harness: String,
}

#[derive(Serialize, Deserialize)]
pub struct Sessions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sources: Option<Vec<Source>>,
}

#[derive(Serialize, Deserialize)]
pub struct Updates {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub interval: Option<f64>,
}

fn three() -> i64 {
    3
}

/// The title's transform: upper case.
fn upper<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Ok(Option::<String>::deserialize(deserializer)?.map(|title| title.to_uppercase()))
}

/// `typed`.
#[derive(Serialize, Deserialize)]
pub struct Typed {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mode: Option<Mode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub owners: Option<BTreeMap<String, Owner>>,
    #[serde(default = "three")]
    pub retries: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub root: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sessions: Option<Sessions>,
    #[serde(
        default,
        deserialize_with = "upper",
        skip_serializing_if = "Option::is_none"
    )]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updates: Option<Updates>,
}

/// Accepts one or more ASCII digits.
pub struct Digits;

impl Validator for Digits {
    type Output = String;

    fn validate(&self, input: &str, _: &ValidationContext) -> Result<String, Vec<Issue>> {
        if !input.is_empty() && input.bytes().all(|byte| byte.is_ascii_digit()) {
            Ok(input.to_owned())
        } else {
            Err(vec![Issue::new("Supply a whole number.")])
        }
    }
}

/// A path option's validator: a relative value resolves against the context's working
/// directory, which a configuration answer sets to its file's directory.
pub struct PathValue;

impl Validator for PathValue {
    type Output = String;

    fn validate(&self, input: &str, context: &ValidationContext) -> Result<String, Vec<Issue>> {
        Ok(lexically_resolved(&context.host.cwd.join(input))
            .to_string_lossy()
            .into_owned())
    }
}

/// `path` with `.` dropped and each `..` taking off the component before it, without reading
/// the disk, as the reference's `path.resolve` does.
pub fn lexically_resolved(path: &Path) -> PathBuf {
    let mut resolved = PathBuf::new();
    for component in path.components() {
        match component {
            std::path::Component::CurDir => {}
            std::path::Component::ParentDir => {
                resolved.pop();
            }
            other => resolved.push(other.as_os_str()),
        }
    }
    resolved
}

/// The help plugin's options, which the stand-in declares.
#[derive(Inputs)]
pub struct HelpOptions {
    /// Show help.
    #[option(short = 'h', control)]
    pub help: bool,
}

/// The stand-in for the help plugin: `--help` takes the run over and prints the application's
/// name, and a usage failure of an argv run gains help's hint line.
pub fn help() -> Plugin<HelpOptions> {
    Plugin::new("fixture/help")
        .options::<HelpOptions>()
        .middleware(
            Activation::options(["help"]),
            |context: MiddlewareContext<HelpOptions>, _next: Next| async move {
                context.out.print(&context.graph.name).await
            },
        )
        .on_failure(|failure, context| {
            (failure.is::<UsageError>() && context.invoked_by == InvokedBy::Argv)
                .then(|| format!("Run \"{} --help\" to see the usage.", context.application))
        })
}

/// A plugin that gives the run a verbose mark, spelled `-L`, so a case reads the `-v` lines.
pub fn loud() -> Plugin {
    Plugin::new("fixture/loud").option(
        "loud",
        Opt::count()
            .description("Show more detail.")
            .short('L')
            .control()
            .verbose(),
    )
}

/// What a case declares about the fixture application.
#[derive(Clone, Debug, Default)]
pub struct Declared {
    pub limit_path: Option<String>,
    pub loud: bool,
    pub provided: bool,
    pub schema: SchemaName,
    pub settings: Settings,
    /// Overrides the `InputError` view with its problems as JSON.
    pub view_input: bool,
    /// Hands the plugin no JSON Schema, rather than the one the schema publishes.
    pub schema_value: Option<Map<String, Value>>,
}

fn linked(path: &str) -> [loomcli_core::ExtensionValue<loomcli_core::OptionTarget>; 1] {
    [CONFIG_INPUT.value(ConfigInputFacts::path(path))]
}

/// One option's value as the action reads it, or `None` when the scope does not declare it.
fn read<T: loomcli_core::FromInputValue>(context: &Context, name: &str) -> Option<T> {
    context.option::<T>(name).ok()
}

/// The options the action received, as the reference's `JSON.stringify(options)` writes them: an
/// absent value is left out.
fn options_json(context: &Context) -> Value {
    let mut options = Map::new();
    let text = |name: &str, options: &mut Map<String, Value>| {
        if let Some(Some(value)) = read::<Option<String>>(context, name) {
            options.insert(name.to_owned(), json!(value));
        }
    };
    for name in ["config", "level", "project"] {
        text(name, &mut options);
    }
    for name in ["no-config", "help", "total", "quiet"] {
        if let Some(value) = read::<bool>(context, name) {
            options.insert(name.to_owned(), json!(value));
        }
    }
    for name in ["limit", "title", "owner", "backup", "root"] {
        text(name, &mut options);
    }
    if let Some(fields) = read::<Vec<String>>(context, "fields") {
        options.insert("fields".to_owned(), json!(fields));
    }
    for name in ["verbose", "loud"] {
        if let Some(count) = read::<u32>(context, name) {
            options.insert(name.to_owned(), json!(count));
        }
    }
    Value::Object(options)
}

/// The JSON a problem prints as in the reference, its keys sorted.
pub fn problem_json(problem: &InputProblem) -> Value {
    match problem {
        InputProblem::Group {
            reason,
            inputs,
            spellings,
            supplied,
        } => json!({
            "inputs": inputs,
            "reason": reason,
            "spellings": spellings,
            "supplied": supplied,
        }),
        InputProblem::Invalid {
            input,
            spelling,
            issues,
        } => json!({
            "input": input,
            "issues": issues.iter().map(|issue| json!({ "message": issue.message })).collect::<Vec<_>>(),
            "reason": "invalid",
            "spelling": spelling,
        }),
        InputProblem::Missing { input, spelling } => {
            json!({ "input": input, "reason": "missing", "spelling": spelling })
        }
        _ => Value::Null,
    }
}

/// The application, for the schema type `T`.
pub fn application_of<T>(declared: &Declared, schema: Option<Map<String, Value>>) -> App
where
    T: DeserializeOwned + Serialize + Send + Sync + 'static,
{
    let config = configuration::<T>(declared.settings.apply::<T>(schema));
    let provider: Provider<T> = config.provider;
    let mut plugins: Vec<loomcli_core::AnyPlugin> = vec![config.plugin.into(), help().into()];
    if declared.loud {
        plugins.push(loud().into());
    }
    let limit_path = declared
        .limit_path
        .clone()
        .unwrap_or_else(|| "limits.bytes".to_owned());
    let mut app = Application::new("app").plugins(plugins);
    if declared.provided {
        app = app.uses([&provider]);
    }
    if declared.view_input {
        app = app.overrides([override_view(
            failure::<InputError>(),
            FailureView::new(|failure: &InputError, _| {
                let problems: Vec<Value> = failure.problems().iter().map(problem_json).collect();
                format!("{}\n", Value::Array(problems))
            }),
        )]);
    }
    let provided = declared.provided;
    app.global_option(
        "level",
        Opt::string()
            .description("The log level.")
            .env(["FIXTURE_LEVEL"])
            .extend(linked("log.level")),
    )
    .option(
        "limit",
        Opt::string()
            .default("10")
            .description("The limit.")
            .env(["FIXTURE_LIMIT"])
            .extend(linked(&limit_path))
            .validate(Digits),
    )
    .option(
        "total",
        Opt::boolean()
            .description("Add a total.")
            .extend(linked("total")),
    )
    .option(
        "quiet",
        Opt::boolean()
            .description("Say less.")
            .extend(linked("quiet"))
            .polarity(Polarity::Negative),
    )
    .option(
        "fields",
        Opt::string()
            .description("The fields.")
            .extend(linked("fields"))
            .multiple(),
    )
    .option(
        "title",
        Opt::string()
            .description("The title.")
            .extend(linked("title")),
    )
    // A path named after an Object.prototype member, which only an own key answers.
    .option(
        "owner",
        Opt::string()
            .description("The owner.")
            .extend(linked("constructor")),
    )
    .option(
        "verbose",
        Opt::count()
            .description("Say more.")
            .extend(linked("verbose"))
            .short('v'),
    )
    .option(
        "backup",
        Opt::string()
            .description("How to back up.")
            .extend(linked("backup"))
            .implied("simple"),
    )
    .option(
        "root",
        Opt::string()
            .description("The root folder.")
            .extend(linked("root"))
            .validate(PathValue),
    )
    .action(move |context: Context| {
        let provider = provider.clone();
        async move {
            context
                .out
                .print(&format!("root:{}", options_json(&context)))
                .await?;
            if provided {
                let value = context.provided(&provider)?;
                let text = serde_json::to_string(&*value).map_err(Error::from)?;
                context.out.print(&format!("config:{text}")).await?;
            }
            Ok(())
        }
    })
}

/// The JSON Schema each fixture schema publishes, as the reference's zod schemas convert.
pub fn published(schema: SchemaName) -> Option<Map<String, Value>> {
    let value = match schema {
        SchemaName::Loose | SchemaName::Refined => {
            json!({ "type": "object", "propertyNames": { "type": "string" }, "additionalProperties": {} })
        }
        SchemaName::TopRefined => {
            json!({ "type": "object", "properties": { "mode": { "type": "string" } }, "additionalProperties": {} })
        }
        SchemaName::Typed => json!({
            "type": "object",
            "properties": {
                "mode": { "type": "string", "enum": ["fast", "slow"] },
                "retries": { "default": 3, "type": "integer" },
                "title": { "type": "string" }
            },
            "additionalProperties": {}
        }),
    };
    value.as_object().cloned()
}

/// The application a case declares.
pub fn application(declared: &Declared) -> App {
    let schema = declared
        .schema_value
        .clone()
        .or_else(|| published(declared.schema));
    match declared.schema {
        SchemaName::Loose => application_of::<Loose>(declared, schema),
        SchemaName::Refined => application_of::<Refined>(declared, schema),
        SchemaName::TopRefined => application_of::<TopRefined>(declared, schema),
        SchemaName::Typed => application_of::<Typed>(declared, schema),
    }
}

/// What a run came to: its exit code and what it wrote.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ran {
    pub status: u8,
    pub stdout: String,
    pub stderr: String,
}

impl Ran {
    /// The options the action received, parsed from the one line it prints.
    pub fn received(&self) -> Value {
        let line = self
            .stdout
            .lines()
            .find_map(|line| line.strip_prefix("root:"))
            .unwrap_or_else(|| panic!("the action printed no options: {self:?}"));
        serde_json::from_str(line).unwrap()
    }

    /// The value the action read as the provided configuration.
    pub fn provided(&self) -> Value {
        let line = self
            .stdout
            .lines()
            .find_map(|line| line.strip_prefix("config:"))
            .unwrap_or_else(|| panic!("the action printed no configuration: {self:?}"));
        serde_json::from_str(line).unwrap()
    }
}

/// Every value the action receives when nothing supplies one, help's global option included.
pub fn defaults() -> Value {
    json!({
        "fields": [],
        "help": false,
        "limit": "10",
        "no-config": false,
        "quiet": true,
        "total": false,
        "verbose": 0,
    })
}

/// The defaults with these entries changed or added.
pub fn defaults_with(entries: Value) -> Value {
    let mut value = defaults();
    if let (Some(map), Some(extra)) = (value.as_object_mut(), entries.as_object()) {
        for (key, entry) in extra {
            map.insert(key.clone(), entry.clone());
        }
    }
    value
}

/// The line help adds under every usage failure.
pub const HELP_HINT: &str = "Run \"app --help\" to see the usage.\n";

/// The failure the named file prints for one clause and its fix.
pub fn named_failure(path: &str, clause: &str) -> String {
    format!("app: Option \"--config\": File \"{path}\" {clause}\n{HELP_HINT}")
}

/// The warning a discovered file prints for one clause and its fix.
pub fn skipped(file: &str, clause: &str) -> String {
    format!("⚠ Skipped {file}: the file {clause}\n")
}

/// The warning a directory with several present candidates prints.
pub fn several(files: &str, chosen: &str) -> String {
    format!(
        "⚠ Skipped {files}: {chosen} matches the same pattern first. Keep one of the files, and remove the others.\n"
    )
}

/// The `-v` lines a value the option cannot take writes, one per line given.
pub fn wrong(lines: &[&str]) -> String {
    lines.iter().map(|line| format!("› {line}\n")).collect()
}

/// The notice line a run with no file writes.
pub fn notice(file: &str) -> String {
    format!("ℹ Found no configuration file. Create {file} to configure app.\n")
}

pub fn invalid_json(at: &str) -> String {
    format!(
        "is not valid JSON at {at}, so this run reads no configuration. Correct its syntax, or remove it."
    )
}

pub const NOT_OBJECT: &str = "does not hold a JSON object, so this run reads no configuration. Write its settings as one JSON object, or remove it.";

pub fn invalid_toml(at: &str) -> String {
    format!(
        "is not valid TOML at {at}, so this run reads no configuration. Correct its syntax, or remove it."
    )
}

pub fn invalid_yaml(at: &str) -> String {
    format!(
        "is not valid YAML at {at}, so this run reads no configuration. Correct its syntax, or remove it."
    )
}

pub const NOT_MAPPING: &str = "does not hold a YAML mapping, so this run reads no configuration. Write its settings as one YAML mapping, or remove it.";

/// `JSON.stringify` of a value.
pub fn json_text(value: &Value) -> String {
    value.to_string()
}

/// One run's facts beyond the declared application.
#[derive(Clone, Debug)]
pub struct Run {
    pub argv: Vec<String>,
    pub cwd: PathBuf,
    pub ceiling: PathBuf,
    /// The home folder, or `None` for one that is unset, empty, or relative.
    pub home: Option<PathBuf>,
    pub env: Vec<(String, String)>,
    pub columns: Option<u16>,
    pub declared: Declared,
}

impl Run {
    pub fn arg(mut self, words: &[&str]) -> Self {
        self.argv = words.iter().map(|word| (*word).to_owned()).collect();
        self
    }

    pub fn cwd(mut self, cwd: &Path) -> Self {
        self.cwd = cwd.to_path_buf();
        self
    }

    pub fn home(mut self, home: Option<&Path>) -> Self {
        self.home = home.map(Path::to_path_buf);
        self
    }

    pub fn env(mut self, name: &str, value: &str) -> Self {
        self.env.push((name.to_owned(), value.to_owned()));
        self
    }

    pub fn settings(mut self, settings: Settings) -> Self {
        self.declared.settings = settings;
        self
    }

    pub fn loud(mut self) -> Self {
        self.declared.loud = true;
        self
    }

    pub fn limit_path(mut self, path: &str) -> Self {
        self.declared.limit_path = Some(path.to_owned());
        self
    }

    pub fn columns(mut self, columns: u16) -> Self {
        self.columns = Some(columns);
        self
    }

    /// The schema named, the provided value printed, and `-v` lines shown.
    pub fn shown(mut self, schema: SchemaName) -> Self {
        self.declared.schema = schema;
        self.declared.provided = true;
        self.declared.loud = true;
        self
    }

    pub fn schema(mut self, schema: SchemaName) -> Self {
        self.declared.schema = schema;
        self
    }

    pub fn view_input(mut self) -> Self {
        self.declared.view_input = true;
        self
    }

    fn fields(&self) -> MockFields {
        let mut fields = MockFields::new()
            .argv(self.argv.iter().cloned())
            .cwd(&self.cwd)
            .ceiling(&self.ceiling)
            .home(self.home.clone().unwrap_or_default());
        for (name, value) in &self.env {
            fields = fields.env(name, value);
        }
        if let Some(columns) = self.columns {
            fields = fields.terminal(MockTerminal::new(columns, 24));
        }
        fields
    }

    /// Runs the case.
    pub async fn ran(&self) -> Ran {
        let process = mock_process(self.fields());
        let code = application(&self.declared)
            .run(RunOptions::new().process(Arc::clone(&process) as Arc<dyn ProcessHandle>))
            .await;
        Ran {
            status: code.get(),
            stdout: process.stdout_text(),
            stderr: process.stderr_text(),
        }
    }

    pub async fn stdout(&self) -> String {
        self.ran().await.stdout
    }

    pub async fn stderr(&self) -> String {
        self.ran().await.stderr
    }

    pub async fn received(&self) -> Value {
        self.ran().await.received()
    }

    /// Runs the root by name with these values, and answers the exit code, stdout, and stderr.
    pub async fn invoked(&self, values: InvocationValues) -> (Option<u8>, String, String) {
        let process = mock_process(self.fields());
        let outcome = application(&self.declared)
            .invoke(
                &[],
                values,
                InvokeOptions::new(),
                Some(process as Arc<dyn ProcessHandle>),
            )
            .await;
        match outcome {
            InvocationOutcome::Completed {
                output, messages, ..
            } => (None, output, messages),
            InvocationOutcome::Failed {
                exit_code,
                output,
                messages,
                ..
            } => (Some(exit_code.get()), output, messages),
            other => panic!(
                "the invocation was cancelled: {:?}",
                matches!(other, InvocationOutcome::Cancelled { .. })
            ),
        }
    }
}

/// One temporary workspace per test: a project directory the host's `cwd` points at, a home
/// directory, and a directory elsewhere, all inside a root the test removes when it ends.
pub struct Workspace {
    pub root: PathBuf,
    pub project: PathBuf,
    pub home: PathBuf,
    pub elsewhere: PathBuf,
}

static COUNTER: AtomicUsize = AtomicUsize::new(0);

impl Workspace {
    pub fn new() -> Self {
        let unique = format!(
            "loom-config-{}-{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        );
        // The lookup resolves `..` out of the paths it names, as the reference's `path.resolve`
        // does, so the sandbox root is resolved the same way: a target directory such as
        // `../.scratch/target` would otherwise leave `rust/..` in the expected messages.
        let root = lexically_resolved(&Path::new(env!("CARGO_TARGET_TMPDIR")).join(unique));
        let project = root.join("project");
        let home = root.join("home");
        let elsewhere = root.join("elsewhere");
        for directory in [&project, &home, &elsewhere] {
            std::fs::create_dir_all(directory).unwrap();
        }
        Self {
            root,
            project,
            home,
            elsewhere,
        }
    }

    /// A run of no words in the project, with the workspace's home.
    pub fn run(&self) -> Run {
        Run {
            argv: Vec::new(),
            cwd: self.project.clone(),
            ceiling: self.root.clone(),
            home: Some(self.home.clone()),
            env: Vec::new(),
            columns: None,
            declared: Declared::default(),
        }
    }

    /// Writes one file under the project, creating its directories, and answers its path.
    pub fn write(&self, relative: &str, content: &str) -> PathBuf {
        self.write_in(&self.project, relative, content)
    }

    /// Writes one file under a base, creating its directories, and answers its path.
    pub fn write_in(&self, base: &Path, relative: &str, content: &str) -> PathBuf {
        let path = base.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, content).unwrap();
        path
    }

    /// A nested directory under a base, created.
    pub fn nest(&self, base: &Path, segments: &[&str]) -> PathBuf {
        let directory = segments
            .iter()
            .fold(base.to_path_buf(), |path, segment| path.join(segment));
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }
}

impl Drop for Workspace {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.root);
    }
}

/// A path as a message shows it.
pub fn shown(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

/// The message a panic carried.
pub fn panic_message(payload: &(dyn std::any::Any + Send)) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|text| (*text).to_owned())
        })
        .unwrap_or_default()
}

/// Whether a function panics, and with what message.
pub fn panics<R>(call: impl FnOnce() -> R + std::panic::UnwindSafe) -> Option<String> {
    std::panic::catch_unwind(call)
        .err()
        .map(|payload| panic_message(payload.as_ref()))
}
