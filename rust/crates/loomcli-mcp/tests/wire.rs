//! The bytes the server writes, and how it reads and writes a stream under load.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::time::Duration;

use common::{bare, handshake_request, initialize, meta, open, request};
use loomcli_mcp::{McpServer, ProtocolError, ServerInfo, Tool, ToolCall, ToolResult, ToolSource};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader, duplex};

const META_TEXT: &str = r#"{"io.modelcontextprotocol/clientCapabilities":{},"io.modelcontextprotocol/protocolVersion":"2026-07-28"}"#;
const SERVER_INFO_TEXT: &str = r#""io.modelcontextprotocol/serverInfo":{"name":"fixture","version":"1.2.3","description":"A conformance fixture."}"#;

/// Runs one raw input to its end and returns every line the server wrote.
async fn lines_for(raw: &str) -> Vec<String> {
    let mut session = open();
    session.send_raw(raw).await;
    session.close().await.lines
}

#[tokio::test]
async fn writes_a_call_result_in_the_references_key_order() {
    let raw = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"_meta":{META_TEXT},"name":"echo","arguments":{{"a":1}}}}}}"#
    );
    let lines = lines_for(&format!("{raw}\n")).await;
    assert_eq!(
        lines,
        [format!(
            r#"{{"jsonrpc":"2.0","id":1,"result":{{"resultType":"complete","content":[{{"type":"text","text":"first line\nsecond line"}}],"isError":false,"structuredContent":{{"arguments":{{"a":1}},"name":"echo"}},"_meta":{{{SERVER_INFO_TEXT}}}}}}}"#
        )]
    );
}

#[tokio::test]
async fn writes_an_initialize_result_in_the_references_key_order() {
    let lines = lines_for(&format!("{}\n", initialize(0, "2025-11-25"))).await;
    assert_eq!(
        lines,
        [
            r#"{"jsonrpc":"2.0","id":0,"result":{"protocolVersion":"2025-11-25","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1.2.3","description":"A conformance fixture."}}}"#
        ]
    );
}

#[tokio::test]
async fn writes_an_error_with_data_in_the_references_key_order() {
    let raw = request(3, "tools/call", json!({ "name": "refuse" }));
    let lines = lines_for(&format!("{raw}\n")).await;
    assert_eq!(
        lines,
        [
            r#"{"jsonrpc":"2.0","id":3,"error":{"code":-32602,"message":"Refused.","data":{"reason":"fixture"}}}"#
        ]
    );
}

#[tokio::test]
async fn writes_a_parse_error_with_a_null_id_and_no_data() {
    let lines = lines_for("not json\n").await;
    assert_eq!(
        lines,
        [
            r#"{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"The line is not JSON. Send one JSON-RPC message as one line of JSON."}}"#
        ]
    );
}

#[tokio::test]
async fn writes_progress_in_the_references_key_order_before_the_answer() {
    let mut meta = meta();
    meta["progressToken"] = json!("t");
    let call = json!({
        "id": 1, "jsonrpc": "2.0", "method": "tools/call",
        "params": { "_meta": meta, "name": "progress",
            "arguments": { "updates": [{ "message": "m", "progress": 1, "total": 2 }] } },
    });
    let lines = lines_for(&format!("{call}\n")).await;
    assert_eq!(lines.len(), 2);
    assert_eq!(
        lines[0],
        r#"{"jsonrpc":"2.0","method":"notifications/progress","params":{"progressToken":"t","progress":1,"total":2,"message":"m"}}"#
    );
    assert!(lines[1].starts_with(r#"{"jsonrpc":"2.0","id":1,"result":"#));
}

#[tokio::test]
async fn writes_the_subscription_acknowledgement_and_closing_result_in_the_references_key_order() {
    let lines = lines_for(&format!("{}\n", bare("s", "subscriptions/listen"))).await;
    assert_eq!(
        lines,
        [
            r#"{"jsonrpc":"2.0","method":"notifications/subscriptions/acknowledged","params":{"notifications":{},"_meta":{"io.modelcontextprotocol/subscriptionId":"s"}}}"#.to_owned(),
            r#"{"jsonrpc":"2.0","method":"notifications/cancelled","params":{"requestId":"s"}}"#.to_owned(),
            format!(
                r#"{{"jsonrpc":"2.0","id":"s","result":{{"resultType":"complete","_meta":{{"io.modelcontextprotocol/subscriptionId":"s",{SERVER_INFO_TEXT}}}}}}}"#
            ),
        ]
    );
}

fn structured_call(id: &str, value_text: &str) -> String {
    format!(
        r#"{{"jsonrpc":"2.0","id":{id},"method":"tools/call","params":{{"_meta":{META_TEXT},"name":"structured","arguments":{{"value":{value_text}}}}}}}"#
    )
}

#[tokio::test]
async fn writes_a_whole_float_in_structured_content_as_an_integer() {
    let lines = lines_for(&format!(
        "{}\n",
        structured_call("1", r#"{"x":1.0,"y":2.50,"z":-0.0,"w":1e21,"v":1.5e-7}"#)
    ))
    .await;
    assert!(
        lines[0].contains(r#""structuredContent":{"x":1,"y":2.5,"z":0,"w":1e+21,"v":1.5e-7}"#),
        "{}",
        lines[0]
    );
}

#[tokio::test]
async fn writes_progress_numbers_as_javascript_does() {
    let mut meta = meta();
    meta["progressToken"] = json!(1);
    let head = format!(
        r#"{{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{{"_meta":{},"name":"progress","arguments":{{"updates":["#,
        meta
    );
    let updates = r#"{"progress":1e16},{"progress":0.000001},{"progress":1.2345678901234568e20},{"progress":1e-7,"total":123456.789}"#;
    let lines = lines_for(&format!("{head}{updates}]}}}}}}\n")).await;
    let progress: Vec<&str> = lines[..4]
        .iter()
        .map(|line| line.split_once(r#""params":"#).unwrap().1)
        .collect();
    assert_eq!(
        progress,
        [
            r#"{"progressToken":1,"progress":10000000000000000}}"#,
            r#"{"progressToken":1,"progress":0.000001}}"#,
            r#"{"progressToken":1,"progress":123456789012345680000}}"#,
            r#"{"progressToken":1,"progress":1e-7,"total":123456.789}}"#,
        ]
    );
}

#[tokio::test]
async fn echoes_a_large_whole_float_id_as_javascript_writes_it() {
    let lines = lines_for(&format!("{}\n", structured_call("1e16", "null"))).await;
    assert!(
        lines[0].starts_with(r#"{"jsonrpc":"2.0","id":10000000000000000,"#),
        "{}",
        lines[0]
    );
}

#[tokio::test]
async fn treats_ids_that_are_the_same_javascript_number_as_one_id() {
    let mut session = open();
    let wait = |id: &str| {
        format!(
            r#"{{"jsonrpc":"2.0","id":{id},"method":"tools/call","params":{{"_meta":{META_TEXT},"name":"wait","arguments":{{"label":"a"}}}}}}"#
        )
    };
    session.send_raw(&format!("{}\n", wait("1e16"))).await;
    session.observed("started a").await;
    session
        .send_raw(&format!("{}\n", wait("10000000000000000")))
        .await;
    let answer = session.next().await;
    assert_eq!(answer["error"]["code"], -32_600);
    assert!(
        answer["error"]["message"]
            .as_str()
            .unwrap()
            .contains("The request id 10000000000000000 is in use"),
        "{answer}"
    );
    session.close().await;
}

#[tokio::test]
async fn serves_a_stream_that_starts_with_a_byte_order_mark() {
    let lines = lines_for(&format!("\u{feff}{}\n", bare(1, "tools/list"))).await;
    assert_eq!(lines.len(), 1);
    assert!(lines[0].starts_with(r#"{"jsonrpc":"2.0","id":1,"result":"#));
}

/// A source with no tools.
struct Plain;

impl ToolSource for Plain {
    async fn list_tools(&self) -> Result<Vec<Tool>, ProtocolError> {
        Ok(Vec::new())
    }

    async fn call_tool(&self, _call: ToolCall) -> Result<ToolResult, ProtocolError> {
        Ok(ToolResult::default())
    }
}

#[tokio::test]
async fn serves_a_byte_order_mark_split_across_two_reads_once() {
    let (mut client, server_in) = duplex(4096);
    let (server_out, mut reader) = duplex(4096);
    let server = McpServer::new(ServerInfo::new("wire", "0.0.0"), Plain);
    let running =
        tokio::spawn(async move { server.run(BufReader::new(server_in), server_out).await });
    let mut bytes = vec![0xEF, 0xBB, 0xBF];
    bytes.extend_from_slice(format!("{}\n", bare(1, "tools/list")).as_bytes());
    client.write_all(&bytes[..2]).await.unwrap();
    client.flush().await.unwrap();
    tokio::time::sleep(Duration::from_millis(50)).await;
    client.write_all(&bytes[2..]).await.unwrap();
    client.shutdown().await.unwrap();
    running.await.unwrap().unwrap();
    let mut written = String::new();
    reader.read_to_string(&mut written).await.unwrap();
    let answer: Value = serde_json::from_str(&written).unwrap();
    assert_eq!(answer["id"], 1);
    assert!(answer["result"].is_object(), "{answer}");
}

#[tokio::test]
async fn keeps_reading_while_the_client_has_not_read_any_answer() {
    // The output pipe holds 1 KiB, far less than the answers, and nothing reads it until every
    // request has been written.
    let (mut client, server_in) = duplex(4096);
    let (server_out, mut reader) = duplex(1024);
    let server = McpServer::new(ServerInfo::new("wire", "0.0.0"), Plain);
    let running =
        tokio::spawn(async move { server.run(BufReader::new(server_in), server_out).await });
    let count = 2_000;
    let writing = tokio::spawn(async move {
        for id in 0..count {
            let line = format!("{}\n", handshake_request(id, "ping", None));
            client.write_all(line.as_bytes()).await.unwrap();
        }
        client.shutdown().await.unwrap();
    });
    tokio::time::timeout(Duration::from_secs(10), writing)
        .await
        .expect("the server stopped reading while its answers went unread")
        .unwrap();
    let mut written = String::new();
    reader.read_to_string(&mut written).await.unwrap();
    running.await.unwrap().unwrap();
    // `ping` before `initialize` is allowed, so each request is answered.
    assert_eq!(written.lines().count(), usize::try_from(count).unwrap());
}
