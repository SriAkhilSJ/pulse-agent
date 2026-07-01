//! Stdio transport — reads/writes line-delimited JSON over stdin/stdout.

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use surpassing_core::{Result, SurpassingError};

/// Transport layer for ACP communication over stdin/stdout.
pub struct StdioTransport {
    reader: BufReader<tokio::io::Stdin>,
    writer: tokio::io::Stdout,
}

impl StdioTransport {
    /// Create a new stdio transport.
    pub fn new() -> Self {
        let stdin = tokio::io::stdin();
        let stdout = tokio::io::stdout();
        Self {
            reader: BufReader::new(stdin),
            writer: stdout,
        }
    }

    /// Initialize the transport (no-op for stdio, hooks for TCP/WS).
    pub async fn initialize(&self) -> Result<()> {
        Ok(())
    }

    /// Read one line from stdin. Returns None on EOF.
    pub async fn read_line(&mut self) -> Result<Option<String>> {
        let mut line = String::new();
        let bytes_read = self.reader.read_line(&mut line).await.map_err(|e| {
            SurpassingError::Protocol(format!("read error: {}", e))
        })?;

        if bytes_read == 0 {
            return Ok(None);
        }

        // Strip trailing newline
        while line.ends_with('\n') || line.ends_with('\r') {
            line.pop();
        }

        Ok(Some(line))
    }

    /// Send a JSON-RPC response to stdout.
    pub async fn send_response<T: serde::Serialize>(&mut self, response: T) -> Result<()> {
        let json = serde_json::to_string(&response).map_err(|e| {
            SurpassingError::Serialization(e)
        })?;

        self.writer.write_all(json.as_bytes()).await.map_err(|e| {
            SurpassingError::Protocol(format!("write error: {}", e))
        })?;
        self.writer.write_all(b"\n").await.map_err(|e| {
            SurpassingError::Protocol(format!("write error: {}", e))
        })?;
        self.writer.flush().await.map_err(|e| {
            SurpassingError::Protocol(format!("flush error: {}", e))
        })?;

        Ok(())
    }

    /// Shutdown signal — never fires (real shutdown comes from channel).
    pub async fn shutdown_signal(&self) {
        std::future::pending::<()>().await;
    }
}

impl Default for StdioTransport {
    fn default() -> Self {
        Self::new()
    }
}
