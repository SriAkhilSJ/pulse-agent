//! Shared Context Bus — all agents read/write to a shared context.
//!
//! This enables parallel collaboration:
//! - Planner writes task breakdown → Coder reads it
//! - Coder writes implementation → Reviewer reads it
//! - Tester writes test results → Coder reads failures
//! - All agents see what others are doing in real-time

use surpassing_core::Result;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::{broadcast, RwLock};
use tracing::instrument;
use chrono::{DateTime, Utc};

/// A message on the context bus.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ContextMessage {
    pub id: String,
    pub agent_id: String,
    pub message_type: MessageType,
    pub payload: serde_json::Value,
    pub timestamp: DateTime<Utc>,
    pub task_id: String,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub enum MessageType {
    TaskStarted,
    TaskCompleted,
    TaskFailed,
    CodeGenerated,
    TestGenerated,
    ReviewComment,
    DebugFinding,
    PlanCreated,
    Question,
    Answer,
    Conflict,
    Resolution,
    HITLRequest,
    HITLResponse,
    ProgressUpdate,
    Checkpoint,
}

/// The shared context bus — broadcast channel + persistent log.
pub struct ContextBus {
    tx: broadcast::Sender<ContextMessage>,
    history: Arc<RwLock<Vec<ContextMessage>>>,
    max_history: usize,
}

impl ContextBus {
    pub fn new(capacity: usize) -> Self {
        let (tx, _) = broadcast::channel(capacity);
        Self {
            tx,
            history: Arc::new(RwLock::new(Vec::new())),
            max_history: 10_000,
        }
    }

    /// Publish a message to all subscribers.
    #[instrument(skip(self))]
    pub async fn publish(&self, message: ContextMessage) -> Result<()> {
        {
            let mut history = self.history.write().await;
            history.push(message.clone());
            if history.len() > self.max_history {
                let excess = history.len() - self.max_history;
                history.drain(0..excess);
            }
        }
        let _ = self.tx.send(message);
        Ok(())
    }

    /// Subscribe to context messages.
    pub fn subscribe(&self) -> broadcast::Receiver<ContextMessage> {
        self.tx.subscribe()
    }

    /// Get message history for a task.
    pub async fn get_task_history(&self, task_id: &str) -> Vec<ContextMessage> {
        let history = self.history.read().await;
        history.iter()
            .filter(|m| m.task_id == task_id)
            .cloned()
            .collect()
    }

    /// Get messages from a specific agent.
    pub async fn get_agent_messages(&self, agent_id: &str, task_id: &str) -> Vec<ContextMessage> {
        let history = self.history.read().await;
        history.iter()
            .filter(|m| m.agent_id == agent_id && m.task_id == task_id)
            .cloned()
            .collect()
    }

    /// Wait for a specific message type from a specific agent.
    pub async fn wait_for(
        &self,
        task_id: &str,
        agent_id: &str,
        message_type: MessageType,
        timeout_secs: u64,
    ) -> Result<Option<ContextMessage>> {
        let mut rx = self.subscribe();
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(timeout_secs);

        loop {
            let timeout = tokio::time::sleep_until(deadline);
            tokio::select! {
                Ok(msg) = rx.recv() => {
                    if msg.task_id == task_id
                        && msg.agent_id == agent_id
                        && msg.message_type == message_type
                    {
                        return Ok(Some(msg));
                    }
                }
                _ = timeout => {
                    return Ok(None);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_publish_and_subscribe() {
        let bus = ContextBus::new(100);
        let mut rx = bus.subscribe();

        let msg = ContextMessage {
            id: "msg-1".to_string(),
            agent_id: "planner".to_string(),
            message_type: MessageType::PlanCreated,
            payload: serde_json::json!({"plan": "test"}),
            timestamp: Utc::now(),
            task_id: "task-1".to_string(),
        };

        bus.publish(msg.clone()).await.unwrap();
        let received = rx.recv().await.unwrap();
        assert_eq!(received.id, "msg-1");
        assert_eq!(received.agent_id, "planner");
    }

    #[tokio::test]
    async fn test_multiple_subscribers() {
        let bus = ContextBus::new(100);
        let mut rx1 = bus.subscribe();
        let mut rx2 = bus.subscribe();

        bus.publish(ContextMessage {
            id: "broadcast".to_string(),
            agent_id: "coder".to_string(),
            message_type: MessageType::CodeGenerated,
            payload: serde_json::json!({}),
            timestamp: Utc::now(),
            task_id: "t1".to_string(),
        }).await.unwrap();

        let r1 = rx1.recv().await.unwrap();
        let r2 = rx2.recv().await.unwrap();
        assert_eq!(r1.id, "broadcast");
        assert_eq!(r2.id, "broadcast");
    }

    #[tokio::test]
    async fn test_task_history_filters() {
        let bus = ContextBus::new(100);

        for i in 0..3 {
            bus.publish(ContextMessage {
                id: format!("m{}", i),
                agent_id: "tester".to_string(),
                message_type: MessageType::TestGenerated,
                payload: serde_json::json!({}),
                timestamp: Utc::now(),
                task_id: "task-A".to_string(),
            }).await.unwrap();
        }

        bus.publish(ContextMessage {
            id: "other".to_string(),
            agent_id: "tester".to_string(),
            message_type: MessageType::TestGenerated,
            payload: serde_json::json!({}),
            timestamp: Utc::now(),
            task_id: "task-B".to_string(),
        }).await.unwrap();

        assert_eq!(bus.get_task_history("task-A").await.len(), 3);
        assert_eq!(bus.get_task_history("task-B").await.len(), 1);
    }

    #[tokio::test]
    async fn test_wait_for_timeout() {
        let bus = ContextBus::new(100);
        let result = bus.wait_for("none", "none", MessageType::TaskCompleted, 1)
            .await.unwrap();
        assert!(result.is_none());
    }
}
