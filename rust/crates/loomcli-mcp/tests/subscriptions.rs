//! Ports of the reference's subscription and shutdown tests.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::{assert_matches, bare, cancel, open, request, server_info};
use serde_json::{Value, json};

fn acknowledged(id: impl Into<Value>) -> Value {
    json!({
        "jsonrpc": "2.0",
        "method": "notifications/subscriptions/acknowledged",
        "params": { "_meta": { "io.modelcontextprotocol/subscriptionId": id.into() }, "notifications": {} },
    })
}

#[tokio::test]
async fn listen_is_acknowledged_first_with_an_empty_filter_and_the_subscriptions_id() {
    let mut session = open();
    session
        .send(&request(
            "listen",
            "subscriptions/listen",
            json!({ "notifications": { "toolsListChanged": true } }),
        ))
        .await;
    assert_eq!(session.next().await, acknowledged("listen"));
    session.close().await;
}

#[tokio::test]
async fn listen_checks_its_request_like_any_other() {
    let mut session = open();
    session
        .send(&json!({ "id": 1, "jsonrpc": "2.0", "method": "subscriptions/listen", "params": {} }))
        .await;
    assert_matches(
        &session.next().await,
        &json!({ "error": { "code": -32_602 }, "id": 1 }),
    );
    session.close().await;
}

#[tokio::test]
async fn listen_ends_with_no_response_when_the_client_cancels_it() {
    let mut session = open();
    session.send(&bare(1, "subscriptions/listen")).await;
    assert_eq!(session.next().await, acknowledged(1));
    session.send(&cancel(1)).await;
    session.send(&bare(2, "server/discover")).await;
    assert_eq!(session.next().await["id"], 2);
    let ending = session.close().await;
    assert_eq!(ending.messages.len(), 2);
    assert_eq!(ending.status, 0);
}

#[tokio::test]
async fn shutdown_aborts_calls_waits_for_each_and_closes_each_subscription_with_its_id() {
    let mut session = open();
    session.send(&bare(1, "subscriptions/listen")).await;
    assert_eq!(session.next().await, acknowledged(1));
    session
        .send(&request(
            2,
            "tools/call",
            json!({ "arguments": { "label": "two" }, "name": "wait" }),
        ))
        .await;
    session.observed("started two").await;
    let ending = session.close().await;
    assert_eq!(ending.stderr, "started two\naborted two\nresolved\n");
    assert_eq!(
        ending.messages[1..],
        [
            json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 1 } }),
            json!({
                "id": 1,
                "jsonrpc": "2.0",
                "result": {
                    "_meta": {
                        "io.modelcontextprotocol/serverInfo": server_info(),
                        "io.modelcontextprotocol/subscriptionId": 1,
                    },
                    "resultType": "complete",
                },
            }),
        ]
    );
    assert_eq!(ending.status, 0);
}

#[tokio::test]
async fn shutdown_drops_the_closing_messages_a_client_that_stopped_reading_cannot_receive() {
    let mut session = open();
    session.send(&bare(1, "subscriptions/listen")).await;
    assert_eq!(session.next().await, acknowledged(1));
    let ending = session.hang_up().await;
    assert_eq!((ending.status, ending.stderr.as_str()), (0, "resolved\n"));
}

#[tokio::test]
async fn shutdown_resolves_at_once_with_nothing_in_flight() {
    let session = open();
    let ending = session.close().await;
    assert!(ending.messages.is_empty());
    assert_eq!((ending.status, ending.stderr.as_str()), (0, "resolved\n"));
}

#[tokio::test]
async fn shutdown_serves_a_last_message_that_ends_without_a_line_feed() {
    let mut session = open();
    session
        .send_raw(&bare(1, "server/discover").to_string())
        .await;
    let ending = session.close().await;
    assert_eq!(ending.messages.len(), 1);
    assert_eq!(ending.messages[0]["id"], 1);
}

#[tokio::test]
async fn the_runs_token_aborts_every_call_and_ends_the_run_with_nothing_more_written() {
    let mut session = open();
    session.send(&bare(1, "subscriptions/listen")).await;
    assert_eq!(session.next().await, acknowledged(1));
    session
        .send(&request(
            2,
            "tools/call",
            json!({ "arguments": { "label": "two" }, "name": "wait" }),
        ))
        .await;
    session.observed("started two").await;
    session
        .send(&request(3, "tools/call", json!({ "name": "stop" })))
        .await;
    // The run ends with the input still open: cancelling stops reading.
    let ending = session.finish().await;
    assert_eq!(ending.stderr, "started two\naborted two\nresolved\n");
    assert_eq!(ending.messages.len(), 1);
    assert_eq!(ending.status, 0);
}
