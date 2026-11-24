//! Ports of the reference's cancellation tests.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::{assert_matches, bare, cancel, ids, open, request};
use serde_json::json;

#[tokio::test]
async fn aborts_the_named_calls_token_and_writes_no_response_for_it() {
    let mut session = open();
    session
        .send(&request(
            "call-1",
            "tools/call",
            json!({ "arguments": { "label": "one" }, "name": "wait" }),
        ))
        .await;
    session.observed("started one").await;
    session.send(&cancel("call-1")).await;
    session.observed("aborted one").await;
    session.send(&bare(2, "server/discover")).await;
    assert_eq!(session.next().await["id"], 2);
    assert_eq!(ids(&session.close().await.messages), [json!(2)]);
}

#[tokio::test]
async fn leaves_another_call_in_flight_running() {
    let mut session = open();
    session
        .send(&request(
            1,
            "tools/call",
            json!({ "arguments": { "label": "one" }, "name": "wait" }),
        ))
        .await;
    session
        .send(&request(
            2,
            "tools/call",
            json!({ "arguments": { "label": "two" }, "name": "wait" }),
        ))
        .await;
    session.observed("started two").await;
    session.send(&cancel(1)).await;
    session.observed("aborted one").await;
    session
        .send(&request(3, "tools/call", json!({ "name": "echo" })))
        .await;
    assert_eq!(session.next().await["id"], 3);
    let ending = session.close().await;
    // Closing the input aborts the call still in flight, which answers nothing.
    assert!(ending.stderr.contains("aborted two\n"));
    assert_eq!(ids(&ending.messages), [json!(3)]);
}

#[tokio::test]
async fn changes_nothing_for_an_unknown_or_settled_id() {
    let mut session = open();
    session
        .send(&request(1, "tools/call", json!({ "name": "echo" })))
        .await;
    assert_matches(
        &session.next().await,
        &json!({ "id": 1, "result": { "isError": false } }),
    );
    session.send(&cancel(1)).await;
    session.send(&cancel(99)).await;
    session.send(&cancel("1")).await;
    session
        .send(&json!({ "jsonrpc": "2.0", "method": "notifications/cancelled" }))
        .await;
    session
        .send(&request(2, "tools/call", json!({ "name": "echo" })))
        .await;
    assert_matches(
        &session.next().await,
        &json!({ "id": 2, "result": { "isError": false } }),
    );
    assert_eq!(ids(&session.close().await.messages), [json!(1), json!(2)]);
}

#[tokio::test]
async fn matches_a_numeric_id_and_a_string_id_as_different_requests() {
    let mut session = open();
    session
        .send(&request(
            1,
            "tools/call",
            json!({ "arguments": { "label": "number" }, "name": "wait" }),
        ))
        .await;
    session.observed("started number").await;
    session.send(&cancel("1")).await;
    session.send(&bare(2, "server/discover")).await;
    assert_eq!(session.next().await["id"], 2);
    let ending = session.close().await;
    // The call ran until shutdown aborted it, and a call shutdown aborts answers nothing.
    assert!(ending.stderr.contains("aborted number"));
    assert_eq!(ids(&ending.messages), [json!(2)]);
}
