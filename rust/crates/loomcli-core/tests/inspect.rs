//! Graph inspection, ported from the reference's `inspect.test.ts` and its `inspect.mjs` fixture.
//!
//! Each expected document is the JSON `JSON.stringify(app.inspect())` writes for the fixture's
//! graph: the values the reference test asserts, with the keys in the order the reference's
//! `inspect.ts` builds each node.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use loomcli_core::{
    Application, Arg, Command, Context, DeclarationError, FailureFacts, Issue, OmissionValidator,
    Opt, Polarity, ResultViews, RowView, RowViews, ValidationContext, Validator, View,
};

/// The fixture's `digits`: decimal digits, read as a number. It publishes no input schema.
#[derive(Clone)]
struct Digits;

impl Validator for Digits {
    type Output = u64;

    fn validate(&self, input: &str, _context: &ValidationContext) -> Result<u64, Vec<Issue>> {
        input
            .parse()
            .map_err(|_| vec![Issue::new("Use decimal digits.")])
    }
}

impl OmissionValidator for Digits {
    fn validate_omission(&self, _context: &ValidationContext) -> Result<u64, Vec<Issue>> {
        Ok(0)
    }
}

async fn dispatch(_context: Context) -> loomcli_core::Outcome {
    Ok(())
}

fn jsonkit(version: Option<&str>) -> Application {
    let get = Command::new("get")
        .argument("path", Arg::string().required())
        .action(dispatch);
    let keys = Command::new("keys")
        .argument("path", Arg::string())
        .action(dispatch);
    let select = Command::new("select")
        .option("field", Opt::string().multiple().required().short('F'))
        .action(dispatch);
    let application = Application::new("jsonkit");
    let application = match version {
        Some(version) => application.version(version),
        None => application,
    };
    application
        .global_option("file", Opt::string().short('f'))
        .global_option("quiet", Opt::boolean().short('q'))
        .command(get)
        .command(keys)
        .command(select)
        .action(dispatch)
}

fn json(application: &Application) -> String {
    let graph = application.inspect().expect("the graph builds");
    serde_json::to_string(&graph).expect("the graph serializes")
}

fn root_json(application: &Application, field: &str) -> String {
    let graph = application.inspect().expect("the graph builds");
    let root = serde_json::to_value(&graph.root).expect("the root serializes");
    serde_json::to_string(&root[field]).expect("the field serializes")
}

const JSONKIT: &str = concat!(
    r#"{"configuration":null,"globals":["#,
    r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--file","name":"file","short":"-f","envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"background":false,"envAllowEmpty":false,"type":"string"},"#,
    r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--quiet","name":"quiet","short":"-q","color":false,"interaction":false,"negative":null,"plain":false,"polarity":"positive","schema":null,"type":"boolean"}"#,
    r#"],"name":"jsonkit","root":{"optionGroups":[],"passthrough":null,"aliases":[],"arguments":[],"children":["#,
    r#"{"optionGroups":[],"passthrough":null,"aliases":[],"arguments":[{"extensions":{},"name":"path","required":true,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"variadic":false}],"children":[],"extensions":{},"hasAction":true,"hidden":false,"name":"get","needsTerminal":false,"options":[],"path":["get"],"result":null},"#,
    r#"{"optionGroups":[],"passthrough":null,"aliases":[],"arguments":[{"extensions":{},"name":"path","required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"variadic":false}],"children":[],"extensions":{},"hasAction":true,"hidden":false,"name":"keys","needsTerminal":false,"options":[],"path":["keys"],"result":null},"#,
    r#"{"optionGroups":[],"passthrough":null,"aliases":[],"arguments":[],"children":[],"extensions":{},"hasAction":true,"hidden":false,"name":"select","needsTerminal":false,"options":[{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--field","name":"field","short":"-F","envDelimiter":null,"implied":null,"multiple":true,"required":true,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"background":false,"envAllowEmpty":false,"type":"string"}],"path":["select"],"result":null}"#,
    r#"],"extensions":{},"hasAction":true,"hidden":false,"name":null,"needsTerminal":false,"options":[],"path":[],"result":null},"version":"0.0.0"}"#,
);

#[test]
fn inspects_a_graph_of_globals_a_root_action_and_three_children() {
    assert_eq!(json(&jsonkit(None)), JSONKIT);
}

#[test]
fn an_explicit_version_of_0_0_0_inspects_identically_to_an_omitted_version() {
    assert_eq!(json(&jsonkit(Some("0.0.0"))), json(&jsonkit(None)));
}

#[test]
fn reports_the_version_and_every_declared_description_and_the_root_reports_the_graph_one() {
    let get = Command::new("get")
        .description("Reads one value.")
        .argument(
            "path",
            Arg::string().description("The path to read.").required(),
        )
        .option(
            "raw",
            Opt::boolean().description("Prints the value unquoted."),
        )
        .action(dispatch);
    let application = Application::new("described")
        .description("Reads a JSON document.")
        .version("1.2.0")
        .global_option(
            "file",
            Opt::string()
                .description("The document to read.")
                .short('f'),
        )
        .command(get)
        .action(dispatch);
    assert_eq!(
        json(&application),
        concat!(
            r#"{"configuration":null,"description":"Reads a JSON document.","globals":["#,
            r#"{"aliases":[],"control":false,"description":"The document to read.","env":[],"extensions":{},"hidden":false,"long":"--file","name":"file","short":"-f","envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"background":false,"envAllowEmpty":false,"type":"string"}"#,
            r#"],"name":"described","root":{"optionGroups":[],"passthrough":null,"aliases":[],"arguments":[],"children":["#,
            r#"{"optionGroups":[],"passthrough":null,"aliases":[],"arguments":[{"description":"The path to read.","extensions":{},"name":"path","required":true,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"variadic":false}],"children":[],"description":"Reads one value.","extensions":{},"hasAction":true,"hidden":false,"name":"get","needsTerminal":false,"options":["#,
            r#"{"aliases":[],"control":false,"description":"Prints the value unquoted.","env":[],"extensions":{},"hidden":false,"long":"--raw","name":"raw","short":null,"color":false,"interaction":false,"negative":null,"plain":false,"polarity":"positive","schema":null,"type":"boolean"}"#,
            r#"],"path":["get"],"result":null}],"description":"Reads a JSON document.","extensions":{},"hasAction":true,"hidden":false,"name":null,"needsTerminal":false,"options":[],"path":[],"result":null},"version":"1.2.0"}"#,
        )
    );
}

#[test]
fn reports_hidden_and_deprecated_on_every_command_and_option_and_neither_on_the_root() {
    let fetch = Command::new("fetch")
        .deprecated("Use get instead.")
        .option(
            "raw",
            Opt::string().deprecated("Use --plain instead.").hidden(),
        )
        .action(dispatch);
    let debug = Command::new("debug").hidden().action(dispatch);
    let application = Application::new("listing")
        .global_option(
            "file",
            Opt::string().deprecated("Use --path instead.").short('f'),
        )
        .global_option("quiet", Opt::boolean().hidden())
        .command(fetch)
        .command(debug)
        .action(dispatch);
    assert_eq!(
        json(&application),
        concat!(
            r#"{"configuration":null,"globals":["#,
            r#"{"aliases":[],"control":false,"deprecated":"Use --path instead.","env":[],"extensions":{},"hidden":false,"long":"--file","name":"file","short":"-f","envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"background":false,"envAllowEmpty":false,"type":"string"},"#,
            r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":true,"long":"--quiet","name":"quiet","short":null,"color":false,"interaction":false,"negative":null,"plain":false,"polarity":"positive","schema":null,"type":"boolean"}"#,
            r#"],"name":"listing","root":{"optionGroups":[],"passthrough":null,"aliases":[],"arguments":[],"children":["#,
            r#"{"optionGroups":[],"passthrough":null,"aliases":[],"arguments":[],"children":[],"deprecated":"Use get instead.","extensions":{},"hasAction":true,"hidden":false,"name":"fetch","needsTerminal":false,"options":["#,
            r#"{"aliases":[],"control":false,"deprecated":"Use --plain instead.","env":[],"extensions":{},"hidden":true,"long":"--raw","name":"raw","short":null,"envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"background":false,"envAllowEmpty":false,"type":"string"}"#,
            r#"],"path":["fetch"],"result":null},"#,
            r#"{"optionGroups":[],"passthrough":null,"aliases":[],"arguments":[],"children":[],"extensions":{},"hasAction":true,"hidden":true,"name":"debug","needsTerminal":false,"options":[],"path":["debug"],"result":null}"#,
            r#"],"extensions":{},"hasAction":true,"hidden":false,"name":null,"needsTerminal":false,"options":[],"path":[],"result":null},"version":"0.0.0"}"#,
        )
    );
}

#[test]
fn inspects_a_group_at_two_named_levels_below_the_root() {
    let clear = Command::new("clear").action(dispatch);
    let list = Command::new("list").alias("ls").alias("l").action(dispatch);
    let cache = Command::new("cache")
        .alias("c")
        .command(clear)
        .command(list);
    let application = Application::new("store").command(cache).action(dispatch);
    assert_eq!(
        json(&application),
        concat!(
            r#"{"configuration":null,"globals":[],"name":"store","root":{"optionGroups":[],"passthrough":null,"aliases":[],"arguments":[],"children":["#,
            r#"{"optionGroups":[],"passthrough":null,"aliases":["c"],"arguments":[],"children":["#,
            r#"{"optionGroups":[],"passthrough":null,"aliases":[],"arguments":[],"children":[],"extensions":{},"hasAction":true,"hidden":false,"name":"clear","needsTerminal":false,"options":[],"path":["cache","clear"],"result":null},"#,
            r#"{"optionGroups":[],"passthrough":null,"aliases":["ls","l"],"arguments":[],"children":[],"extensions":{},"hasAction":true,"hidden":false,"name":"list","needsTerminal":false,"options":[],"path":["cache","list"],"result":null}"#,
            r#"],"extensions":{},"hasAction":false,"hidden":false,"name":"cache","needsTerminal":false,"options":[],"path":["cache"],"result":null}"#,
            r#"],"extensions":{},"hasAction":true,"hidden":false,"name":null,"needsTerminal":false,"options":[],"path":[],"result":null},"version":"0.0.0"}"#,
        )
    );
}

#[test]
fn reports_the_declared_result_on_every_command_and_null_where_none_is_declared() {
    type Value = serde_json::Value;
    let count = Command::new("count")
        .result(ResultViews::new().view("table", View::new(|value: &Value, _| value.to_string())))
        .action(|_| async { Ok(()) });
    let paths = Command::new("paths")
        .rows(
            RowViews::new()
                .view("list", RowView::new(|row: &Value, _, _| row.to_string()))
                .view(
                    "table",
                    View::<[Value]>::new(|rows, _| rows.len().to_string()),
                ),
        )
        .views(
            RowViews::new()
                .view(
                    "wide",
                    View::<[Value]>::new(|rows, _| format!("{} rows", rows.len())),
                )
                .default_view("wide"),
        )
        .action(|_| async { Ok(()) });
    let plain = Command::new("plain").action(dispatch);
    let application = Application::new("results")
        .command(count)
        .command(paths)
        .command(plain)
        .action(dispatch);
    let graph = application.inspect().expect("the graph builds");
    let results: Vec<String> = graph
        .root
        .children
        .iter()
        .map(|child| serde_json::to_string(&child.result).expect("serializes"))
        .collect();
    assert_eq!(
        results,
        [
            r#"{"default":"table","kind":"value","mediaTypes":{"table":null},"views":["table"]}"#,
            // The names keep their record order; the later views() call appended one name and
            // moved the default to it.
            r#"{"default":"wide","kind":"rows","mediaTypes":{"list":null,"table":null,"wide":null},"views":["list","table","wide"]}"#,
            "null",
        ]
    );
    assert!(graph.root.result.is_none());
}

#[test]
fn reports_the_accepted_spellings_of_each_polarity_and_of_a_short_only_option() {
    let application = Application::new("flags")
        .option("total", Opt::boolean().polarity(Polarity::Both).short('t'))
        .option("color", Opt::boolean())
        .option("cache", Opt::boolean().polarity(Polarity::Negative))
        .option("mode", Opt::string().short('m').short_only())
        .action(dispatch);
    assert_eq!(
        root_json(&application, "options"),
        concat!(
            r#"[{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--total","name":"total","short":"-t","color":false,"interaction":false,"negative":"--no-total","plain":false,"polarity":"both","schema":null,"type":"boolean"},"#,
            r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--color","name":"color","short":null,"color":false,"interaction":false,"negative":null,"plain":false,"polarity":"positive","schema":null,"type":"boolean"},"#,
            r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":null,"name":"cache","short":null,"color":false,"interaction":false,"negative":"--no-cache","plain":false,"polarity":"negative","schema":null,"type":"boolean"},"#,
            r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":null,"name":"mode","short":"-m","envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"background":false,"envAllowEmpty":false,"type":"string"}]"#,
        )
    );
}

#[test]
fn reads_each_spelling_role_from_the_table_including_a_name_that_begins_with_no() {
    let application = Application::new("roles")
        .option(
            "no-color",
            Opt::boolean().polarity(Polarity::Both).short('n'),
        )
        .option("field", Opt::string().multiple().short('F').short_only())
        .action(dispatch);
    assert_eq!(
        root_json(&application, "options"),
        concat!(
            r#"[{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--no-color","name":"no-color","short":"-n","color":false,"interaction":false,"negative":"--no-no-color","plain":false,"polarity":"both","schema":null,"type":"boolean"},"#,
            r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":null,"name":"field","short":"-F","envDelimiter":null,"implied":null,"multiple":true,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"background":false,"envAllowEmpty":false,"type":"string"}]"#,
        )
    );
}

#[test]
fn wraps_a_declared_default_and_leaves_an_undeclared_one_undefined() {
    let application = Application::new("defaults")
        .option("depth", Opt::string().default("1"))
        .option("limit", Opt::string().validate(Digits))
        .option("plain", Opt::string())
        .argument("path", Arg::string().default("root"))
        .action(dispatch);
    assert_eq!(
        root_json(&application, "options"),
        concat!(
            r#"[{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--depth","name":"depth","short":null,"default":{"value":"1"},"envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"background":false,"envAllowEmpty":false,"type":"string"},"#,
            r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--limit","name":"limit","short":null,"envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":true,"background":false,"envAllowEmpty":false,"type":"string"},"#,
            r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--plain","name":"plain","short":null,"envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"background":false,"envAllowEmpty":false,"type":"string"}]"#,
        )
    );
    assert_eq!(
        root_json(&application, "arguments"),
        r#"[{"default":{"value":"root"},"extensions":{},"name":"path","required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"variadic":false}]"#,
    );
}

#[test]
fn reports_the_option_and_the_argument_that_validate_their_own_omission() {
    let application = Application::new("omission")
        .option("file", Opt::string().validate_omitted(Digits))
        .option("size", Opt::string().validate(Digits))
        .argument("path", Arg::string().validate_omitted(Digits))
        .action(dispatch);
    assert_eq!(
        root_json(&application, "options"),
        concat!(
            r#"[{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--file","name":"file","short":null,"envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":true,"validated":true,"background":false,"envAllowEmpty":false,"type":"string"},"#,
            r#"{"aliases":[],"control":false,"env":[],"extensions":{},"hidden":false,"long":"--size","name":"size","short":null,"envDelimiter":null,"implied":null,"multiple":false,"required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":true,"background":false,"envAllowEmpty":false,"type":"string"}]"#,
        )
    );
    assert_eq!(
        root_json(&application, "arguments"),
        r#"[{"extensions":{},"name":"path","required":false,"requiredWhen":null,"schema":null,"validateOmitted":true,"validated":true,"variadic":false}]"#,
    );
}

#[test]
fn throws_a_declaration_error_a_consumer_catches_by_class_without_run() {
    let fault: DeclarationError = Application::new("invalid")
        .inspect()
        .expect_err("a root with neither children nor an action is a build fault");
    assert_eq!(
        fault.rule().map(|rule| rule.identity()),
        Some("@loomcli/core/command-without-action")
    );
    assert_eq!(fault.sentence(), "The root Command has no action.");
    assert!(fault.message().ends_with("\n\nRegister an action."));
}

#[test]
fn reports_an_optional_variadic_argument_with_its_declared_default() {
    let application = Application::new("tails")
        .argument("files", Arg::string().variadic().default(["a"]))
        .action(dispatch);
    assert_eq!(
        root_json(&application, "arguments"),
        r#"[{"default":{"value":["a"]},"extensions":{},"name":"files","required":false,"requiredWhen":null,"schema":null,"validateOmitted":false,"validated":false,"variadic":true}]"#,
    );
}

#[test]
fn inspect_leaves_a_default_that_only_its_validator_rejects_to_run() {
    let application = Application::new("faults")
        .option("depth", Opt::string().default("deep").validate(Digits))
        .action(dispatch);
    assert!(application.inspect().is_ok());
    assert!(application.check().is_empty());
    assert_eq!(
        distributed_run(&application),
        (
            1,
            String::new(),
            "faults: Something went wrong.\n".to_owned()
        )
    );
}

/// One run of `application` with no words in a distributed build: its code, stdout, and stderr.
fn distributed_run<I, R, S: loomcli_core::State>(
    application: &Application<I, R, S>,
) -> (u8, String, String) {
    let process = loomcli_testing::mock_process(loomcli_testing::MockFields::new().release(
        loomcli_core::ReleaseFacts::new(loomcli_core::Build::Distributed),
    ));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let code =
        runtime
            .block_on(application.run(
                loomcli_core::RunOptions::new().process(std::sync::Arc::clone(&process) as _),
            ));
    (code.get(), process.stdout_text(), process.stderr_text())
}

#[test]
fn run_still_reports_a_build_fault_with_code_1() {
    assert_eq!(
        distributed_run(&Application::new("invalid")),
        (
            1,
            String::new(),
            "invalid: Something went wrong.\n".to_owned()
        )
    );
}

#[test]
fn keeps_the_graph_on_each_call() {
    let application = jsonkit(None);
    let first = application.inspect().expect("the graph builds");
    let second = application.inspect().expect("the graph builds");
    assert_eq!(first, second);
    assert!(std::sync::Arc::ptr_eq(&first, &second));
    assert_eq!(
        first.command(&["select"]).map(|node| node.path.clone()),
        Some(vec!["select".to_owned()])
    );
}
