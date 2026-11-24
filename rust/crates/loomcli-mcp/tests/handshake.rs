//! Ports of the reference's handshake tests.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::{
    assert_matches, assert_plain_error, bare, handshake_request, ids, initialize, initialize_with,
    open, request, server_info,
};
use serde_json::{Value, json};

fn implementation() -> Value {
    json!({ "name": "fixture", "version": "1.2.3" })
}

fn tools() -> Value {
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
async fn initialize_answers_2025_06_18_without_the_description() {
    let mut session = open();
    session.send(&initialize(0, "2025-06-18")).await;
    assert_eq!(
        session.next().await,
        json!({
            "id": 0,
            "jsonrpc": "2.0",
            "result": {
                "capabilities": { "tools": {} },
                "protocolVersion": "2025-06-18",
                "serverInfo": implementation(),
            },
        })
    );
    session.close().await;
}

#[tokio::test]
async fn initialize_answers_2025_11_25_with_the_description() {
    let mut session = open();
    session.send(&initialize(0, "2025-11-25")).await;
    assert_eq!(
        session.next().await,
        json!({
            "id": 0,
            "jsonrpc": "2.0",
            "result": { "capabilities": { "tools": {} }, "protocolVersion": "2025-11-25", "serverInfo": server_info() },
        })
    );
    session.close().await;
}

#[tokio::test]
async fn initialize_answers_another_version_with_the_latest_initialize_era_version() {
    for version in ["2024-11-05", "2025-03-26", "2026-07-28", "1.0.0"] {
        let mut session = open();
        session.send(&initialize(0, version)).await;
        assert_matches(
            &session.next().await,
            &json!({ "id": 0, "result": { "protocolVersion": "2025-11-25" } }),
        );
        session.close().await;
    }
}

#[tokio::test]
async fn initialize_answers_a_malformed_handshake_with_32602() {
    let cases = [
        ("no params", None),
        ("no protocol version", Some(json!({ "capabilities": {} }))),
        (
            "a protocol version that is not a string",
            Some(json!({ "capabilities": {}, "protocolVersion": 3 })),
        ),
        (
            "no capabilities",
            Some(json!({ "protocolVersion": "2025-06-18" })),
        ),
    ];
    for (case, params) in cases {
        let mut session = open();
        let message = match params {
            None => handshake_request(0, "initialize", None),
            Some(params) => initialize_with(0, params),
        };
        session.send(&message).await;
        let answer = session.next().await;
        assert_eq!(answer["error"]["code"], -32_602, "{case}");
        assert!(
            answer["error"]["message"]
                .as_str()
                .unwrap()
                .contains("initialize"),
            "{case}"
        );
        assert_eq!(answer["id"], 0);
        assert_plain_error(&answer, &json!(0), -32_602);
        // A malformed handshake initializes nothing, so the connection still needs one, and takes it.
        session
            .send(&handshake_request(1, "tools/list", None))
            .await;
        assert_matches(
            &session.next().await,
            &json!({ "error": { "code": -32_602 }, "id": 1 }),
        );
        session.send(&initialize(2, "2025-06-18")).await;
        assert_matches(
            &session.next().await,
            &json!({ "id": 2, "result": { "protocolVersion": "2025-06-18" } }),
        );
        session.close().await;
    }
}

#[tokio::test]
async fn a_second_initialize_is_answered_with_32600_and_keeps_the_negotiated_version() {
    let mut session = open();
    session.send(&initialize(0, "2025-06-18")).await;
    session.next().await;
    session.send(&initialize(1, "2025-11-25")).await;
    assert_eq!(
        session.next().await,
        json!({
            "error": {
                "code": -32_600,
                "message": "The connection is already initialized on MCP 2025-06-18. Send initialize once, as the first request.",
            },
            "id": 1,
            "jsonrpc": "2.0",
        })
    );
    session
        .send(&handshake_request(
            2,
            "tools/call",
            Some(json!({ "arguments": { "value": [1] }, "name": "structured" })),
        ))
        .await;
    // 2025-06-18 holds structured content as an object alone, so an array is left to the text.
    assert!(
        session.next().await["result"]
            .get("structuredContent")
            .is_none()
    );
    session.close().await;
}

#[tokio::test]
async fn an_initialized_connection_serves_in_the_shape_of_its_revision() {
    let mut session = open();
    session.send(&initialize(0, "2025-06-18")).await;
    session.next().await;
    session
        .send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
        .await;
    session.send(&handshake_request(1, "ping", None)).await;
    assert_eq!(
        session.next().await,
        json!({ "id": 1, "jsonrpc": "2.0", "result": {} })
    );
    session
        .send(&handshake_request(2, "tools/list", None))
        .await;
    assert_eq!(
        session.next().await,
        json!({ "id": 2, "jsonrpc": "2.0", "result": { "tools": tools() } })
    );
    session
        .send(&handshake_request(
            3,
            "tools/call",
            Some(json!({ "arguments": { "text": "hi" }, "name": "echo" })),
        ))
        .await;
    assert_eq!(
        session.next().await,
        json!({
            "id": 3,
            "jsonrpc": "2.0",
            "result": {
                "content": [{ "text": "first line\nsecond line", "type": "text" }],
                "isError": false,
                "structuredContent": { "arguments": { "text": "hi" }, "name": "echo" },
            },
        })
    );
    assert_eq!(session.close().await.status, 0);
}

#[tokio::test]
async fn leaves_out_structured_content_that_is_not_an_object() {
    for (case, value) in [
        ("an array", json!([1, 2])),
        ("a string", json!("text")),
        ("a number", json!(3)),
        ("null", Value::Null),
    ] {
        let mut session = open();
        session.send(&initialize(0, "2025-11-25")).await;
        session.next().await;
        session
            .send(&handshake_request(
                1,
                "tools/call",
                Some(json!({ "arguments": { "value": value }, "name": "structured" })),
            ))
            .await;
        assert_eq!(
            session.next().await,
            json!({
                "id": 1,
                "jsonrpc": "2.0",
                "result": { "content": [{ "text": value.to_string(), "type": "text" }], "isError": false },
            }),
            "{case}"
        );
        session.close().await;
    }
}

#[tokio::test]
async fn sends_progress_on_the_calls_token_and_drops_the_answer_of_a_cancelled_call() {
    let mut session = open();
    session.send(&initialize(0, "2025-06-18")).await;
    session.next().await;
    session
        .send(&handshake_request(
            1,
            "tools/call",
            Some(json!({
                "_meta": { "progressToken": "p" },
                "arguments": { "updates": [{ "message": "one", "progress": 1 }] },
                "name": "progress",
            })),
        ))
        .await;
    assert_eq!(
        session.next().await,
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/progress",
            "params": { "message": "one", "progress": 1, "progressToken": "p" },
        })
    );
    assert_matches(
        &session.next().await,
        &json!({ "id": 1, "result": { "isError": false } }),
    );
    session
        .send(&handshake_request(
            2,
            "tools/call",
            Some(json!({ "arguments": { "label": "two" }, "name": "wait" })),
        ))
        .await;
    session.observed("started two").await;
    session.send(&common::cancel(2)).await;
    session.observed("aborted two").await;
    session.send(&handshake_request(3, "ping", None)).await;
    assert_eq!(session.next().await["id"], 3);
    let ending = session.close().await;
    assert_eq!(
        ids(&ending.messages),
        [json!(0), Value::Null, json!(1), json!(3)]
    );
}

#[tokio::test]
async fn answers_a_method_without_per_request_meta_with_32601_on_an_initialized_connection() {
    for method in ["server/discover", "subscriptions/listen", "resources/list"] {
        let mut session = open();
        session.send(&initialize(0, "2025-11-25")).await;
        session.next().await;
        session.send(&handshake_request(1, method, None)).await;
        assert_eq!(
            session.next().await,
            json!({
                "error": {
                    "code": -32_601,
                    "message": "The method is not one this server serves on an initialized connection. Call ping, tools/list, or tools/call.",
                },
                "id": 1,
                "jsonrpc": "2.0",
            }),
            "{method}"
        );
        session.close().await;
    }
}

#[tokio::test]
async fn checks_a_request_whose_meta_names_a_protocol_version_even_after_the_handshake() {
    let mut session = open();
    session.send(&initialize(0, "2025-06-18")).await;
    session.next().await;
    session
        .send(&handshake_request(
            1,
            "tools/list",
            Some(json!({ "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } })),
        ))
        .await;
    let answer = session.next().await;
    assert_eq!(answer["error"]["code"], -32_602);
    assert!(
        answer["error"]["message"]
            .as_str()
            .unwrap()
            .contains("params._meta carries no \"io.modelcontextprotocol/clientCapabilities\"")
    );
    assert_eq!(answer["id"], 1);
    assert_plain_error(&answer, &json!(1), -32_602);
    session.close().await;
}

#[tokio::test]
async fn serves_a_request_carrying_per_request_meta_beside_the_handshake() {
    let mut session = open();
    session.send(&initialize(0, "2025-06-18")).await;
    session.next().await;
    session
        .send(&request(
            1,
            "tools/call",
            json!({ "arguments": { "value": [1] }, "name": "structured" }),
        ))
        .await;
    assert_matches(
        &session.next().await,
        &json!({ "id": 1, "result": { "resultType": "complete", "structuredContent": [1] } }),
    );
    session
        .send(&handshake_request(2, "tools/list", None))
        .await;
    assert_eq!(
        session.next().await,
        json!({ "id": 2, "jsonrpc": "2.0", "result": { "tools": tools() } })
    );
    session.close().await;
}

#[tokio::test]
async fn before_initialize_answers_ping() {
    let mut session = open();
    session.send(&handshake_request(1, "ping", None)).await;
    assert_eq!(
        session.next().await,
        json!({ "id": 1, "jsonrpc": "2.0", "result": {} })
    );
    session.close().await;
}

#[tokio::test]
async fn before_initialize_a_tool_request_without_meta_names_both_ways_in() {
    let mut session = open();
    session
        .send(&handshake_request(1, "tools/list", None))
        .await;
    assert_eq!(
        session.next().await,
        json!({
            "error": {
                "code": -32_602,
                "message": "The request's params._meta carries no \"io.modelcontextprotocol/protocolVersion\". Send \"io.modelcontextprotocol/protocolVersion\" and \"io.modelcontextprotocol/clientCapabilities\" with every request, or open the connection with initialize.",
            },
            "id": 1,
            "jsonrpc": "2.0",
        })
    );
    session.close().await;
}

#[tokio::test]
async fn a_per_request_connection_keeps_structured_content_of_any_json_value() {
    let mut session = open();
    session
        .send(&request(
            1,
            "tools/call",
            json!({ "arguments": { "value": "text" }, "name": "structured" }),
        ))
        .await;
    assert_matches(
        &session.next().await,
        &json!({ "id": 1, "result": { "resultType": "complete", "structuredContent": "text" } }),
    );
    session.close().await;
}

#[tokio::test]
async fn a_per_request_ping_is_not_found() {
    let mut session = open();
    session.send(&bare(1, "ping")).await;
    assert_eq!(session.next().await["error"]["code"], -32_601);
    session.close().await;
}
