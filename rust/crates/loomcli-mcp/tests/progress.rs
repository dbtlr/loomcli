//! Ports of the reference's progress tests.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::{assert_matches, bare, ids, meta, open, request};
use serde_json::{Value, json};

fn tracked(id: i64, token: Value, name: &str, input: Value) -> Value {
    let mut meta = meta();
    meta["progressToken"] = token;
    json!({ "id": id, "jsonrpc": "2.0", "method": "tools/call", "params": { "_meta": meta, "arguments": input, "name": name } })
}

fn notification(token: &Value, params: Value) -> Value {
    let mut params = params;
    params["progressToken"] = token.clone();
    json!({ "jsonrpc": "2.0", "method": "notifications/progress", "params": params })
}

fn updates() -> Value {
    json!([
        { "message": "one", "progress": 1, "total": 3 },
        { "progress": 2 },
        { "message": "three", "progress": 3 },
    ])
}

#[tokio::test]
async fn a_call_with_a_token_writes_one_progress_notification_per_call_in_order_before_its_answer()
{
    for token in [json!("token-1"), json!(7)] {
        let mut session = open();
        session
            .send(&tracked(
                1,
                token.clone(),
                "progress",
                json!({ "updates": updates() }),
            ))
            .await;
        let written = [
            session.next().await,
            session.next().await,
            session.next().await,
        ];
        assert_matches(
            &session.next().await,
            &json!({ "id": 1, "result": { "isError": false } }),
        );
        let ending = session.close().await;
        assert_eq!(
            written,
            [
                notification(
                    &token,
                    json!({ "message": "one", "progress": 1, "total": 3 })
                ),
                notification(&token, json!({ "progress": 2 })),
                notification(&token, json!({ "message": "three", "progress": 3 })),
            ]
        );
        assert_eq!(ending.stderr, "progress received\nresolved\n");
    }
}

#[tokio::test]
async fn a_call_without_a_token_receives_no_progress_sink() {
    let mut session = open();
    session
        .send(&request(
            1,
            "tools/call",
            json!({ "arguments": { "updates": updates() }, "name": "progress" }),
        ))
        .await;
    assert_eq!(session.next().await["id"], 1);
    let ending = session.close().await;
    assert_eq!(ending.messages.len(), 1);
    assert_eq!(ending.stderr, "progress absent\nresolved\n");
}

#[tokio::test]
async fn writes_nothing_after_the_call_is_answered() {
    let mut session = open();
    session
        .send(&tracked(1, json!("late"), "late", json!({})))
        .await;
    assert_eq!(session.next().await["id"], 1);
    session.observed("sent late").await;
    session.send(&bare(2, "server/discover")).await;
    assert_eq!(session.next().await["id"], 2);
    assert_eq!(ids(&session.close().await.messages), [json!(1), json!(2)]);
}

#[tokio::test]
async fn writes_nothing_after_the_client_cancels_the_call() {
    let mut session = open();
    session
        .send(&tracked(1, json!("cancelled"), "wait-progress", json!({})))
        .await;
    session.observed("started").await;
    session.send(&common::cancel(1)).await;
    session.observed("aborted").await;
    session.send(&bare(2, "server/discover")).await;
    assert_eq!(session.next().await["id"], 2);
    assert_eq!(ids(&session.close().await.messages), [json!(2)]);
}

#[tokio::test]
async fn writes_nothing_after_shutdown_aborts_the_call() {
    let mut session = open();
    session
        .send(&tracked(1, json!("shutdown"), "wait-progress", json!({})))
        .await;
    session.observed("started").await;
    let ending = session.close().await;
    assert!(ending.stderr.contains("aborted\n"));
    assert!(ending.messages.is_empty());
}
