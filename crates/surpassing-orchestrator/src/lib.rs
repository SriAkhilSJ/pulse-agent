//! Orchestrator — coordinates the multi-agent swarm.
//!
//! Responsibilities:
//! - Task distribution to appropriate agents
//! - Shared context bus for agent collaboration
//! - Lifecycle management (start, pause, resume, stop)

#![warn(missing_docs)]
#![warn(unreachable_pub)]

pub mod context_bus;
pub mod registry;
pub mod scheduler;

pub use context_bus::{ContextBus, ContextMessage, MessageType};
pub use registry::AgentRegistry;
pub use scheduler::Scheduler;
