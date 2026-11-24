//! Ports of the reference's stream tests, over in-memory pipes.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::sync::Arc;

use loomcli_mcp::{McpServer, ProtocolError, ServerInfo, Tool, ToolCall, ToolResult, ToolSource};
use serde_json::{Value, json};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader, duplex};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

/// A source that lists nothing and echoes a call's arguments as its output.
struct Plain;

impl ToolSource for Plain {
    async fn list_tools(&self) -> Result<Vec<Tool>, ProtocolError> {
        Ok(Vec::new())
    }

    async fn call_tool(&self, call: ToolCall) -> Result<ToolResult, ProtocolError> {
        Ok(ToolResult {
            output: serde_json::to_string(&call.arguments).unwrap_or_default(),
            ..ToolResult::default()
        })
    }
}

fn line(message: &Value) -> String {
    format!("{message}\n")
}

#[tokio::test]
async fn serves_over_streams_and_resolves_when_the_input_ends() {
    let (mut client, server_in) = duplex(4096);
    let (server_out, mut reader) = duplex(4096);
    let server = McpServer::new(ServerInfo::new("streams", "0.0.0"), Plain);
    let running =
        tokio::spawn(async move { server.run(BufReader::new(server_in), server_out).await });
    client
        .write_all(line(&common::bare(1, "tools/list")).as_bytes())
        .await
        .unwrap();
    client.shutdown().await.unwrap();
    running.await.unwrap().unwrap();
    let mut written = String::new();
    reader.read_to_string(&mut written).await.unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(&written).unwrap(),
        json!({
            "id": 1,
            "jsonrpc": "2.0",
            "result": {
                "_meta": { "io.modelcontextprotocol/serverInfo": { "name": "streams", "version": "0.0.0" } },
                "cacheScope": "private",
                "resultType": "complete",
                "tools": [],
                "ttlMs": 0,
            },
        })
    );
}

#[tokio::test]
async fn resolves_at_once_and_reads_nothing_when_the_token_has_already_been_cancelled() {
    let (_client, server_in) = duplex(4096);
    let (server_out, mut reader) = duplex(4096);
    let server = McpServer::new(ServerInfo::new("streams", "0.0.0"), Plain);
    let shutdown = CancellationToken::new();
    shutdown.cancel();
    server
        .run_until(BufReader::new(server_in), server_out, shutdown)
        .await
        .unwrap();
    let mut written = Vec::new();
    reader.read_to_end(&mut written).await.unwrap();
    assert!(written.is_empty());
}

#[tokio::test]
async fn decodes_a_character_split_across_two_chunks_once() {
    let (mut client, server_in) = duplex(4096);
    let (server_out, mut reader) = duplex(4096);
    let server = McpServer::new(ServerInfo::new("streams", "0.0.0"), Plain);
    let running =
        tokio::spawn(async move { server.run(BufReader::new(server_in), server_out).await });
    let bytes = line(&common::request(
        1,
        "tools/call",
        json!({ "arguments": { "text": "é" }, "name": "echo" }),
    ))
    .into_bytes();
    let at = bytes
        .windows(2)
        .position(|pair| pair == "é".as_bytes())
        .unwrap()
        + 1;
    client.write_all(&bytes[..at]).await.unwrap();
    client.flush().await.unwrap();
    tokio::task::yield_now().await;
    client.write_all(&bytes[at..]).await.unwrap();
    // The input ends right behind the request: a handler that needs no I/O answers before the end
    // can cancel it.
    client.shutdown().await.unwrap();
    running.await.unwrap().unwrap();
    let mut written = String::new();
    reader.read_to_string(&mut written).await.unwrap();
    let answer: Value = serde_json::from_str(&written).unwrap();
    assert_eq!(
        answer["result"]["content"],
        json!([{ "text": "{\"text\":\"é\"}", "type": "text" }])
    );
}

/// A source whose call outlives the cancellation that the input's end gives it.
struct Slow {
    started: Arc<Notify>,
    aborted: Arc<Notify>,
    released: Arc<Notify>,
}

impl ToolSource for Slow {
    async fn list_tools(&self) -> Result<Vec<Tool>, ProtocolError> {
        Ok(Vec::new())
    }

    async fn call_tool(&self, call: ToolCall) -> Result<ToolResult, ProtocolError> {
        self.started.notify_one();
        call.cancel.cancelled().await;
        self.aborted.notify_one();
        self.released.notified().await;
        Ok(ToolResult::default())
    }
}

#[tokio::test]
async fn writes_nothing_once_the_runs_token_is_cancelled_after_the_input_has_ended() {
    let (mut client, server_in) = duplex(4096);
    let (server_out, mut reader) = duplex(4096);
    let (started, aborted, released) = (
        Arc::new(Notify::new()),
        Arc::new(Notify::new()),
        Arc::new(Notify::new()),
    );
    let server = McpServer::new(
        ServerInfo::new("streams", "0.0.0"),
        Slow {
            started: started.clone(),
            aborted: aborted.clone(),
            released: released.clone(),
        },
    );
    let stop = CancellationToken::new();
    let token = stop.clone();
    let running = tokio::spawn(async move {
        server
            .run_until(BufReader::new(server_in), server_out, token)
            .await
    });
    client
        .write_all(line(&common::request(1, "tools/call", json!({ "name": "slow" }))).as_bytes())
        .await
        .unwrap();
    started.notified().await;
    client.shutdown().await.unwrap();
    aborted.notified().await;
    stop.cancel();
    released.notify_one();
    running.await.unwrap().unwrap();
    let mut written = String::new();
    reader.read_to_string(&mut written).await.unwrap();
    assert_eq!(written, "");
}
