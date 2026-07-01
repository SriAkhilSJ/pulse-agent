use thiserror::Error;

/// The top-level error type for the Surpassing IDE Agent.
#[derive(Error, Debug)]
pub enum SurpassingError {
    #[error("ACP protocol error: {0}")]
    Protocol(String),

    #[error("Knowledge graph error: {0}")]
    KnowledgeGraph(String),

    #[error("LLM routing error: {0}")]
    LLMRouting(String),

    #[error("Security gate blocked: {0}")]
    Security(String),

    #[error("Memory operation failed: {0}")]
    Memory(String),

    #[error("Sandbox execution failed: {0}")]
    Sandbox(String),

    #[error("Orchestrator error: {0}")]
    Orchestrator(String),

    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Database error: {0}")]
    Database(String),
}

/// Result type alias for Surpassing operations.
pub type Result<T> = std::result::Result<T, SurpassingError>;
