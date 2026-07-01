//! Shared state for ACP handlers.

use std::sync::Arc;
use surpassing_graph::KnowledgeGraph;

/// Shared context passed to all handlers.
///
/// The knowledge graph is !Send (due to rusqlite). The ACP server is
/// single-threaded (stdio loop), so we use Arc without Mutex.
/// Handlers must perform all graph operations without holding
/// any guard across .await points.
#[derive(Clone)]
pub struct AppContext {
    /// The knowledge graph for querying code symbols.
    pub graph: Arc<KnowledgeGraph>,
}

impl AppContext {
    /// Create a new context with the given knowledge graph.
    pub fn new(graph: KnowledgeGraph) -> Self {
        Self {
            graph: Arc::new(graph),
        }
    }
}
