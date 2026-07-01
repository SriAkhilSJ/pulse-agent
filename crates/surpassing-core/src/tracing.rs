//! Tracing and instrumentation utilities.

/// Initialize tracing with sensible defaults for the Surpassing agent.
pub fn init_tracing() {
    let _ = tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
        )
        .with_target(true)
        .with_thread_ids(false)
        .try_init();
}

/// Initialize tracing with JSON output (for production).
pub fn init_tracing_json() {
    let _ = tracing_subscriber::fmt()
        .json()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
        )
        .try_init();
}
