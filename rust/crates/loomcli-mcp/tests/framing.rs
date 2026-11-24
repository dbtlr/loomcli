//! Ports of the reference's framing tests.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::{assert_matches, bare, open, request};
use serde_json::{Value, json};
use std::time::Duration;

fn error(id: Value, code: i64) -> Value {
    json!({ "error": { "code": code }, "id": id, "jsonrpc": "2.0" })
}

fn assert_error(actual: &Value, id: Value, code: i64) {
    assert_matches(actual, &error(id.clone(), code));
    common::assert_plain_error(actual, &id, code);
    assert_eq!(actual["jsonrpc"], "2.0");
}

#[tokio::test]
async fn parses_a_message_split_across_two_reads_once() {
    let mut session = open();
    let line = format!("{}\n", bare(1, "tools/list"));
    session.send_raw(&line[..20]).await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    session.send_raw(&line[20..]).await;
    let first = session.next().await;
    assert_matches(
        &first,
        &json!({ "id": 1, "result": { "resultType": "complete" } }),
    );
    assert_eq!(session.close().await.messages.len(), 1);
}

#[tokio::test]
async fn parses_two_messages_in_one_read_in_order() {
    let mut session = open();
    session
        .send_raw(&format!(
            "{}\n{}\n",
            bare(1, "server/discover"),
            bare(2, "tools/list")
        ))
        .await;
    assert_eq!(session.next().await["id"], 1);
    assert_eq!(session.next().await["id"], 2);
    session.close().await;
}

#[tokio::test]
async fn answers_a_line_that_is_not_json_with_32700() {
    let mut session = open();
    session.send_raw("{\"jsonrpc\": \"2.0\", \n").await;
    assert_error(&session.next().await, Value::Null, -32_700);
    session.close().await;
}

#[tokio::test]
async fn ignores_a_blank_line() {
    let mut session = open();
    session.send_raw("\n").await;
    session.send_raw(" \t\r\n").await;
    session.send(&bare(1, "server/discover")).await;
    assert_eq!(session.next().await["id"], 1);
    assert_eq!(session.close().await.messages.len(), 1);
}

#[tokio::test]
async fn answers_a_batch_with_32600() {
    let mut session = open();
    session
        .send(&json!([bare(1, "server/discover"), bare(2, "tools/list")]))
        .await;
    assert_error(&session.next().await, Value::Null, -32_600);
    assert_eq!(session.close().await.messages.len(), 1);
}

#[tokio::test]
async fn answers_a_json_value_that_is_not_a_request_or_notification_with_32600() {
    let mut session = open();
    session.send(&json!(42)).await;
    session.send(&json!({ "id": 7, "jsonrpc": "2.0" })).await;
    session
        .send(&json!({ "id": 8, "method": "tools/list" }))
        .await;
    assert_error(&session.next().await, Value::Null, -32_600);
    assert_error(&session.next().await, json!(7), -32_600);
    assert_error(&session.next().await, json!(8), -32_600);
    session.close().await;
}

#[tokio::test]
async fn ignores_a_response_from_the_client() {
    let mut session = open();
    session
        .send(&json!({ "id": 1, "jsonrpc": "2.0", "result": {} }))
        .await;
    session
        .send(&json!({ "error": { "code": -32_603, "message": "Failed." }, "id": 2, "jsonrpc": "2.0" }))
        .await;
    session.send(&bare(3, "server/discover")).await;
    assert_eq!(session.next().await["id"], 3);
    assert_eq!(session.close().await.messages.len(), 1);
}

#[tokio::test]
async fn writes_each_message_as_one_line_of_json_with_no_raw_line_break() {
    let mut session = open();
    session
        .send(&request(
            1,
            "tools/call",
            json!({ "arguments": { "text": "a\nb" }, "name": "echo" }),
        ))
        .await;
    session.send(&bare(2, "tools/list")).await;
    session.send_raw("not json\n").await;
    session.next().await;
    session.next().await;
    session.next().await;
    let ending = session.close().await;
    assert_eq!(ending.lines.len(), 3);
    for line in &ending.lines {
        let parsed: Value = serde_json::from_str(line).unwrap();
        assert_eq!(&serde_json::to_string(&parsed).unwrap(), line);
    }
    let echo = ending
        .messages
        .iter()
        .find(|message| message["id"] == 1)
        .unwrap();
    assert_matches(
        echo,
        &json!({ "result": { "content": [{ "text": "first line\nsecond line", "type": "text" }] } }),
    );
}
