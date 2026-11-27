//! Ports of the reference's HTTP transport tests (`packages/mcp/tests/http.test.ts`). An
//! in-process listener on 127.0.0.1, on a free port, hands its sockets to the transport, and a
//! client in the same process proves each rule of the endpoint, the body, the revisions,
//! sessions, notifications, responses, cancellation, receipt deadlines, and shutdown. A test that
//! fakes the reference's timers pauses the runtime's clock.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod http_support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use http_support::client::{
    Body, EventStream, PATIENCE, Raw, Sent, in_session, initialize, meta, mirrored, open,
    open_session, per_request, send, status_of, until,
};
use http_support::{Served, Settings, fake_timers, serve, server_info};
use loomcli_mcp::Authorization;
use serde_json::{Value, json};

fn headers(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs
        .iter()
        .map(|(name, value)| ((*name).to_owned(), (*value).to_owned()))
        .collect()
}

fn with_headers(mut sent: Sent, extra: Vec<(String, String)>) -> Sent {
    sent.headers = extra;
    sent
}

fn mirrored_with(
    method: &str,
    name: Option<&str>,
    extra: &[(&str, &str)],
) -> Vec<(String, String)> {
    let mut all = mirrored(method, name);
    all.extend(headers(extra));
    all
}

fn wait_call(id: impl Into<Value>, label: &str) -> Sent {
    per_request(
        id,
        "tools/call",
        json!({ "arguments": { "label": label }, "name": "wait" }),
    )
}

fn session_wait(session: &str, id: impl Into<Value>, label: &str) -> Sent {
    in_session(
        Some(session),
        id,
        "tools/call",
        Some(json!({ "arguments": { "label": label }, "name": "wait" })),
    )
}

fn code_of(answer: &Value) -> Value {
    answer["error"]["code"].clone()
}

fn discover() -> Sent {
    per_request(1, "server/discover", json!({}))
}

// The endpoint.

#[tokio::test]
async fn refuses_any_request_that_carries_an_origin_with_403_and_an_error_with_no_id_before_the_hook_runs()
 {
    let origins = Arc::new(Mutex::new(Vec::<String>::new()));
    let judged = Arc::new(Mutex::new(0));
    let (heard, counted) = (Arc::clone(&origins), Arc::clone(&judged));
    let served = serve(Settings {
        authorize: Some(Arc::new(move |_| {
            *counted.lock().unwrap() += 1;
            Authorization::Allowed
        })),
        on_origin_refused: Some(Arc::new(move |origin| {
            heard.lock().unwrap().push(origin.to_owned())
        })),
        ..Settings::default()
    })
    .await;
    let sent = with_headers(
        discover(),
        headers(&[
            ("Content-Type", "application/json"),
            ("Origin", "http://localhost:3000"),
        ]),
    );
    let answer = send(served.port, &sent).await;
    assert_eq!(answer.status, 403);
    assert_eq!(answer.header("connection").as_deref(), Some("close"));
    assert_eq!(
        answer.text,
        r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"This server answers no request a browser sends. Use an MCP client that is not a web page."}}"#
    );
    assert_eq!(*judged.lock().unwrap(), 0);
    assert_eq!(*origins.lock().unwrap(), ["http://localhost:3000"]);
    served.stop().await;
}

#[tokio::test]
async fn answers_a_path_other_than_mcp_with_404_and_compares_the_path_without_its_query() {
    let served = serve(Settings::default()).await;
    let other = send(served.port, &discover().path("/other")).await;
    assert_eq!(
        (
            other.status,
            other.header("connection").as_deref(),
            other.text.as_str()
        ),
        (404, Some("close"), "")
    );
    let queried = send(served.port, &discover().path("/mcp?x=1")).await;
    assert_eq!(queried.status, 200);
    served.stop().await;
}

#[tokio::test]
async fn answers_get_and_every_method_but_post_and_delete_with_405_and_allow() {
    let served = serve(Settings::default()).await;
    for method in ["GET", "PUT", "OPTIONS"] {
        let answer = send(served.port, &Sent::default().method(method)).await;
        assert_eq!(
            (
                answer.status,
                answer.header("allow").as_deref(),
                answer.header("connection").as_deref(),
                answer.text.as_str()
            ),
            (405, Some("POST, DELETE"), Some("close"), ""),
            "{method}"
        );
    }
    served.stop().await;
}

// Authorization.

#[tokio::test]
async fn passes_the_hook_a_copy_of_the_headers_and_answers_false_with_401_and_a_bearer_challenge() {
    let seen = Arc::new(Mutex::new(Vec::<Option<String>>::new()));
    let saw = Arc::clone(&seen);
    let served = serve(Settings {
        authorize: Some(Arc::new(move |headers| {
            saw.lock().unwrap().push(headers.get("x-probe"));
            Authorization::Refused
        })),
        ..Settings::default()
    })
    .await;
    let sent = with_headers(
        discover(),
        mirrored_with("server/discover", None, &[("X-Probe", "one")]),
    );
    let answer = send(served.port, &sent).await;
    send(served.port, &sent).await;
    assert_eq!(
        (
            answer.status,
            answer.header("www-authenticate").as_deref(),
            answer.header("connection").as_deref(),
            answer.text.as_str()
        ),
        (401, Some("Bearer"), Some("close"), "")
    );
    assert_eq!(
        *seen.lock().unwrap(),
        [Some("one".to_owned()), Some("one".to_owned())]
    );
    served.stop().await;
}

#[tokio::test]
async fn serves_a_request_the_hook_allows_judged_from_its_headers() {
    let served = serve(Settings {
        authorize: Some(Arc::new(|headers| {
            if headers.get("authorization").as_deref() == Some("Bearer sesame") {
                Authorization::Allowed
            } else {
                Authorization::Refused
            }
        })),
        ..Settings::default()
    })
    .await;
    let refused = send(served.port, &discover()).await;
    let allowed = send(
        served.port,
        &with_headers(
            discover(),
            mirrored_with(
                "server/discover",
                None,
                &[("Authorization", "Bearer sesame")],
            ),
        ),
    )
    .await;
    assert_eq!((refused.status, allowed.status), (401, 200));
    served.stop().await;
}

#[tokio::test]
async fn judges_every_request_a_refused_path_and_method_included_before_the_path_and_method() {
    let served = serve(Settings {
        authorize: Some(Arc::new(|_| Authorization::Refused)),
        ..Settings::default()
    })
    .await;
    let path = send(served.port, &Sent::default().path("/other")).await;
    let method = send(served.port, &Sent::default().method("GET")).await;
    assert_eq!((path.status, method.status), (401, 401));
    served.stop().await;
}

#[tokio::test]
async fn judges_a_request_before_it_looks_its_session_up() {
    let served = serve(Settings {
        authorize: Some(Arc::new(|_| Authorization::Refused)),
        ..Settings::default()
    })
    .await;
    for method in ["DELETE", "GET", "POST"] {
        let mut client = Raw::connect(served.port).await;
        client
            .write(format!("{method} /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nMcp-Session-Id: 00000000-0000-4000-8000-000000000000\r\nContent-Type: application/json\r\nContent-Length: 0\r\n\r\n").as_bytes())
            .await;
        client.holds("\r\n\r\n").await;
        assert!(
            client.text().starts_with("HTTP/1.1 401 "),
            "{method}: {}",
            client.text()
        );
    }
    served.stop().await;
}
#[tokio::test]
async fn answers_a_hook_that_fails_with_500_and_32603_and_keeps_serving() {
    let calls = Arc::new(Mutex::new(0));
    let counted = Arc::clone(&calls);
    let served = serve(Settings {
        authorize: Some(Arc::new(move |_| {
            let mut calls = counted.lock().unwrap();
            *calls += 1;
            if *calls <= 2 {
                Authorization::Failed
            } else {
                Authorization::Allowed
            }
        })),
        ..Settings::default()
    })
    .await;
    let thrown = send(served.port, &discover()).await;
    let rejected = send(served.port, &discover()).await;
    let answered = send(served.port, &discover()).await;
    assert_eq!(thrown.status, 500);
    assert_eq!(thrown.header("connection").as_deref(), Some("close"));
    assert_eq!(thrown.json()["id"], Value::Null);
    assert_eq!(code_of(&thrown.json()), -32_603);
    assert_eq!(
        thrown.json()["error"]["message"],
        "The server failed while it authorized the request. The failure is a defect in the server; report it to the server's author."
    );
    assert_eq!((rejected.status, answered.status), (500, 200));
    served.stop().await;
}

// The POST body.

#[tokio::test]
async fn answers_a_post_that_is_not_application_json_with_415_and_allows_parameters() {
    let served = serve(Settings::default()).await;
    let text = send(
        served.port,
        &with_headers(
            discover(),
            mirrored_with("server/discover", None, &[("Content-Type", "text/plain")]),
        ),
    )
    .await;
    assert_eq!(text.status, 415);
    assert_eq!(text.header("connection").as_deref(), Some("close"));
    assert_eq!(text.json()["id"], Value::Null);
    assert_eq!(code_of(&text.json()), -32_600);
    let charset = send(
        served.port,
        &with_headers(
            discover(),
            mirrored_with(
                "server/discover",
                None,
                &[("Content-Type", "application/json; charset=utf-8")],
            ),
        ),
    )
    .await;
    assert_eq!(charset.status, 200);
    served.stop().await;
}

#[tokio::test]
async fn refuses_a_content_length_past_the_limit_with_413_before_reading_the_body() {
    let served = serve(Settings {
        max_body_bytes: Some(64),
        ..Settings::default()
    })
    .await;
    let body = json!({ "id": 1, "jsonrpc": "2.0", "method": "server/discover", "padding": "x".repeat(100) });
    let answer = send(served.port, &Sent::raw(&body.to_string())).await;
    assert_eq!(answer.status, 413);
    assert_eq!(answer.header("connection").as_deref(), Some("close"));
    assert_eq!(
        answer.text,
        r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"The request body is larger than the 64 bytes this server reads. Send a smaller message."}}"#
    );
    served.stop().await;
}

#[tokio::test]
async fn counts_a_chunked_body_as_it_arrives_and_answers_413_past_the_limit() {
    let served = serve(Settings {
        max_body_bytes: Some(64),
        ..Settings::default()
    })
    .await;
    let sent =
        Sent::json(json!({ "padding": "x".repeat(200) })).header("Transfer-Encoding", "chunked");
    let answer = send(served.port, &sent).await;
    assert_eq!(
        (answer.status, answer.header("connection").as_deref()),
        (413, Some("close"))
    );
    served.stop().await;
}

#[tokio::test]
async fn answers_a_body_that_is_not_json_with_400_and_32700_and_a_batch_or_a_non_message_with_400_and_32600()
 {
    let served = serve(Settings::default()).await;
    let not_json = send(served.port, &Sent::raw("{")).await;
    let batch = send(served.port, &Sent::json(json!([]))).await;
    let neither = send(served.port, &Sent::json(json!({ "hello": "world" }))).await;
    assert_eq!(not_json.status, 400);
    assert_eq!(
        not_json.text,
        r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"The request body is not JSON. Send one JSON-RPC message as the body of a POST."}}"#
    );
    assert_eq!(batch.status, 400);
    assert_eq!(batch.json()["id"], Value::Null);
    assert_eq!(code_of(&batch.json()), -32_600);
    assert_eq!(
        batch.json()["error"]["message"],
        "A batch is not a message this server reads. Send each JSON-RPC message as the body of its own POST."
    );
    assert_eq!(neither.status, 400);
    assert_eq!(code_of(&neither.json()), -32_600);
    assert_eq!(
        neither.json()["error"]["message"],
        "The body is not a JSON-RPC 2.0 request, notification, or response. Send an object with \"jsonrpc\": \"2.0\", a \"method\", and an \"id\" for a request."
    );
    served.stop().await;
}

#[tokio::test]
async fn answers_a_notification_and_a_response_with_202_and_no_body() {
    let served = serve(Settings::default()).await;
    let notification = send(
        served.port,
        &Sent::json(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })),
    )
    .await;
    let response = send(
        served.port,
        &Sent::json(json!({ "id": 3, "jsonrpc": "2.0", "result": {} })),
    )
    .await;
    assert_eq!(
        (
            notification.status,
            notification.text.as_str(),
            response.status,
            response.text.as_str()
        ),
        (202, "", 202, "")
    );
    served.stop().await;
}

// Early refusals close the HTTP connection after a bounded read.

#[tokio::test]
async fn reads_every_oversized_upload_answer_as_413_across_40_uploads() {
    let served = serve(Settings::default()).await;
    let body = "x".repeat(5 * 1024 * 1024);
    for _ in 0..40 {
        let mut raw = Raw::connect(served.port).await;
        let head = format!(
            "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n",
            body.len()
        );
        raw.write(head.as_bytes()).await;
        // The client keeps uploading while the answer arrives, as fetch does.
        let _ = raw.write(body.as_bytes()).await;
        raw.ended().await;
        let text = raw.text();
        assert!(text.starts_with("HTTP/1.1 413 "), "{text}");
        assert!(text.contains("-32600"), "{text}");
    }
    served.stop().await;
}

/// Whether the server still reads what the client sends: a closed server answers the bytes with a
/// reset, which the next write sees.
async fn still_reads(raw: &mut Raw) -> bool {
    for _ in 0..4 {
        if !raw.write(b"xxxxxxxx").await {
            return false;
        }
        // A real millisecond, which a paused clock does not hold up.
        tokio::task::spawn_blocking(|| std::thread::sleep(Duration::from_millis(1)))
            .await
            .unwrap();
        for _ in 0..32 {
            tokio::task::yield_now().await;
        }
    }
    true
}

#[tokio::test]
async fn keeps_discarding_beyond_64_kib_until_the_2_second_bound() {
    let served = serve(Settings::default()).await;
    let timers = fake_timers();
    let mut client = Raw::connect(served.port).await;
    client
        .write(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: test\r\nContent-Type: application/json\r\nContent-Length: 10000000\r\n\r\n")
        .await;
    client.holds("403").await;
    assert!(client.write(&vec![b'x'; 131_072]).await);
    assert!(still_reads(&mut client).await);
    timers.advance(Duration::from_millis(2000)).await;
    let started = std::time::Instant::now();
    while still_reads(&mut client).await {
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the socket stayed open"
        );
    }
    served.stop().await;
}

#[tokio::test]
async fn closes_after_2_seconds_when_the_client_sends_nothing_more() {
    let served = serve(Settings::default()).await;
    let timers = fake_timers();
    let mut client = Raw::connect(served.port).await;
    client
        .write(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: http://example.test\r\nContent-Type: application/json\r\nContent-Length: 1000\r\n\r\n")
        .await;
    client.holds("-32600").await;
    timers.advance(Duration::from_millis(1999)).await;
    assert!(still_reads(&mut client).await);
    timers.advance(Duration::from_millis(1)).await;
    let started = std::time::Instant::now();
    while still_reads(&mut client).await {
        assert!(
            started.elapsed() < Duration::from_secs(5),
            "the socket stayed open"
        );
    }
    served.stop().await;
}

// Receipt deadlines.

#[tokio::test]
async fn answers_408_and_closes_when_the_headers_have_not_arrived_within_60_seconds() {
    let served = serve(Settings::default()).await;
    let timers = fake_timers();
    let mut client = Raw::connect(served.port).await;
    until("the server to accept", || served.accepted() > 0).await;
    client
        .write(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n")
        .await;
    timers.advance(Duration::from_millis(59_999)).await;
    assert_eq!(client.text(), "");
    timers.advance(Duration::from_millis(1)).await;
    client.ended().await;
    assert!(
        client.text().starts_with("HTTP/1.1 408 "),
        "{}",
        client.text()
    );
    served.stop().await;
}

#[tokio::test]
async fn answers_408_and_closes_when_the_whole_request_has_not_arrived_within_300_seconds() {
    let served = serve(Settings::default()).await;
    let timers = fake_timers();
    let mut client = Raw::connect(served.port).await;
    until("the server to accept", || served.accepted() > 0).await;
    client
        .write(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{\"jsonrpc\":")
        .await;
    until("the request's headers", || served.requests() == 1).await;
    timers.advance(Duration::from_millis(60_000)).await;
    assert_eq!(client.text(), "");
    timers.advance(Duration::from_millis(240_000)).await;
    client.ended().await;
    assert!(
        client.text().starts_with("HTTP/1.1 408 "),
        "{}",
        client.text()
    );
    served.stop().await;
}

// 2026-07-28, per request.

#[tokio::test]
async fn serves_server_discover_and_tools_list_as_one_json_answer_statelessly() {
    let served = serve(Settings::default()).await;
    let answer = send(served.port, &per_request(1, "tools/list", json!({}))).await;
    assert_eq!(answer.status, 200);
    assert_eq!(
        answer.header("content-type").as_deref(),
        Some("application/json")
    );
    assert_eq!(answer.header("mcp-session-id"), None);
    let message = answer.json();
    assert_eq!(message["id"], 1);
    assert_eq!(
        message["result"]["_meta"]["io.modelcontextprotocol/serverInfo"],
        server_info()
    );
    assert_eq!(message["result"]["cacheScope"], "private");
    assert_eq!(message["result"]["resultType"], "complete");
    served.stop().await;
}

#[tokio::test]
async fn answers_each_metadata_header_missing_or_unmatched_with_400_and_32020_carrying_the_id() {
    let served = serve(Settings::default()).await;
    let cases = [
        (
            "MCP-Protocol-Version missing",
            headers(&[("Mcp-Method", "tools/list")]),
        ),
        (
            "MCP-Protocol-Version unmatched",
            headers(&[
                ("MCP-Protocol-Version", "2025-11-25"),
                ("Mcp-Method", "tools/list"),
            ]),
        ),
        (
            "Mcp-Method missing",
            headers(&[("MCP-Protocol-Version", "2026-07-28")]),
        ),
        ("Mcp-Method unmatched", mirrored("tools/call", None)),
    ];
    for (case, extra) in cases {
        let answer = send(
            served.port,
            &with_headers(per_request(7, "tools/list", json!({})), extra),
        )
        .await;
        assert_eq!(answer.status, 400, "{case}");
        assert_eq!(answer.json()["id"], 7, "{case}");
        assert_eq!(code_of(&answer.json()), -32_020, "{case}");
    }
    served.stop().await;
}

#[tokio::test]
async fn checks_mcp_name_on_tools_call_decoding_the_base64_form() {
    let served = serve(Settings::default()).await;
    let call = per_request(1, "tools/call", json!({ "arguments": {}, "name": "echo" }));
    let missing = send(
        served.port,
        &with_headers(call.clone(), mirrored("tools/call", None)),
    )
    .await;
    let wrong = send(
        served.port,
        &with_headers(call.clone(), mirrored("tools/call", Some("wait"))),
    )
    .await;
    // "echo" in base64.
    let encoded = send(
        served.port,
        &with_headers(call, mirrored("tools/call", Some("=?base64?ZWNobw==?="))),
    )
    .await;
    assert_eq!(
        missing.text,
        r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32020,"message":"The Mcp-Name header is missing or does not equal params.name. Send Mcp-Name with the value params.name holds."}}"#
    );
    assert_eq!((missing.status, wrong.status), (400, 400));
    assert_eq!(code_of(&wrong.json()), -32_020);
    assert_eq!(
        (encoded.status, encoded.header("content-type").as_deref()),
        (200, Some("text/event-stream"))
    );
    served.stop().await;
}

#[tokio::test]
async fn answers_a_missing_or_wrong_typed_meta_key_with_400_and_32602() {
    let served = serve(Settings::default()).await;
    let missing = send(
        served.port,
        &with_headers(
            Sent::json(json!({
                "id": 1, "jsonrpc": "2.0", "method": "tools/list",
                "params": { "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28" } },
            })),
            mirrored("tools/list", None),
        ),
    )
    .await;
    let mut wrong_meta = meta();
    wrong_meta["io.modelcontextprotocol/protocolVersion"] = json!(20_260_728);
    let wrong_type = send(
        served.port,
        &with_headers(
            Sent::json(json!({ "id": 2, "jsonrpc": "2.0", "method": "tools/list", "params": { "_meta": wrong_meta } })),
            mirrored("tools/list", None),
        ),
    )
    .await;
    assert_eq!(
        (missing.status, code_of(&missing.json())),
        (400, json!(-32_602))
    );
    assert_eq!(
        (wrong_type.status, code_of(&wrong_type.json())),
        (400, json!(-32_602))
    );
    served.stop().await;
}

#[tokio::test]
async fn answers_an_unsupported_version_with_400_and_32022_and_a_method_not_served_with_404_and_32601()
 {
    let served = serve(Settings::default()).await;
    let mut later = meta();
    later["io.modelcontextprotocol/protocolVersion"] = json!("2027-01-01");
    let unsupported = send(
        served.port,
        &with_headers(
            Sent::json(json!({ "id": 1, "jsonrpc": "2.0", "method": "tools/list", "params": { "_meta": later } })),
            headers(&[("MCP-Protocol-Version", "2027-01-01"), ("Mcp-Method", "tools/list")]),
        ),
    )
    .await;
    let not_served = send(served.port, &per_request(2, "ping", json!({}))).await;
    assert_eq!(
        (unsupported.status, code_of(&unsupported.json())),
        (400, json!(-32_022))
    );
    assert_eq!(
        (
            not_served.status,
            not_served.header("content-type").as_deref(),
            code_of(&not_served.json())
        ),
        (404, Some("application/json"), json!(-32_601))
    );
    served.stop().await;
}

#[tokio::test]
async fn answers_a_call_whose_name_is_not_a_string_as_json_with_200_and_32602_before_any_stream() {
    let served = serve(Settings::default()).await;
    let answer = send(
        served.port,
        &with_headers(
            Sent::json(json!({ "id": 1, "jsonrpc": "2.0", "method": "tools/call", "params": { "_meta": meta(), "name": 5 } })),
            mirrored("tools/call", None),
        ),
    )
    .await;
    assert_eq!(
        (
            answer.status,
            answer.header("content-type").as_deref(),
            code_of(&answer.json())
        ),
        (200, Some("application/json"), json!(-32_602))
    );
    served.stop().await;
}

#[tokio::test]
async fn ignores_a_session_id_and_last_event_id_on_a_per_request_message() {
    let served = serve(Settings::default()).await;
    let answer = send(
        served.port,
        &with_headers(
            discover(),
            mirrored_with(
                "server/discover",
                None,
                &[("Last-Event-ID", "4"), ("MCP-Session-Id", "nope")],
            ),
        ),
    )
    .await;
    assert_eq!(answer.status, 200);
    served.stop().await;
}

// Event streams.

#[tokio::test]
async fn answers_tools_call_as_an_event_stream_progress_then_the_result_then_the_end() {
    let served = serve(Settings::default()).await;
    let mut progress_meta = meta();
    progress_meta["progressToken"] = json!("p");
    let response = open(
        served.port,
        &with_headers(
            Sent::json(json!({
                "id": 1, "jsonrpc": "2.0", "method": "tools/call",
                "params": { "_meta": progress_meta, "arguments": {}, "name": "progress" },
            })),
            mirrored("tools/call", Some("progress")),
        ),
    )
    .await;
    assert_eq!(response.status().await, 200);
    assert_eq!(
        response.header("cache-control").await.as_deref(),
        Some("no-cache")
    );
    assert_eq!(
        response.header("content-type").await.as_deref(),
        Some("text/event-stream")
    );
    assert_eq!(
        response.header("x-accel-buffering").await.as_deref(),
        Some("no")
    );
    let answer = response.read_all().await;
    let blocks: Vec<&str> = answer.text.split("\n\n").collect();
    assert_eq!(blocks.len(), 4, "{}", answer.text);
    assert!(blocks[..3].iter().all(|block| block.starts_with("data: ")));
    assert_eq!(
        blocks[0],
        r#"data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"p","progress":1,"message":"first"}}"#
    );
    assert_eq!(
        blocks[1],
        r#"data: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"p","progress":2,"total":2}}"#
    );
    let result: Value = serde_json::from_str(&blocks[2]["data: ".len()..]).unwrap();
    assert_eq!(result["id"], 1);
    assert_eq!(result["result"]["resultType"], "complete");
    served.stop().await;
}

#[tokio::test]
async fn sends_a_handler_error_such_as_an_unknown_tool_on_the_stream() {
    let served = serve(Settings::default()).await;
    let answer = send(
        served.port,
        &per_request(1, "tools/call", json!({ "name": "nothing" })),
    )
    .await;
    assert_eq!(
        answer.header("content-type").as_deref(),
        Some("text/event-stream")
    );
    assert!(answer.text.contains(r#""code":-32602"#), "{}", answer.text);
    served.stop().await;
}

#[tokio::test]
async fn writes_a_comment_line_every_15_seconds_while_a_stream_stays_open() {
    let served = serve(Settings::default()).await;
    let timers = fake_timers();
    let mut stream = EventStream::new(open(served.port, &wait_call(1, "long")).await);
    until("the call to start", || served.events.has("started long")).await;
    timers.advance(Duration::from_millis(15_000)).await;
    stream.holds(": keep-alive\n\n").await;
    timers.advance(Duration::from_millis(15_000)).await;
    until("a second comment line", || {
        stream.text().split(": keep-alive").count() == 3
    })
    .await;
    served.release("long");
    assert_eq!(stream.next().await["id"], 1);
    stream.ended().await;
    served.stop().await;
}

#[tokio::test]
async fn acknowledges_subscriptions_listen_on_a_stream_that_stays_open() {
    let served = serve(Settings::default()).await;
    let mut stream = EventStream::new(
        open(
            served.port,
            &per_request("listen", "subscriptions/listen", json!({})),
        )
        .await,
    );
    assert_eq!(
        stream.next().await,
        json!({
            "jsonrpc": "2.0",
            "method": "notifications/subscriptions/acknowledged",
            "params": { "_meta": { "io.modelcontextprotocol/subscriptionId": "listen" }, "notifications": {} },
        })
    );
    assert!(!stream.response.closed());
    stream.response.destroy().await;
    served.stop().await;
}

// Initialize-era sessions.

fn is_uuid_v4(text: &str) -> bool {
    let bytes = text.as_bytes();
    let hex = |range: std::ops::Range<usize>| {
        bytes[range]
            .iter()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(byte))
    };
    bytes.len() == 36
        && [8, 13, 18, 23].iter().all(|at| bytes[*at] == b'-')
        && hex(0..8)
        && hex(9..13)
        && bytes[14] == b'4'
        && hex(15..18)
        && b"89ab".contains(&bytes[19])
        && hex(20..23)
        && hex(24..36)
}

#[tokio::test]
async fn opens_a_session_on_a_successful_initialize_alone_with_a_uuid() {
    let served = serve(Settings::default()).await;
    let opened = send(served.port, &initialize("2025-06-18")).await;
    assert_eq!(opened.status, 200);
    let id = opened.header("mcp-session-id").unwrap();
    assert!(is_uuid_v4(&id), "{id}");
    assert_eq!(opened.json()["result"]["protocolVersion"], "2025-06-18");
    let failed = send(
        served.port,
        &in_session(None, 1, "initialize", Some(json!({ "capabilities": {} }))),
    )
    .await;
    assert_eq!(
        (
            failed.status,
            failed.header("mcp-session-id"),
            code_of(&failed.json())
        ),
        (200, None, json!(-32_602))
    );
    served.stop().await;
}

#[tokio::test]
async fn serves_tools_list_as_json_and_tools_call_as_a_stream_within_the_session() {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-11-25").await;
    let listed = send(
        served.port,
        &in_session(Some(&session), 1, "tools/list", None),
    )
    .await;
    assert_eq!(listed.status, 200);
    let message = listed.json();
    assert_eq!(message["id"], 1);
    assert!(message["result"]["tools"].is_array());
    assert_eq!(message["result"].as_object().unwrap().len(), 1);
    let called = send(
        served.port,
        &in_session(
            Some(&session),
            2,
            "tools/call",
            Some(json!({ "arguments": { "value": 1 }, "name": "echo" })),
        ),
    )
    .await;
    assert_eq!(
        called.header("content-type").as_deref(),
        Some("text/event-stream")
    );
    assert!(called.text.contains(r#""id":2"#), "{}", called.text);
    served.stop().await;
}

#[tokio::test]
async fn answers_a_second_initialize_in_the_session_with_200_and_32600_and_keeps_the_session() {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-11-25").await;
    let again = send(
        served.port,
        &initialize("2025-11-25").header("MCP-Session-Id", &session),
    )
    .await;
    assert_eq!(
        (
            again.status,
            again.header("mcp-session-id"),
            code_of(&again.json())
        ),
        (200, None, json!(-32_600))
    );
    assert_eq!(
        status_of(served.port, &in_session(Some(&session), 1, "ping", None)).await,
        200
    );
    served.stop().await;
}

#[tokio::test]
async fn answers_an_unknown_session_id_with_404_and_no_body_ping_and_initialize_included() {
    let served = serve(Settings::default()).await;
    for sent in [
        in_session(Some("unknown"), 1, "ping", None),
        in_session(Some("unknown"), 1, "tools/list", None),
        initialize("2025-11-25").header("MCP-Session-Id", "unknown"),
        Sent::json(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .header("MCP-Session-Id", "unknown"),
    ] {
        let answer = send(served.port, &sent).await;
        assert_eq!((answer.status, answer.text.as_str()), (404, ""));
    }
    served.stop().await;
}

#[tokio::test]
async fn answers_a_request_without_a_session_id_with_400_and_32602_except_initialize_and_ping() {
    let served = serve(Settings::default()).await;
    let listed = send(served.port, &in_session(None, 1, "tools/list", None)).await;
    let pinged = send(served.port, &in_session(None, 2, "ping", None)).await;
    assert_eq!(listed.status, 400);
    assert_eq!(
        listed.text,
        r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32602,"message":"The request carries no MCP-Session-Id. Send the session id the initialize response issued, or send \"io.modelcontextprotocol/protocolVersion\" and \"io.modelcontextprotocol/clientCapabilities\" in every request's params._meta, with MCP-Protocol-Version and Mcp-Method headers, and Mcp-Name for tools/call."}}"#
    );
    assert_eq!(pinged.status, 200);
    assert_eq!(pinged.text, r#"{"jsonrpc":"2.0","id":2,"result":{}}"#);
    served.stop().await;
}

#[tokio::test]
async fn answers_an_mcp_protocol_version_other_than_the_sessions_with_400_and_32600() {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-06-18").await;
    let answer = send(
        served.port,
        &in_session(Some(&session), 1, "tools/list", None)
            .header("MCP-Protocol-Version", "2025-11-25"),
    )
    .await;
    let matched = send(
        served.port,
        &in_session(Some(&session), 2, "tools/list", None)
            .header("MCP-Protocol-Version", "2025-06-18"),
    )
    .await;
    assert_eq!(
        (
            answer.status,
            answer.json()["id"].clone(),
            code_of(&answer.json())
        ),
        (400, json!(1), json!(-32_600))
    );
    assert_eq!(
        answer.json()["error"]["message"],
        "The MCP-Protocol-Version header names a version other than this session's, MCP 2025-06-18. Send 2025-06-18, or leave the header out."
    );
    assert_eq!(matched.status, 200);
    served.stop().await;
}

#[tokio::test]
async fn answers_a_session_request_whose_header_names_the_per_request_revision_as_any_other_mismatch()
 {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-11-25").await;
    let answer = send(
        served.port,
        &in_session(Some(&session), 1, "ping", None).header("MCP-Protocol-Version", "2026-07-28"),
    )
    .await;
    assert_eq!(
        (
            answer.status,
            answer.json()["id"].clone(),
            code_of(&answer.json())
        ),
        (400, json!(1), json!(-32_600))
    );
    served.stop().await;
}

#[tokio::test]
async fn answers_a_method_not_served_in_a_session_with_200_and_32601() {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-11-25").await;
    let answer = send(
        served.port,
        &in_session(Some(&session), 1, "resources/list", None),
    )
    .await;
    assert_eq!(
        (answer.status, code_of(&answer.json())),
        (200, json!(-32_601))
    );
    served.stop().await;
}

#[tokio::test]
async fn ends_a_session_on_delete_which_aborts_its_calls_and_then_answers_its_id_with_404() {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-11-25").await;
    let stream = EventStream::new(open(served.port, &session_wait(&session, 1, "one")).await);
    until("the call to start", || served.events.has("started one")).await;
    let deleted = send(
        served.port,
        &Sent::default()
            .method("DELETE")
            .header("MCP-Session-Id", &session),
    )
    .await;
    assert_eq!((deleted.status, deleted.text.as_str()), (204, ""));
    stream.ended().await;
    assert!(stream.events().is_empty());
    until("the call to abort", || served.events.len() == 2).await;
    assert_eq!(served.events.all(), ["started one", "aborted one"]);
    assert_eq!(
        status_of(served.port, &in_session(Some(&session), 2, "ping", None)).await,
        404
    );
    let again = send(
        served.port,
        &Sent::default()
            .method("DELETE")
            .header("MCP-Session-Id", &session),
    )
    .await;
    let none = send(served.port, &Sent::default().method("DELETE")).await;
    assert_eq!(
        (again.status, none.status, none.text.as_str()),
        (404, 400, "")
    );
    served.stop().await;
}

#[tokio::test]
async fn ends_a_session_idle_for_its_interval_and_a_call_in_flight_keeps_it() {
    let served = serve(Settings {
        session_idle: Some(Duration::from_millis(1000)),
        ..Settings::default()
    })
    .await;
    let timers = fake_timers();
    let idle = open_session(served.port, "2025-11-25").await;
    let busy = open_session(served.port, "2025-11-25").await;
    let stream = EventStream::new(open(served.port, &session_wait(&busy, 1, "long")).await);
    until("the call to start", || served.events.has("started long")).await;
    timers.advance(Duration::from_millis(999)).await;
    assert_eq!(
        status_of(served.port, &in_session(Some(&idle), 2, "ping", None)).await,
        200
    );
    timers.advance(Duration::from_millis(1000)).await;
    assert_eq!(
        status_of(served.port, &in_session(Some(&idle), 3, "ping", None)).await,
        404
    );
    served.release("long");
    stream.ended().await;
    timers.advance(Duration::from_millis(999)).await;
    assert_eq!(
        status_of(served.port, &in_session(Some(&busy), 4, "ping", None)).await,
        200
    );
    timers.advance(Duration::from_millis(1000)).await;
    assert_eq!(
        status_of(served.port, &in_session(Some(&busy), 5, "ping", None)).await,
        404
    );
    served.stop().await;
}

#[tokio::test]
async fn restarts_the_idle_clock_at_each_notification() {
    let served = serve(Settings {
        session_idle: Some(Duration::from_millis(1000)),
        ..Settings::default()
    })
    .await;
    let timers = fake_timers();
    let session = open_session(served.port, "2025-11-25").await;
    timers.advance(Duration::from_millis(900)).await;
    let noted = send(
        served.port,
        &Sent::json(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }))
            .header("MCP-Protocol-Version", "wrong")
            .header("MCP-Session-Id", &session),
    )
    .await;
    assert_eq!(noted.status, 202);
    timers.advance(Duration::from_millis(900)).await;
    assert_eq!(
        status_of(served.port, &in_session(Some(&session), 1, "ping", None)).await,
        200
    );
    served.stop().await;
}

// Cancellation and concurrency.

#[tokio::test]
async fn on_the_per_request_revision_a_closed_stream_cancels_its_call() {
    let served = serve(Settings::default()).await;
    let response = open(served.port, &wait_call(1, "one")).await;
    until("the call to start", || served.events.has("started one")).await;
    response.destroy().await;
    until("the call to abort", || served.events.has("aborted one")).await;
    assert_eq!(served.events.all(), ["started one", "aborted one"]);
    served.stop().await;
}

#[tokio::test]
async fn on_the_per_request_revision_a_closed_stream_ends_a_subscription() {
    let served = serve(Settings::default()).await;
    let mut stream = EventStream::new(
        open(
            served.port,
            &per_request("listen", "subscriptions/listen", json!({})),
        )
        .await,
    );
    stream.next().await;
    stream.response.destroy().await;
    stream.ended().await;
    // Let the server see the close before it stops.
    tokio::time::sleep(Duration::from_millis(20)).await;
    served.stop().await;
    // Shutdown finds no subscription left to tear down.
    assert_eq!(stream.events().len(), 1);
}

#[tokio::test]
async fn in_a_session_notifications_cancelled_aborts_the_call_it_names_and_its_stream_ends_without_a_response()
 {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-11-25").await;
    let stream = EventStream::new(open(served.port, &session_wait(&session, 1, "one")).await);
    until("the call to start", || served.events.has("started one")).await;
    let cancelled = send(
        served.port,
        &Sent::json(json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 1 } }))
            .header("MCP-Session-Id", &session),
    )
    .await;
    assert_eq!(cancelled.status, 202);
    stream.ended().await;
    assert!(stream.events().is_empty());
    until("the call to abort", || served.events.len() == 2).await;
    assert_eq!(served.events.all(), ["started one", "aborted one"]);
    served.stop().await;
}

#[tokio::test]
async fn in_a_session_a_closed_stream_does_not_cancel_the_call_runs_to_its_end() {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-11-25").await;
    let response = open(served.port, &session_wait(&session, 1, "one")).await;
    until("the call to start", || served.events.has("started one")).await;
    response.destroy().await;
    tokio::time::sleep(Duration::from_millis(50)).await;
    assert_eq!(served.events.all(), ["started one"]);
    served.release("one");
    until("the call to settle", || served.events.len() == 2).await;
    assert_eq!(served.events.all(), ["started one", "released one"]);
    // The session still serves, and the id is free again once the call settled.
    let again = send(
        served.port,
        &in_session(Some(&session), 1, "tools/list", None),
    )
    .await;
    assert_eq!(again.status, 200);
    assert!(again.json()["result"]["tools"].is_array());
    served.stop().await;
}

#[tokio::test]
async fn ignores_notifications_cancelled_without_a_session_and_on_the_per_request_revision() {
    let served = serve(Settings::default()).await;
    let mut stream = EventStream::new(open(served.port, &wait_call(1, "one")).await);
    until("the call to start", || served.events.has("started one")).await;
    let bare = send(
        served.port,
        &Sent::json(json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 1 } })),
    )
    .await;
    let per_request_note = send(
        served.port,
        &Sent::json(json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "_meta": meta(), "requestId": 1 } })),
    )
    .await;
    assert_eq!((bare.status, per_request_note.status), (202, 202));
    served.release("one");
    assert_eq!(stream.next().await["id"], 1);
    assert_eq!(served.events.all(), ["started one", "released one"]);
    served.stop().await;
}

#[tokio::test]
async fn two_clients_overlapping_calls_answer_on_their_own_streams() {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-11-25").await;
    let mut first = EventStream::new(open(served.port, &wait_call(1, "one")).await);
    let mut second = EventStream::new(open(served.port, &session_wait(&session, 1, "two")).await);
    until("both calls to start", || served.events.len() == 2).await;
    served.release("two");
    served.release("one");
    let one = first.next().await;
    let two = second.next().await;
    assert_eq!(
        (
            one["id"].clone(),
            one["result"]["content"][0]["text"].clone()
        ),
        (json!(1), json!("released one"))
    );
    assert_eq!(
        (
            two["id"].clone(),
            two["result"]["content"][0]["text"].clone()
        ),
        (json!(1), json!("released two"))
    );
    served.stop().await;
}

// Shutdown.

#[tokio::test]
async fn shutdown_aborts_every_call_answers_none_tears_down_each_subscription_closes_every_connection_and_resolves()
 {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-11-25").await;
    let mut listen = EventStream::new(
        open(
            served.port,
            &per_request("listen", "subscriptions/listen", json!({})),
        )
        .await,
    );
    listen.next().await;
    let call = EventStream::new(open(served.port, &wait_call(1, "one")).await);
    let session_call = EventStream::new(open(served.port, &session_wait(&session, 2, "two")).await);
    until("both calls to start", || served.events.len() == 2).await;
    let events = served.events.clone();
    served.stop().await;
    listen.ended().await;
    call.ended().await;
    session_call.ended().await;
    assert_eq!(
        listen.events()[1..],
        [
            json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": "listen" } }),
            json!({
                "id": "listen",
                "jsonrpc": "2.0",
                "result": {
                    "_meta": {
                        "io.modelcontextprotocol/serverInfo": server_info(),
                        "io.modelcontextprotocol/subscriptionId": "listen",
                    },
                    "resultType": "complete",
                },
            }),
        ]
    );
    assert!(call.events().is_empty());
    assert!(session_call.events().is_empty());
    let mut seen = events.all();
    seen.sort();
    assert_eq!(
        seen,
        ["aborted one", "aborted two", "started one", "started two"]
    );
}

// HTTP guard regressions.

#[tokio::test]
async fn refuses_an_empty_origin() {
    let served = serve(Settings::default()).await;
    let answer = send(
        served.port,
        &with_headers(
            per_request(1, "tools/list", json!({})),
            mirrored_with("tools/list", None, &[("Origin", "")]),
        ),
    )
    .await;
    assert_eq!(answer.status, 403);
    served.stop().await;
}

#[tokio::test]
async fn answers_a_declared_oversized_length_before_any_body_byte_arrives() {
    let served = serve(Settings {
        max_body_bytes: Some(64),
        ..Settings::default()
    })
    .await;
    let mut client = Raw::connect(served.port).await;
    client
        .write(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 65\r\n\r\n")
        .await;
    client.holds("413").await;
    assert!(
        client.text().starts_with("HTTP/1.1 413 "),
        "{}",
        client.text()
    );
    served.stop().await;
}

#[tokio::test]
async fn counts_many_separately_received_chunks_toward_the_body_limit() {
    let served = serve(Settings {
        max_body_bytes: Some(64),
        ..Settings::default()
    })
    .await;
    let mut client = Raw::connect(served.port).await;
    client
        .write(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n")
        .await;
    for _ in 0..10 {
        client.write(b"10\r\nxxxxxxxxxxxxxxxx\r\n").await;
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    client.end(b"0\r\n\r\n").await;
    client.holds("413").await;
    assert!(
        client.text().starts_with("HTTP/1.1 413 "),
        "{}",
        client.text()
    );
    client.ended().await;
    served.stop().await;
}

#[tokio::test]
async fn does_not_arm_receipt_deadlines_over_a_pipelined_response_in_flight() {
    let served = serve(Settings::default()).await;
    let timers = fake_timers();
    let mut client = Raw::connect(served.port).await;
    let packets: String = ["one", "two"]
        .iter()
        .enumerate()
        .map(|(index, label)| {
            let sent = wait_call(index, label);
            let Some(Body::Json(body)) = &sent.body else { unreachable!() };
            let body = body.to_string();
            let mirrored: String = sent
                .headers
                .iter()
                .map(|(name, value)| format!("{name}: {value}\r\n"))
                .collect();
            format!(
                "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{mirrored}\r\n{body}",
                body.len()
            )
        })
        .collect();
    client.write(packets.as_bytes()).await;
    until("the first call to start", || served.events.len() == 1).await;
    timers.advance(Duration::from_millis(3000)).await;
    served.release("one");
    client.holds("released one").await;
    until("the second call to start", || served.events.len() == 3).await;
    timers.advance(Duration::from_millis(300_000)).await;
    assert_eq!(
        served.events.all(),
        ["started one", "released one", "started two"]
    );
    assert!(!client.text().contains("408"), "{}", client.text());
    served.release("two");
    client.holds("released two").await;
    served.stop().await;
}

#[tokio::test]
async fn a_session_cannot_cancel_another_session_using_the_same_request_id() {
    let served = serve(Settings::default()).await;
    let one = open_session(served.port, "2025-11-25").await;
    let two = open_session(served.port, "2025-11-25").await;
    let first = EventStream::new(open(served.port, &session_wait(&one, 1, "one")).await);
    let mut second = EventStream::new(open(served.port, &session_wait(&two, 1, "two")).await);
    until("both calls to start", || served.events.len() == 2).await;
    send(
        served.port,
        &Sent::json(json!({ "jsonrpc": "2.0", "method": "notifications/cancelled", "params": { "requestId": 1 } }))
            .header("MCP-Session-Id", &one),
    )
    .await;
    first.ended().await;
    until("the first call to abort", || served.events.len() == 3).await;
    let mut seen = served.events.all();
    seen[..2].sort();
    assert_eq!(seen, ["started one", "started two", "aborted one"]);
    served.release("two");
    assert_eq!(second.next().await["id"], 1);
    served.stop().await;
}

#[tokio::test]
async fn in_session_requests_restart_the_idle_clock() {
    let served = serve(Settings {
        session_idle: Some(Duration::from_millis(1000)),
        ..Settings::default()
    })
    .await;
    let timers = fake_timers();
    let session = open_session(served.port, "2025-11-25").await;
    timers.advance(Duration::from_millis(900)).await;
    assert_eq!(
        status_of(served.port, &in_session(Some(&session), 1, "ping", None)).await,
        200
    );
    timers.advance(Duration::from_millis(900)).await;
    assert_eq!(
        status_of(served.port, &in_session(Some(&session), 2, "ping", None)).await,
        200
    );
    served.stop().await;
}

#[tokio::test]
async fn shutdown_awaits_a_deleted_session_whose_aborted_call_is_still_settling() {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-11-25").await;
    let stream = EventStream::new(open(served.port, &session_wait(&session, 1, "settling")).await);
    until("the call to start", || {
        served.events.has("started settling")
    })
    .await;
    send(
        served.port,
        &Sent::default()
            .method("DELETE")
            .header("MCP-Session-Id", &session),
    )
    .await;
    let releases = served_release(&served);
    let mut stopping = served.stopping();
    tokio::time::sleep(Duration::from_millis(30)).await;
    assert!(
        tokio::time::timeout(Duration::from_millis(1), &mut stopping)
            .await
            .is_err(),
        "the transport closed before the call settled"
    );
    releases("settling");
    tokio::time::timeout(Duration::from_secs(10), stopping)
        .await
        .unwrap()
        .unwrap();
    stream.ended().await;
}

/// A release function that outlives the served handle.
fn served_release(served: &Served) -> impl Fn(&str) + use<> {
    let releaser = served.releaser();
    move |label| releaser(label)
}

#[tokio::test]
async fn every_early_answer_explicitly_closes_a_keep_alive_connection() {
    let served = serve(Settings {
        authorize: Some(Arc::new(|headers| {
            match headers.get("x-status").as_deref() {
                Some("500") => Authorization::Failed,
                Some("401") => Authorization::Refused,
                _ => Authorization::Allowed,
            }
        })),
        max_body_bytes: Some(64),
        ..Settings::default()
    })
    .await;
    for (code, extra, path, method, kind) in [
        (401, "X-Status: 401\r\n", "/mcp", "POST", "application/json"),
        (403, "Origin: \r\n", "/mcp", "POST", "application/json"),
        (404, "", "/other", "POST", "application/json"),
        (405, "", "/mcp", "GET", "application/json"),
        (413, "", "/mcp", "POST", "application/json"),
        (415, "", "/mcp", "POST", "text/plain"),
        (500, "X-Status: 500\r\n", "/mcp", "POST", "application/json"),
    ] {
        let mut client = Raw::connect(served.port).await;
        client
            .write(
                format!("{method} {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\nContent-Type: {kind}\r\nContent-Length: 100\r\n{extra}\r\n")
                    .as_bytes(),
            )
            .await;
        client.holds("\r\n\r\n").await;
        let text = client.text();
        assert!(text.contains(&format!("HTTP/1.1 {code} ")), "{text}");
        assert!(
            text.to_lowercase().contains("connection: close\r\n"),
            "{text}"
        );
    }
    served.stop().await;
}

#[tokio::test]
async fn re_arms_receipt_deadlines_after_a_keep_alive_response() {
    let served = serve(Settings::default()).await;
    let timers = fake_timers();
    let mut client = Raw::connect(served.port).await;
    client
        .write(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 45\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}     ")
        .await;
    client.holds("\"result\"").await;
    client.write(b"POST /mcp HTTP/1.1\r\n").await;
    timers.advance(Duration::from_millis(60_000)).await;
    client.ended().await;
    assert!(client.text().contains("HTTP/1.1 408"), "{}", client.text());
    served.stop().await;
}

#[tokio::test]
async fn shutdown_closes_even_sockets_with_no_request_yet() {
    let served = serve(Settings::default()).await;
    let client = Raw::connect(served.port).await;
    until("the server to accept", || served.accepted() == 1).await;
    served.stop().await;
    client.ended().await;
}

#[tokio::test]
async fn an_open_stream_outlives_an_idle_interval() {
    let served = serve(Settings::default()).await;
    let mut stream = EventStream::new(open(served.port, &wait_call(1, "idle")).await);
    until("the call to start", || served.events.has("started idle")).await;
    tokio::time::sleep(Duration::from_millis(150)).await;
    assert!(!stream.response.closed());
    served.release("idle");
    assert_eq!(stream.next().await["id"], 1);
    served.stop().await;
}

#[tokio::test]
async fn authorization_resolving_after_shutdown_never_dispatches_a_call() {
    let pending = Arc::new(Mutex::new(None));
    let asked = Arc::clone(&pending);
    let served = serve(Settings {
        held_authorize: Some(Arc::new(move || {
            let (allow, allowed) = tokio::sync::oneshot::channel();
            *asked.lock().unwrap() = Some(allow);
            allowed
        })),
        ..Settings::default()
    })
    .await;
    let port = served.port;
    let answer = tokio::spawn(async move { open(port, &wait_call(1, "late")).await.ended().await });
    until("the hook to be asked", || pending.lock().unwrap().is_some()).await;
    let events = served.events.clone();
    served.stop().await;
    let allow = pending.lock().unwrap().take().unwrap();
    let _ = allow.send(Authorization::Allowed);
    answer.await.unwrap();
    tokio::time::sleep(Duration::from_millis(10)).await;
    assert!(events.all().is_empty());
}

#[tokio::test]
async fn refuses_a_malformed_response_envelope() {
    let served = serve(Settings::default()).await;
    for body in [
        json!({ "result": {} }),
        json!({ "error": { "code": -32_600, "message": "bad" } }),
    ] {
        let answer = send(served.port, &Sent::json(body.clone())).await;
        assert_eq!(answer.status, 400, "{body}");
        assert_eq!(code_of(&answer.json()), -32_600, "{body}");
    }
    served.stop().await;
}

#[tokio::test]
async fn a_pinned_http_version_requires_per_request_metadata_even_for_ping() {
    let served = serve(Settings::default()).await;
    let ping = in_session(None, 1, "ping", None);
    let answer = send(
        served.port,
        &with_headers(ping.clone(), mirrored("ping", None)),
    )
    .await;
    assert_eq!(answer.status, 400);
    assert_eq!(code_of(&answer.json()), -32_602);
    assert_eq!(status_of(served.port, &ping).await, 200);
    served.stop().await;
}

#[tokio::test]
async fn per_request_initialize_is_not_a_served_method() {
    let served = serve(Settings::default()).await;
    let answer = send(served.port, &per_request(1, "initialize", json!({}))).await;
    assert_eq!(answer.status, 404);
    assert_eq!(code_of(&answer.json()), -32_601);
    served.stop().await;
}

#[tokio::test]
async fn a_long_session_idle_interval_expires_at_its_deadline() {
    let served = serve(Settings {
        session_idle: Some(Duration::from_millis(2_147_484_647)),
        ..Settings::default()
    })
    .await;
    let timers = fake_timers();
    let session = open_session(served.port, "2025-11-25").await;
    timers.advance(Duration::from_millis(1000)).await;
    assert_eq!(
        status_of(served.port, &in_session(Some(&session), 1, "ping", None)).await,
        200
    );
    timers.advance(Duration::from_millis(2_147_483_647)).await;
    assert_eq!(
        status_of(served.port, &in_session(Some(&session), 2, "ping", None)).await,
        200
    );
    timers.advance(Duration::from_millis(2_147_484_647)).await;
    assert_eq!(
        status_of(served.port, &in_session(Some(&session), 3, "ping", None)).await,
        404
    );
    served.stop().await;
}

const PING: &str = r#"{"jsonrpc":"2.0","id":1,"method":"ping"}"#;

/// A raw POST of `body` to the endpoint, whose length its `Content-Length` declares.
fn post(body: &str) -> String {
    format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    )
}

#[tokio::test]
async fn shutdown_closes_a_socket_whose_headers_are_half_sent_with_no_answer() {
    let served = serve(Settings::default()).await;
    let mut client = Raw::connect(served.port).await;
    until("the server to accept", || served.accepted() == 1).await;
    client
        .write(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n")
        .await;
    // Let the server read the bytes, so the socket has begun a request when shutdown arrives.
    for _ in 0..64 {
        tokio::task::yield_now().await;
    }
    served.stop().await;
    client.ended().await;
    assert_eq!(client.text(), "");
}

#[tokio::test]
async fn shutdown_closes_a_socket_whose_headers_are_half_sent_before_any_deadline() {
    let served = serve(Settings::default()).await;
    let timers = fake_timers();
    let mut client = Raw::connect(served.port).await;
    until("the server to accept", || served.accepted() == 1).await;
    client
        .write(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n")
        .await;
    timers.advance(Duration::from_millis(10)).await;
    served.stop().await;
    // The paused clock holds the header deadline back while the socket is awaited.
    client.ended().await;
    timers.advance(Duration::from_millis(60_000)).await;
    assert_eq!(client.text(), "");
}

#[tokio::test]
async fn closes_a_kept_alive_socket_idle_after_its_response_and_writes_nothing() {
    let served = serve(Settings::default()).await;
    let timers = fake_timers();
    let mut client = Raw::connect(served.port).await;
    client.write(post(PING).as_bytes()).await;
    client.holds("\"result\"").await;
    assert!(
        client.text().contains("\r\nkeep-alive: timeout=5\r\n"),
        "{}",
        client.text()
    );
    timers.advance(Duration::from_millis(6_000)).await;
    client.ended().await;
    assert_eq!(
        client.text().matches("HTTP/1.1 ").count(),
        1,
        "{}",
        client.text()
    );
    assert!(!client.text().contains("408"), "{}", client.text());
    served.stop().await;
}

#[tokio::test]
async fn serves_a_request_that_arrives_on_a_kept_alive_socket_inside_its_idle_window() {
    let served = serve(Settings::default()).await;
    let timers = fake_timers();
    let mut client = Raw::connect(served.port).await;
    client.write(post(PING).as_bytes()).await;
    client.holds("\"id\":1,\"result\"").await;
    for id in [2, 3] {
        timers.advance(Duration::from_millis(5_999)).await;
        assert!(!client.is_ended(), "{}", client.text());
        let ping = PING.replace("\"id\":1", &format!("\"id\":{id}"));
        client.write(post(&ping).as_bytes()).await;
        client.holds(&format!("\"id\":{id},\"result\"")).await;
    }
    served.stop().await;
}

#[tokio::test]
async fn answers_headers_over_the_limits_with_431_before_the_hook() {
    let served = serve(Settings::default()).await;
    let long = format!("X-Big: {}\r\n", "a".repeat(16_384));
    // Short enough to stay under the byte limit, so the count alone refuses it.
    let many = "a:1\r\n".repeat(2_001);
    for extra in [long, many] {
        let mut client = Raw::connect(served.port).await;
        client
            .write(format!("POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\n{extra}Content-Type: application/json\r\nContent-Length: {}\r\n\r\n{PING}", PING.len()).as_bytes())
            .await;
        client.ended().await;
        assert!(
            client.text().starts_with("HTTP/1.1 431 "),
            "{}",
            client.text()
        );
    }
    assert_eq!(served.requests(), 0, "the hook judged a request");
    served.stop().await;
}

#[tokio::test]
async fn closes_a_connect_request_with_no_answer_before_the_hook() {
    let served = serve(Settings::default()).await;
    let mut client = Raw::connect(served.port).await;
    client
        .write(b"CONNECT 127.0.0.1:443 HTTP/1.1\r\nHost: 127.0.0.1:443\r\n\r\n")
        .await;
    client.ended().await;
    assert_eq!((client.text(), served.requests()), (String::new(), 0));
    served.stop().await;
}

#[tokio::test]
async fn a_panicking_hook_ends_its_own_connection_while_another_is_served() {
    let served = serve(Settings {
        authorize: Some(Arc::new(|headers| {
            assert!(headers.get("x-panic").is_none(), "the hook panics");
            Authorization::Allowed
        })),
        ..Settings::default()
    })
    .await;
    let mut stream = EventStream::new(open(served.port, &wait_call(1, "kept")).await);
    until("the call to start", || served.events.has("started kept")).await;
    let mut panicking = Raw::connect(served.port).await;
    panicking
        .write(
            post(PING)
                .replace("Host: 127.0.0.1\r\n", "Host: 127.0.0.1\r\nX-Panic: 1\r\n")
                .as_bytes(),
        )
        .await;
    panicking.ended().await;
    assert_eq!(panicking.text(), "");
    served.release("kept");
    assert_eq!(stream.next().await["id"], 1);
    let mut next = Raw::connect(served.port).await;
    next.write(post(PING).as_bytes()).await;
    next.holds("\"id\":1,\"result\":{}").await;
    served.stop().await;
}

#[tokio::test]
async fn serves_a_body_exactly_at_the_limit_declared_or_chunked() {
    let served = serve(Settings {
        max_body_bytes: Some(PING.len() as u64),
        ..Settings::default()
    })
    .await;
    let chunked = format!(
        "POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n{:x}\r\n{PING}\r\n0\r\n\r\n",
        PING.len()
    );
    for sent in [post(PING), chunked] {
        let mut client = Raw::connect(served.port).await;
        client.write(sent.as_bytes()).await;
        client.holds("\r\n\r\n").await;
        assert!(
            client.text().starts_with("HTTP/1.1 200 "),
            "{}",
            client.text()
        );
    }
    served.stop().await;
}

#[tokio::test]
async fn refuses_an_origin_on_every_method_before_the_hook() {
    let served = serve(Settings::default()).await;
    for method in ["POST", "DELETE", "GET", "OPTIONS", "PUT"] {
        let mut client = Raw::connect(served.port).await;
        client
            .write(format!("{method} /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nOrigin: https://evil.example\r\nMcp-Session-Id: 00000000-0000-4000-8000-000000000000\r\nContent-Type: application/json\r\nContent-Length: 0\r\n\r\n").as_bytes())
            .await;
        client.holds("\r\n\r\n").await;
        assert!(
            client.text().starts_with("HTTP/1.1 403 "),
            "{method}: {}",
            client.text()
        );
    }
    assert_eq!(
        served.requests(),
        0,
        "the hook judged a request that carried an Origin"
    );
    served.stop().await;
}

#[tokio::test]
async fn a_request_after_a_long_stream_gets_its_own_deadline() {
    let served = serve(Settings::default()).await;
    let timers = fake_timers();
    let mut client = Raw::connect(served.port).await;
    client.write(&wait_call(1, "long").bytes()).await;
    until("the call to start", || served.events.has("started long")).await;
    timers.advance(Duration::from_millis(400_000)).await;
    served.release("long");
    client.holds("0\r\n\r\n").await;
    let ping = post(PING);
    let (head, body) = ping.split_at(ping.len() - PING.len());
    client.write(head.as_bytes()).await;
    timers.advance(Duration::from_millis(10)).await;
    client.write(body.as_bytes()).await;
    client.holds("\"id\":1,\"result\":{}").await;
    assert!(!client.text().contains("408"), "{}", client.text());
    served.stop().await;
}

// Two POSTs of one session on two sockets, with one id, can reach two worker threads at once. One
// handler starts, and the other request is refused with the reference's id-in-use error, whether
// admission or the start caught it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn starts_one_handler_for_two_concurrent_session_requests_with_one_id_on_four_workers() {
    let served = serve(Settings::default()).await;
    let session = open_session(served.port, "2025-11-25").await;
    for round in 0..200 {
        let id = 1000 + round;
        let labels = [format!("a{round}"), format!("b{round}")];
        let (sent_a, sent_b) = (
            session_wait(&session, id, &labels[0]),
            session_wait(&session, id, &labels[1]),
        );
        let (a, b) = tokio::join!(open(served.port, &sent_a), open(served.port, &sent_b));
        // A response's head is written only once its request began, so both have been judged.
        a.status().await;
        b.status().await;
        let started = labels
            .each_ref()
            .map(|label| served.events.has(&format!("started {label}")));
        assert_eq!(
            started.iter().filter(|each| **each).count(),
            1,
            "round {round}: {:?}",
            served.events.all()
        );
        let (running, refused, label) = if started[0] {
            (&a, &b, &labels[0])
        } else {
            (&b, &a, &labels[1])
        };
        let refusal = refused.read_all().await;
        assert!(
            refusal.text.contains(r#""code":-32600"#)
                && refusal
                    .text
                    .contains("The request id is in use by a request still in flight."),
            "round {round}: {}",
            refusal.text
        );
        served.release(label);
        let answer = running.read_all().await;
        assert!(
            answer.text.contains(&format!("released {label}")),
            "round {round}: {}",
            answer.text
        );
    }
    served.stop().await;
}

// Session calls that found their session just before shutdown silenced it begin after: none
// starts a handler shutdown cannot reach, so `closed` resolves and every started call aborted.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn closes_while_session_calls_race_the_shutdown_on_four_workers() {
    for round in 0..100 {
        let served = serve(Settings::default()).await;
        let session = open_session(served.port, "2025-11-25").await;
        let mut opened = Vec::new();
        for call in 0..16 {
            let sent = session_wait(&session, call + 1, &format!("c{call}"));
            let port = served.port;
            opened.push(tokio::spawn(async move { open(port, &sent).await }));
        }
        // Signal once a round-varying number of the calls' headers arrived, so the signal falls
        // at a different point of the calls' way in each round.
        let wanted = 1 + round % 16;
        until("the calls' headers", || served.requests() > wanted).await;
        let events = served.events.clone();
        let release = served.releaser();
        let closed = tokio::time::timeout(PATIENCE, served.stopping()).await;
        if closed.is_err() {
            for call in 0..16 {
                release(&format!("c{call}"));
            }
            panic!("round {round}: closed never resolved; {:?}", events.all());
        }
        let all = events.all();
        let count = |prefix: &str| all.iter().filter(|each| each.starts_with(prefix)).count();
        assert_eq!(count("started"), count("aborted"), "round {round}: {all:?}");
        for each in opened {
            each.abort();
        }
    }
}

// A session call can find its session just before a DELETE ends it, and begin after. It starts no
// handler on the ended session: it is answered as a call to an unknown session, 404, or it began
// in time and the DELETE aborted it.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn answers_a_call_that_races_its_sessions_delete_with_404_or_aborts_it_on_four_workers() {
    let served = serve(Settings::default()).await;
    for round in 0..200 {
        let session = open_session(served.port, "2025-11-25").await;
        let labels: Vec<String> = (0..4).map(|call| format!("r{round}c{call}")).collect();
        let sent: Vec<Sent> = labels
            .iter()
            .enumerate()
            .map(|(call, label)| session_wait(&session, call + 1, label))
            .collect();
        let delete = Sent::default()
            .method("DELETE")
            .header("MCP-Session-Id", &session);
        let port = served.port;
        let (calls, deleted) = tokio::join!(
            async {
                tokio::join!(
                    open(port, &sent[0]),
                    open(port, &sent[1]),
                    open(port, &sent[2]),
                    open(port, &sent[3])
                )
            },
            send(port, &delete),
        );
        assert_eq!(deleted.status, 204, "round {round}");
        let (a, b, c, d) = calls;
        for (call, label) in [a, b, c, d].iter().zip(&labels) {
            let answer = call.read_all().await;
            let started = served.events.has(&format!("started {label}"));
            assert!(
                (answer.status == 404 && !started) || (answer.status == 200 && started),
                "round {round}, {label}: {} {}",
                answer.status,
                answer.text
            );
        }
        // A call's stream ends as the DELETE aborts it, and its handler then settles on its own.
        let events = served.events.clone();
        let marker = format!("r{round}c");
        let ours = move |prefix: &str| {
            events
                .all()
                .iter()
                .filter(|each| each.starts_with(prefix) && each.contains(&marker))
                .count()
        };
        until("every started call to abort", || {
            ours("started ") == ours("aborted ")
        })
        .await;
    }
    served.stop().await;
}
