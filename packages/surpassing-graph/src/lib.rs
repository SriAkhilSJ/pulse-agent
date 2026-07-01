//! Semantic knowledge graph for code understanding in the Surpassing IDE Agent.
//!
//! Simplified version: just symbols (no vectors, no FTS).
//! Stores symbols and edges in SQLite for persistent, queryable code intelligence.

#![warn(missing_docs)]
#![warn(unreachable_pub)]

pub mod graph;
pub mod query;
pub mod store;

pub use graph::KnowledgeGraph;
pub use query::{GraphQuery, GraphSummary};
pub use store::{SymbolNode, SymbolType, Edge, EdgeType};
