//! Ports of the reference's request-id tests.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::{assert_matches, bare, cancel, handshake_request, initialize, open, request};
use serde_json::json;

#[tokio::test]
async fn a_request_that_reuses_the_id_of_a_call_in_flight_is_answered_with_32600() {
    let mut session = open();
    session
        .send(&request(
            7,
            "tools/call",
            json!({ "arguments": { "label": "first" }, "name": "wait" }),
        ))
        .await;
    session.observed("started first").await;
    session
        .send(&request(7, "tools/call", json!({ "name": "echo" })))
        .await;
    assert_eq!(
        session.next().await,
        json!({
            "error": {
                "code": -32_600,
                "message": "The request id 7 is in use by a request still in flight. Send each request with an id no request in flight holds.",
            },
            "id": 7,
            "jsonrpc": "2.0",
        })
    );
    session.send(&cancel(7)).await;
    session.observed("aborted first").await;
    let ending = session.close().await;
    assert_eq!(ending.stderr, "started first\naborted first\nresolved\n");
    assert_eq!(ending.messages.len(), 1);
    assert_eq!(ending.status, 0);
}

#[tokio::test]
async fn an_initialize_that_reuses_the_id_of_a_call_in_flight_initializes_nothing() {
    let mut session = open();
    session
        .send(&request(
            2,
            "tools/call",
            json!({ "arguments": { "label": "first" }, "name": "wait" }),
        ))
        .await;
    session.observed("started first").await;
    session.send(&initialize(2, "2025-06-18")).await;
    assert_matches(
        &session.next().await,
        &json!({ "error": { "code": -32_600 }, "id": 2 }),
    );
    session
        .send(&handshake_request(3, "tools/list", None))
        .await;
    assert_matches(
        &session.next().await,
        &json!({ "error": { "code": -32_602 }, "id": 3 }),
    );
    assert_eq!(session.close().await.messages.len(), 2);
}

#[tokio::test]
async fn a_request_that_reuses_the_id_of_an_open_subscription_is_answered_with_32600() {
    let mut session = open();
    session.send(&bare("listen", "subscriptions/listen")).await;
    assert_matches(
        &session.next().await,
        &json!({ "method": "notifications/subscriptions/acknowledged" }),
    );
    session.send(&bare("listen", "server/discover")).await;
    assert_matches(
        &session.next().await,
        &json!({
            "error": {
                "code": -32_600,
                "message": "The request id \"listen\" is in use by a request still in flight. Send each request with an id no request in flight holds.",
            },
            "id": "listen",
        }),
    );
    let ending = session.close().await;
    // The subscription is still open, so shutdown closes it once.
    assert_eq!(ending.messages.len(), 4);
    assert_matches(
        &ending.messages[2],
        &json!({ "method": "notifications/cancelled" }),
    );
    assert_matches(
        &ending.messages[3],
        &json!({ "id": "listen", "result": {} }),
    );
}

#[tokio::test]
async fn serves_an_id_again_once_its_request_has_settled_or_been_cancelled() {
    let mut session = open();
    session.send(&bare(1, "server/discover")).await;
    assert_matches(&session.next().await, &json!({ "id": 1, "result": {} }));
    session.send(&bare(1, "server/discover")).await;
    assert_matches(&session.next().await, &json!({ "id": 1, "result": {} }));
    session
        .send(&request(
            2,
            "tools/call",
            json!({ "arguments": { "label": "two" }, "name": "wait" }),
        ))
        .await;
    session.observed("started two").await;
    session.send(&cancel(2)).await;
    session
        .send(&request(2, "tools/call", json!({ "name": "echo" })))
        .await;
    assert_matches(
        &session.next().await,
        &json!({ "id": 2, "result": { "isError": false } }),
    );
    session.close().await;
}
