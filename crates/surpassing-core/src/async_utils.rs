//! Async helpers and channel wrappers.

use std::future::Future;
use tokio::task::JoinHandle;

/// Spawn a traced task with panic handling.
pub fn spawn_traced<F>(name: &str, future: F) -> JoinHandle<F::Output>
where
    F: Future + Send + 'static,
    F::Output: Send + 'static,
{
    let name = name.to_string();
    tokio::spawn(async move {
        let result = future.await;
        tracing::debug!(task = %name, "task completed");
        result
    })
}

/// A bounded channel for backpressure.
pub fn bounded_channel<T>(capacity: usize) -> (tokio::sync::mpsc::Sender<T>, tokio::sync::mpsc::Receiver<T>) {
    tokio::sync::mpsc::channel(capacity)
}
