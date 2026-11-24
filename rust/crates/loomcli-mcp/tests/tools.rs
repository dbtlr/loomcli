//! Ports of the reference's tools tests.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::{assert_matches, assert_plain_error, bare, open, open_with, request, server_info};
use serde_json::json;

fn tools() -> serde_json::Value {
    json!([
        {
            "description": "Answers the call it received.",
            "inputSchema": { "properties": { "text": { "type": "string" } }, "type": "object" },
            "name": "echo",
        },
        { "inputSchema": { "type": "object" }, "name": "wait" },
    ])
}

#[tokio::test]
async fn tools_list_answers_the_tools_in_one_page_that_no_client_caches() {
    let mut session = open();
    session.send(&bare(1, "tools/list")).await;
    assert_eq!(
        session.next().await,
        json!({
            "id": 1,
            "jsonrpc": "2.0",
            "result": {
                "_meta": { "io.modelcontextprotocol/serverInfo": server_info() },
                "cacheScope": "private",
                "resultType": "complete",
                "tools": tools(),
                "ttlMs": 0,
            },
        })
    );
    session.close().await;
}

#[tokio::test]
async fn tools_list_answers_a_cursor_with_32602() {
    let mut session = open();
    session
        .send(&request(1, "tools/list", json!({ "cursor": "page-2" })))
        .await;
    assert_eq!(
        session.next().await,
        json!({
            "error": {
                "code": -32_602,
                "message": "The cursor is not one this server issued. Call tools/list without a cursor.",
            },
            "id": 1,
            "jsonrpc": "2.0",
        })
    );
    session.close().await;
}

#[tokio::test]
async fn tools_list_answers_a_listing_that_fails_with_32603_and_keeps_serving() {
    let mut session = open_with("list-throws");
    session.send(&bare(1, "tools/list")).await;
    assert_eq!(
        session.next().await,
        json!({
            "error": {
                "code": -32_603,
                "message": "The server failed while handling tools/list. The failure is a defect in the server; report it to the server's author.",
            },
            "id": 1,
            "jsonrpc": "2.0",
        })
    );
    session.send(&bare(2, "server/discover")).await;
    assert_matches(
        &session.next().await,
        &json!({ "id": 2, "result": { "resultType": "complete" } }),
    );
    session.close().await;
}

#[tokio::test]
async fn tools_call_reaches_the_source_with_the_name_and_arguments_and_stamps_its_result() {
    let mut session = open();
    session
        .send(&request(
            1,
            "tools/call",
            json!({ "arguments": { "text": "hello" }, "name": "echo" }),
        ))
        .await;
    assert_eq!(
        session.next().await,
        json!({
            "id": 1,
            "jsonrpc": "2.0",
            "result": {
                "_meta": { "io.modelcontextprotocol/serverInfo": server_info() },
                "content": [{ "text": "first line\nsecond line", "type": "text" }],
                "isError": false,
                "resultType": "complete",
                "structuredContent": { "arguments": { "text": "hello" }, "name": "echo" },
            },
        })
    );
    session.close().await;
}

#[tokio::test]
async fn tools_call_hands_the_source_arguments_as_sent_absent_included() {
    let mut session = open();
    session
        .send(&request(
            1,
            "tools/call",
            json!({ "arguments": [1, 2], "name": "echo" }),
        ))
        .await;
    session
        .send(&request(2, "tools/call", json!({ "name": "echo" })))
        .await;
    assert_matches(
        &session.next().await,
        &json!({ "result": { "structuredContent": { "arguments": [1, 2], "name": "echo" } } }),
    );
    let second = session.next().await;
    assert_matches(
        &second,
        &json!({ "result": { "structuredContent": { "name": "echo" } } }),
    );
    assert!(
        second["result"]["structuredContent"]
            .get("arguments")
            .is_none()
    );
    session.close().await;
}

#[tokio::test]
async fn tools_call_that_names_no_tool_is_answered_with_32602() {
    let mut session = open();
    session
        .send(&request(1, "tools/call", json!({ "arguments": {} })))
        .await;
    let answer = session.next().await;
    assert_eq!(answer["error"]["code"], -32_602);
    assert!(
        answer["error"]["message"]
            .as_str()
            .unwrap()
            .contains("params.name")
    );
    assert_eq!(answer["id"], 1);
    assert_plain_error(&answer, &json!(1), -32_602);
    session.close().await;
}

#[tokio::test]
async fn tools_call_answers_a_protocol_error_with_its_code_message_and_data() {
    let mut session = open();
    session
        .send(&request(1, "tools/call", json!({ "name": "refuse" })))
        .await;
    assert_eq!(
        session.next().await,
        json!({
            "error": { "code": -32_602, "data": { "reason": "fixture" }, "message": "Refused." },
            "id": 1,
            "jsonrpc": "2.0",
        })
    );
    session.close().await;
}

#[tokio::test]
async fn tools_call_answers_a_source_that_panics_with_32603_and_keeps_serving() {
    let mut session = open();
    session
        .send(&request(1, "tools/call", json!({ "name": "throw" })))
        .await;
    assert_eq!(
        session.next().await,
        json!({
            "error": {
                "code": -32_603,
                "message": "The server failed while handling tools/call. The failure is a defect in the server; report it to the server's author.",
            },
            "id": 1,
            "jsonrpc": "2.0",
        })
    );
    session
        .send(&request(2, "tools/call", json!({ "name": "echo" })))
        .await;
    assert_matches(
        &session.next().await,
        &json!({ "id": 2, "result": { "isError": false } }),
    );
    session.close().await;
}
