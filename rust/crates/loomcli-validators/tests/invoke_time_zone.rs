//! The `invoke-time-zone.test.ts` cases through the `date_time()` validator.

#![allow(clippy::unwrap_used, clippy::panic)]

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};

use jiff::Timestamp;
use loomcli_core::{
    Application, Arg, Command, Context, InvocationOutcome, InvocationValues, InvokeOptions, Opt,
    Outcome, ProcessFields, ProcessHandle, RunOptions, ValidationContext, Validator,
    process_handle, resolve_time_zone,
};
use loomcli_testing::{MockFields, mock_process};
use loomcli_validators::{create_validator, date_time};

const TOKEN: &str = "2026-09-25T14:30:00";
const UTC: &str = "UTC 2026-09-25T14:30:00.000Z\n";
const TOKYO: &str = "Asia/Tokyo 2026-09-25T05:30:00.000Z\n";
const NEW_YORK: &str = "America/New_York 2026-09-25T18:30:00.000Z\n";

fn instant() -> Command {
    instant_with("instant", date_time())
}

fn instant_with(name: &str, validator: loomcli_validators::DateTime) -> Command {
    Command::new(name)
        .argument("at", Arg::string().required().validate(validator))
        .action(|ctx: Context| async move {
            let at = ctx.argument::<Option<Timestamp>>("at")?.unwrap();
            ctx.out
                .print(&format!("{} {at:.3}", ctx.host.time_zone()))
                .await
        })
}

fn completed(outcome: InvocationOutcome) -> String {
    let InvocationOutcome::Completed {
        output, messages, ..
    } = outcome
    else {
        panic!("expected completed invoke: {outcome:?}");
    };
    assert!(messages.is_empty(), "{messages}");
    output
}

#[tokio::test]
async fn named_zones_use_system_rules_with_a_bundled_fallback() {
    const CHILD: &str = "LOOMCLI_TEST_NAMED_ZONES_CHILD";
    if std::env::var_os(CHILD).is_some() {
        check_named_zones().await;
        return;
    }

    // A TZif v1 file with one local time type (+02:00) and no transitions.
    const TZIF: &[u8] = b"TZif\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\
        \0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\x01\0\0\0\x04\
        \0\0\x1c\x20\0\0TST\0";
    let database = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../.scratch")
        .join(format!("named-zones-{}", std::process::id()));
    std::fs::create_dir_all(database.join("Asia")).unwrap();
    for name in ["Asia/TOKYO", "localtime", "posixrules"] {
        std::fs::write(database.join(name), TZIF).unwrap();
    }

    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "named_zones_use_system_rules_with_a_bundled_fallback",
        ])
        .env_clear()
        .env(CHILD, "1")
        .env("TZDIR", &database)
        .env("TZ", ":asia/tokyo")
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr),
    );
}

async fn check_named_zones() {
    for name in [
        "LocalTime",
        "posixrules",
        "factory",
        "Canada/East-Saskatchewan",
        "US/Pacific-New",
    ] {
        assert_eq!(resolve_time_zone(name), None, "{name}");
    }
    let zone = process_handle(ProcessFields::new()).time_zone();
    assert_eq!(zone, "Asia/TOKYO");
    let process = mock_process(MockFields::new().time_zone(zone));
    let app = Application::new("clock")
        .command(instant())
        .command(instant_with("pinned", date_time().time_zone("us/eastern")));
    const SYSTEM: &str = "Asia/TOKYO 2026-09-25T12:30:00.000Z\n";
    for (command, name, expected) in [
        ("instant", None, SYSTEM),
        ("instant", Some("aSiA/toKyO"), SYSTEM),
        (
            "instant",
            Some("us/eastern"),
            "US/Eastern 2026-09-25T18:30:00.000Z\n",
        ),
        ("instant", Some("America/New_York"), NEW_YORK),
        ("pinned", Some("America/New_York"), NEW_YORK),
    ] {
        let mut options = InvokeOptions::new();
        if let Some(name) = name {
            options = options.time_zone(name);
        }
        let outcome = app
            .invoke(
                &[command],
                InvocationValues::new().arg("at", TOKEN),
                options,
                Some(process.clone()),
            )
            .await;
        assert_eq!(completed(outcome), expected);
    }
}

#[tokio::test]
async fn app_invoke_places_a_zone_less_token_in_its_own_zone() {
    let process = mock_process(MockFields::new().time_zone("UTC"));
    let app = Application::new("clock").command(instant());
    for (options, expected) in [
        (InvokeOptions::new().time_zone("Asia/Tokyo"), TOKYO),
        (InvokeOptions::new(), UTC),
    ] {
        let outcome = app
            .invoke(
                &["instant"],
                InvocationValues::new().arg("at", TOKEN),
                options,
                Some(process.clone()),
            )
            .await;
        assert_eq!(completed(outcome), expected);
        assert_eq!(process.time_zone(), "UTC");
    }
    assert_eq!(process.stdout_text(), "");
    assert_eq!(process.stderr_text(), "");
}

#[tokio::test]
async fn a_nested_invocation_inherits_the_zone_and_leaves_the_outer_run_unchanged() {
    let app = Application::new("clock")
        .command(instant())
        .command(Command::new("bridge").action(|ctx: Context| async move {
            let outcome = ctx
                .invoke(
                    &["instant"],
                    InvocationValues::new().arg("at", TOKEN),
                    InvokeOptions::new(),
                )
                .await;
            ctx.out.print(completed(outcome).trim_end()).await
        }))
        .action(|ctx: Context| async move {
            assert_eq!(ctx.host.time_zone(), "UTC");
            let outcome = ctx
                .invoke(
                    &["bridge"],
                    InvocationValues::new(),
                    InvokeOptions::new().time_zone("Asia/Tokyo"),
                )
                .await;
            assert_eq!(ctx.host.time_zone(), "UTC");
            ctx.out.print(completed(outcome).trim_end()).await
        });
    let process = mock_process(MockFields::new().time_zone("UTC"));
    assert_eq!(
        app.run(RunOptions::new().process(process.clone()))
            .await
            .get(),
        0
    );
    assert_eq!(process.stdout_text(), TOKYO);
    assert_eq!(process.stderr_text(), "");
}

fn counting_date_time(validations: &Arc<AtomicUsize>) -> impl Validator<Output = Timestamp> {
    let validations = validations.clone();
    let base = date_time();
    create_validator(move |value: &str, context: &ValidationContext| {
        validations.fetch_add(1, Ordering::Relaxed);
        base.validate(value, context)
    })
}

async fn stamp(ctx: Context) -> Outcome {
    let at = ctx.option::<Option<Timestamp>>("at")?.unwrap();
    ctx.out
        .print(&format!("{} {at:.3}", ctx.host.time_zone()))
        .await
}

#[tokio::test]
async fn a_changed_zone_revalidates_defaults_and_implied_values() {
    let validations = Arc::new(AtomicUsize::new(0));
    let validator = counting_date_time(&validations);
    let bridge_validations = validations.clone();
    let app = Application::new("clock")
        .command(
            Command::new("stamp")
                .option(
                    "at",
                    Opt::string()
                        .default(TOKEN)
                        .implied(TOKEN)
                        .validate(validator),
                )
                .action(stamp),
        )
        .command(Command::new("bridge").action(move |ctx: Context| {
            let validations = bridge_validations.clone();
            async move {
                assert_eq!(validations.load(Ordering::Relaxed), 4);
                for (values, options, count) in [
                    (
                        InvocationValues::new().option("at", true),
                        InvokeOptions::new().time_zone("Asia/Tokyo"),
                        4,
                    ),
                    (
                        InvocationValues::new(),
                        InvokeOptions::new().time_zone("America/New_York"),
                        6,
                    ),
                    (InvocationValues::new(), InvokeOptions::new(), 6),
                ] {
                    let outcome = ctx.invoke(&["stamp"], values, options).await;
                    assert_eq!(validations.load(Ordering::Relaxed), count);
                    ctx.out.print(completed(outcome).trim_end()).await?;
                }
                Ok(())
            }
        }))
        .action(move |ctx: Context| {
            let validations = validations.clone();
            async move {
                assert_eq!(validations.load(Ordering::Relaxed), 2);
                let outcome = ctx
                    .invoke(
                        &["bridge"],
                        InvocationValues::new(),
                        InvokeOptions::new().time_zone("Asia/Tokyo"),
                    )
                    .await;
                ctx.out.print(completed(outcome).trim_end()).await
            }
        });
    let outcome = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new().time_zone("UTC"))),
        )
        .await;
    assert_eq!(completed(outcome), [TOKYO, NEW_YORK, TOKYO].concat());
}

async fn check_alias_reuse(parent: &'static str, nested: &'static str, instant: &str) {
    let validations = Arc::new(AtomicUsize::new(0));
    let validator = counting_date_time(&validations);
    let app = Application::new("clock")
        .command(
            Command::new("stamp")
                .option("at", Opt::string().default(TOKEN).validate(validator))
                .action(|ctx: Context| async move {
                    let at = ctx.option::<Option<Timestamp>>("at")?.unwrap();
                    ctx.out.print(&format!("{at:.3}")).await
                }),
        )
        .action(move |ctx: Context| {
            let validations = validations.clone();
            async move {
                assert_eq!(validations.load(Ordering::Relaxed), 1);
                let same_spelling = resolve_time_zone(parent) == resolve_time_zone(nested);
                let outcome = ctx
                    .invoke(
                        &["stamp"],
                        InvocationValues::new(),
                        InvokeOptions::new().time_zone(nested),
                    )
                    .await;
                assert_eq!(
                    validations.load(Ordering::Relaxed),
                    if same_spelling { 1 } else { 2 }
                );
                ctx.out.print(completed(outcome).trim_end()).await
            }
        });
    let outcome = app
        .invoke(
            &[],
            InvocationValues::new(),
            InvokeOptions::new(),
            Some(mock_process(MockFields::new().time_zone(parent))),
        )
        .await;
    assert_eq!(completed(outcome), instant);
}

#[tokio::test]
async fn an_alias_reuses_declared_values_when_the_resolved_spelling_matches() {
    check_alias_reuse(
        "US/Eastern",
        "America/New_York",
        "2026-09-25T18:30:00.000Z\n",
    )
    .await;
}
