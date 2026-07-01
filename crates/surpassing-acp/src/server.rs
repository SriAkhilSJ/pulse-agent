//! ACP Server — main entry point for IDE communication.

use serde_json::Value;
use tokio::sync::mpsc;

use surpassing_core::Result;

use crate::MethodRouter;
use crate::transport::StdioTransport;

/// ACP Server — main entry point for IDE communication.
pub struct ACPServer {
    transport: StdioTransport,
    router: MethodRouter,
    shutdown_tx: mpsc::Sender<()>,
}

impl ACPServer {
    /// Create a new ACP server with the given method router.
    pub fn new(router: MethodRouter) -> (Self, mpsc::Receiver<()>) {
        let (shutdown_tx, shutdown_rx) = mpsc::channel(1);
        let transport = StdioTransport::new();

        (
            Self {
                transport,
                router,
                shutdown_tx,
            },
            shutdown_rx,
        )
    }

    /// Run the server, processing requests until shutdown.
    pub async fn run(&mut self) -> Result<()> {
        tracing::info!("ACP server starting");
        self.transport.initialize().await?;

        loop {
            let line = self.transport.read_line().await;
            match line {
                Ok(Some(json_line)) => {
                    self.handle_message(&json_line).await?;
                }
                Ok(None) => {
                    tracing::info!("stdin closed, shutting down");
                    break;
                }
                Err(e) => {
                    tracing::error!("transport error: {}", e);
                    break;
                }
            }
        }

        tracing::info!("ACP server stopped");
        Ok(())
    }

    async fn handle_message(&mut self, json_line: &str) -> Result<()> {
        let message: JSONRPCMessage = serde_json::from_str(json_line).map_err(|e| {
            surpassing_core::SurpassingError::Protocol(format!("invalid JSON: {}", e))
        })?;

        match message {
            JSONRPCMessage::Request(req) => {
                tracing::debug!(method = %req.method, "handling request");
                let result = self.router.route(req.method, req.params);

                if let Some(id) = req.id {
                    let response = JSONRPCResponse {
                        jsonrpc: "2.0".to_string(),
                        id,
                        result: match result {
                            Ok(v) => serde_json::json!({ "ok": true, "data": v }),
                            Err(e) => serde_json::json!({ "ok": false, "error": e.to_string() }),
                        },
                    };
                    self.transport.send_response(response).await?;
                }
            }
            JSONRPCMessage::Notification(notif) => {
                tracing::debug!(method = %notif.method, "handling notification");
                self.router.route_notification(notif.method, notif.params);
            }
            JSONRPCMessage::Response(resp) => {
                tracing::debug!(id = ?resp.id, "received client response");
            }
        }

        Ok(())
    }
}

#[derive(Debug, serde::Deserialize)]
#[serde(untagged)]
enum JSONRPCMessage {
    Request(JSONRPCRequest),
    Notification(JSONRPCNotification),
    Response(JSONRPCResponse),
}

#[derive(Debug, serde::Deserialize)]
struct JSONRPCRequest {
    jsonrpc: String,
    id: Option<u64>,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, serde::Deserialize)]
struct JSONRPCNotification {
    jsonrpc: String,
    method: String,
    #[serde(default)]
    params: Value,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
struct JSONRPCResponse {
    jsonrpc: String,
    id: u64,
    result: Value,
}
