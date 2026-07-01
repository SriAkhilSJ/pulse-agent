//! Resource limits for sandboxed execution.

use serde::{Deserialize, Serialize};
use std::time::Duration;

/// Resource limits for a sandbox execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ResourceLimits {
    /// Maximum execution time in seconds.
    pub timeout_seconds: u64,
    /// Maximum memory in MB.
    pub memory_mb: u64,
    /// Maximum CPU cores (fractional).
    pub cpu_cores: f64,
    /// Maximum disk write in MB.
    pub disk_mb: u64,
}

impl Default for ResourceLimits {
    fn default() -> Self {
        Self {
            timeout_seconds: 30,
            memory_mb: 128,
            cpu_cores: 0.5,
            disk_mb: 50,
        }
    }
}

impl ResourceLimits {
    /// Get the timeout as a Duration.
    pub fn timeout(&self) -> Duration {
        Duration::from_secs(self.timeout_seconds)
    }
}
