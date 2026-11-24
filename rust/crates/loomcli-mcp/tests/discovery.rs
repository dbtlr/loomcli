//! Ports of the reference's discovery tests.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::{assert_matches, bare, open, request, server_info};
use serde_json::{Value, json};

#[tokio::test]
async fn server_discover_answers_every_revision_the_capability_no_caching_and_the_identity() {
    let mut session = open();
    session.send(&bare(1, "server/discover")).await;
    assert_eq!(
        session.next().await,
        json!({
            "id": 1,
            "jsonrpc": "2.0",
            "result": {
                "_meta": { "io.modelcontextprotocol/serverInfo": server_info() },
                "cacheScope": "private",
                "capabilities": { "tools": {} },
                "resultType": "complete",
                "supportedVersions": ["2026-07-28", "2025-11-25", "2025-06-18"],
                "ttlMs": 0,
            },
        })
    );
    assert_eq!(session.close().await.status, 0);
}

#[tokio::test]
async fn answers_a_request_missing_per_request_meta_with_32602() {
    let version = json!({ "io.modelcontextprotocol/protocolVersion": "2026-07-28" });
    let capabilities = json!({ "io.modelcontextprotocol/clientCapabilities": {} });
    let cases = [
        (
            "no params",
            json!({ "id": 1, "jsonrpc": "2.0", "method": "tools/list" }),
        ),
        (
            "no _meta",
            json!({ "id": 1, "jsonrpc": "2.0", "method": "tools/list", "params": {} }),
        ),
        (
            "no protocol version",
            json!({ "id": 1, "jsonrpc": "2.0", "method": "tools/list", "params": { "_meta": capabilities } }),
        ),
        (
            "no client capabilities",
            json!({ "id": 1, "jsonrpc": "2.0", "method": "tools/list", "params": { "_meta": version } }),
        ),
    ];
    for (case, message) in cases {
        let mut session = open();
        session.send(&message).await;
        let answer = session.next().await;
        assert_eq!(answer["error"]["code"], -32_602, "{case}");
        assert!(
            answer["error"]["message"]
                .as_str()
                .unwrap()
                .contains("params._meta"),
            "{case}"
        );
        assert_eq!(answer["id"], 1);
        common::assert_plain_error(&answer, &json!(1), -32_602);
        session.close().await;
    }
}

#[tokio::test]
async fn answers_a_request_for_another_version_with_32022_naming_every_version() {
    let mut session = open();
    session
        .send(&json!({
            "id": "a",
            "jsonrpc": "2.0",
            "method": "server/discover",
            "params": { "_meta": {
                "io.modelcontextprotocol/clientCapabilities": {},
                "io.modelcontextprotocol/protocolVersion": "2025-11-25",
            } },
        }))
        .await;
    assert_eq!(
        session.next().await,
        json!({
            "error": {
                "code": -32_022,
                "data": { "requested": "2025-11-25", "supported": ["2026-07-28", "2025-11-25", "2025-06-18"] },
                "message": "Unsupported protocol version. This server speaks MCP 2026-07-28 per request; send that version in every request's params._meta, or open the connection with initialize for MCP 2025-11-25 or 2025-06-18.",
            },
            "id": "a",
            "jsonrpc": "2.0",
        })
    );
    session.close().await;
}

#[tokio::test]
async fn relies_on_no_earlier_request() {
    let mut session = open();
    session.send(&bare(1, "tools/list")).await;
    assert_matches(
        &session.next().await,
        &json!({ "id": 1, "result": { "resultType": "complete" } }),
    );
    session.close().await;
}

#[tokio::test]
async fn answers_a_method_the_server_does_not_serve_with_32601() {
    for method in ["ping", "resources/list", "notifications/initialized"] {
        let mut session = open();
        session.send(&bare(1, method)).await;
        assert_eq!(
            session.next().await,
            json!({
                "error": {
                    "code": -32_601,
                    "message": "The method is not one this server serves. This server speaks MCP 2026-07-28; call server/discover, tools/list, tools/call, or subscriptions/listen.",
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
async fn answers_an_unserved_method_with_32601_before_the_per_request_checks() {
    let mut session = open();
    session
        .send(&json!({ "id": 1, "jsonrpc": "2.0", "method": "resources/list" }))
        .await;
    let answer: Value = session.next().await;
    assert_matches(&answer, &json!({ "error": { "code": -32_601 }, "id": 1 }));
    session.close().await;
}

#[tokio::test]
async fn ignores_a_notification_other_than_a_cancellation() {
    let mut session = open();
    session
        .send(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
        .await;
    session
        .send(&json!({ "jsonrpc": "2.0", "method": "notifications/progress", "params": { "progress": 1 } }))
        .await;
    session
        .send(&request(1, "server/discover", json!({})))
        .await;
    assert_eq!(session.next().await["id"], 1);
    assert_eq!(session.close().await.messages.len(), 1);
}
