//! A tool call's progress notifications, ported from the reference's `mcp.test.ts` (`progress`)
//! with its `progress` fixture application, and from `mcp-progress.test.ts`, whose message and
//! relay cases run here through regions a tool reports on.

#![cfg(feature = "mcp")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod mcp_support;

use loomcli_core::{
    Application, Command, Context, Done, NoInputs, NoResult, ProgressReport, RegionOptions,
};
use loomcli_plugins::mcp::extension::{MCP_COMMAND, McpCommandFacts};
use loomcli_plugins::mcp::mcp;
use loomcli_prompts::{ProgressSettings, ProgressUpdate, progress};
use mcp_support::{Observed, cancelled, meta, request, serve};
use serde_json::{Value, json};

type App = Application<NoInputs, NoResult, Done>;

fn opted() -> loomcli_core::ExtensionValue<loomcli_core::CommandTarget> {
    MCP_COMMAND.value(McpCommandFacts::new())
}

/// Tools whose actions report progress, through progress lines and through regions drawn by hand.
fn progress_app(observed: &Observed) -> App {
    let counted = Command::new("counted")
        .description("Count three records.")
        .extend([opted()])
        .action(|ctx: Context| async move {
            let line = progress(&ctx, ProgressSettings::new("Fetching records").total(3.0));
            for completed in [1.0, 2.0, 3.0] {
                line.update(ProgressUpdate::new().completed(completed));
            }
            line.end().await
        });
    let spinner = Command::new("spinner")
        .description("Spin once.")
        .extend([opted()])
        .action(|ctx: Context| async move {
            let line = progress(&ctx, ProgressSettings::new("Building the index"));
            line.update(ProgressUpdate::new().label("Writing the index"));
            line.end().await
        });
    let finished = Command::new("finished")
        .description("End with a message.")
        .extend([opted()])
        .action(|ctx: Context| async move {
            progress(&ctx, ProgressSettings::new("Fetching records"))
                .end_with("Fetched 3 records.")
                .await
        });
    let pair = Command::new("pair")
        .description("Run two lines.")
        .extend([opted()])
        .action(|ctx: Context| async move {
            let first = progress(&ctx, ProgressSettings::new("First"));
            let second = progress(&ctx, ProgressSettings::new("Second"));
            first.end().await?;
            second.end().await
        });
    let bare = Command::new("bare")
        .description("Report by hand.")
        .extend([opted()])
        .action(|ctx: Context| async move {
            ctx.out
                .region(RegionOptions::new())
                .report(ProgressReport::new().completed(1.0));
            ctx.out
                .region(RegionOptions::new())
                .report(ProgressReport::new());
            Ok(())
        });
    let counts = Command::new("counts")
        .description("Report counts by hand.")
        .extend([opted()])
        .action(|ctx: Context| async move {
            let fetching = ctx.out.region(RegionOptions::new());
            fetching.report(ProgressReport::new().label("Fetching").total(8.0));
            fetching.report(ProgressReport::new().label("Other"));
            let counted = ctx.out.region(RegionOptions::new());
            counted.report(ProgressReport::new().label("Fetching"));
            counted.report(ProgressReport::new().completed(3.0));
            let numbers = ctx.out.region(RegionOptions::new());
            numbers.report(ProgressReport::new());
            numbers.report(ProgressReport::new().completed(0.5).total(1e21));
            Ok(())
        });
    let observed = observed.clone();
    let waiting = Command::new("waiting")
        .description("Wait with a line.")
        .extend([opted()])
        .action(move |ctx: Context| {
            let observed = observed.clone();
            async move {
                let _line = progress(&ctx, ProgressSettings::new("Waiting"));
                observed.report("started waiting");
                ctx.signal.cancelled().await;
                observed.report("aborted waiting");
                Ok(())
            }
        });
    Application::new("progress")
        .plugins([mcp()])
        .version("1.0.0")
        .command(counted)
        .command(spinner)
        .command(finished)
        .command(pair)
        .command(bare)
        .command(counts)
        .command(waiting)
        .action(|_: Context| async { Ok(()) })
}

fn app() -> App {
    progress_app(&Observed::default())
}

/// A `tools/call` request whose `_meta` carries a progress token.
fn tracked(id: u32, token: impl Into<Value>, name: &str) -> Value {
    let mut call_meta = meta();
    call_meta["progressToken"] = token.into();
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "method": "tools/call",
        "params": { "_meta": call_meta, "arguments": {}, "name": name },
    })
}

/// One progress notification on a token, as the server writes it.
fn progress_note(token: impl Into<Value>, progress: u32, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": "notifications/progress",
        "params": { "progressToken": token.into(), "progress": progress, "message": message },
    })
}

/// The notifications a tracked call of `name` sends before its result, and that result.
async fn tracked_call(name: &str, token: impl Into<Value>) -> (Vec<Value>, Value) {
    let mut session = serve(&app());
    session.send(&tracked(1, token, name));
    let answered = session.until_answer(1).await;
    session.close().await;
    answered
}

#[tokio::test]
async fn sends_one_notification_per_event_of_a_counted_line_counting_every_event_before_the_result()
{
    let mut session = serve(&app());
    session.send(&tracked(1, "records", "counted"));
    let first = session.next_line().await;
    assert_eq!(
        first,
        r#"{"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"records","progress":1,"message":"Fetching records 0/3 (started)"}}"#
    );
    let (mut before, answer) = session.until_answer(1).await;
    session.close().await;
    before.insert(0, serde_json::from_str(&first).unwrap());
    assert_eq!(
        before,
        [
            progress_note("records", 1, "Fetching records 0/3 (started)"),
            progress_note("records", 2, "Fetching records 1/3 (updated)"),
            progress_note("records", 3, "Fetching records 2/3 (updated)"),
            progress_note("records", 4, "Fetching records 3/3 (updated)"),
            progress_note("records", 5, "Fetching records 3/3 (ended)"),
        ]
    );
    let text = answer["result"]["content"][0]["text"].as_str().unwrap();
    let lines: Vec<&str> = text.split('\n').collect();
    assert_eq!(lines.len(), 3, "{text:?}");
    assert!(lines[0].ends_with(" Fetching records"), "{text:?}");
    assert!(lines[1].ends_with(" Fetching records"), "{text:?}");
    assert_eq!(lines[2], "");
}

#[tokio::test]
async fn a_spinner_line_whose_label_changes_once_sends_progress_1_2_and_3() {
    let (before, _) = tracked_call("spinner", 7).await;
    assert_eq!(
        before,
        [
            progress_note(7, 1, "Building the index (started)"),
            progress_note(7, 2, "Writing the index (updated)"),
            progress_note(7, 3, "Writing the index (ended)"),
        ]
    );
}

#[tokio::test]
async fn a_line_that_ends_with_a_message_sends_that_message_as_its_end_notifications_label() {
    let (before, _) = tracked_call("finished", "finished").await;
    assert_eq!(
        before,
        [
            progress_note("finished", 1, "Fetching records (started)"),
            progress_note("finished", 2, "Fetched 3 records. (ended)"),
        ]
    );
}

#[tokio::test]
async fn two_lines_in_one_call_share_the_token_and_one_counter_in_the_order_their_events_were_delivered()
 {
    let (before, _) = tracked_call("pair", "pair").await;
    assert_eq!(
        before,
        [
            progress_note("pair", 1, "First (started)"),
            progress_note("pair", 2, "Second (started)"),
            progress_note("pair", 3, "First (ended)"),
            progress_note("pair", 4, "Second (ended)"),
        ]
    );
}

#[tokio::test]
async fn a_region_with_no_label_sends_its_counts_and_state_alone_and_one_with_neither_sends_the_state()
 {
    let (before, _) = tracked_call("bare", "bare").await;
    assert_eq!(
        before[..2],
        [
            progress_note("bare", 1, "1 (started)"),
            progress_note("bare", 2, "(started)"),
        ]
    );
}

/// `mcp-progress.test.ts`: a completed count without a total writes the count alone, a total
/// without a completed count writes no counts, each number reads as JavaScript's `String` writes
/// it, and the relay counts every event it sends and sends no total.
#[tokio::test]
async fn each_message_writes_the_label_the_counts_as_given_and_the_state() {
    let (before, _) = tracked_call("counts", 1).await;
    let messages: Vec<&str> = before
        .iter()
        .map(|note| note["params"]["message"].as_str().unwrap())
        .collect();
    assert_eq!(
        messages[..6],
        [
            "Fetching (started)",
            "Other (updated)",
            "Fetching (started)",
            "Fetching 3 (updated)",
            "(started)",
            "0.5/1e+21 (updated)",
        ]
    );
    for (index, note) in before.iter().enumerate() {
        assert_eq!(note["params"]["progress"], index + 1);
        assert!(note["params"].get("total").is_none());
    }
}

#[tokio::test]
async fn a_call_without_a_token_sends_no_notification() {
    let mut session = serve(&app());
    session.send(&request(
        1,
        "tools/call",
        json!({ "arguments": {}, "name": "counted" }),
    ));
    let (before, _) = session.until_answer(1).await;
    session.close().await;
    assert_eq!(before, Vec::<Value>::new());
}

#[tokio::test]
async fn a_call_the_client_cancels_sends_no_notification_after_its_cancellation() {
    let observed = Observed::default();
    let mut session = serve(&progress_app(&observed));
    session.send(&tracked(1, "waiting", "waiting"));
    observed.wait_for("started waiting").await;
    session.send(&cancelled(1));
    observed.wait_for("aborted waiting").await;
    session.send(&request(2, "server/discover", json!({})));
    let (before, _) = session.until_answer(2).await;
    let ending = session.close().await;
    assert_eq!(before, [progress_note("waiting", 1, "Waiting (started)")]);
    assert_eq!(ending.messages, Vec::<Value>::new());
}
