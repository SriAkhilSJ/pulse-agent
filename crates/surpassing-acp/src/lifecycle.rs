//! Server lifecycle management.

/// Server state for tracking lifecycle.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ServerState {
    /// Server is starting up.
    Starting,
    /// Server is initialized and ready.
    Ready,
    /// Server is shutting down.
    ShuttingDown,
    /// Server has stopped.
    Stopped,
}

/// Tracks server lifecycle state.
pub struct Lifecycle {
    state: ServerState,
}

impl Lifecycle {
    /// Create a new lifecycle tracker.
    pub fn new() -> Self {
        Self {
            state: ServerState::Starting,
        }
    }

    /// Get the current server state.
    pub fn state(&self) -> &ServerState {
        &self.state
    }

    /// Transition to ready state.
    pub fn set_ready(&mut self) {
        self.state = ServerState::Ready;
    }

    /// Transition to shutting down state.
    pub fn set_shutting_down(&mut self) {
        self.state = ServerState::ShuttingDown;
    }

    /// Transition to stopped state.
    pub fn set_stopped(&mut self) {
        self.state = ServerState::Stopped;
    }

    /// Check if the server is ready.
    pub fn is_ready(&self) -> bool {
        self.state == ServerState::Ready
    }
}

impl Default for Lifecycle {
    fn default() -> Self {
        Self::new()
    }
}
