//! Semantic Knowledge Graph — SQLite storage.
//!
//! Every function, class, module is a node. Every call, import, inheritance is an edge.
//! This is NOT a text search index — it's a semantic understanding of code structure.

use crate::store::{SymbolStore, SymbolNode, SymbolType, Edge, EdgeType};
use surpassing_core::Result;
use std::path::Path;
use uuid::Uuid;

/// The knowledge graph — queryable semantic model of code.
pub struct KnowledgeGraph {
    db_path: std::path::PathBuf,
}

impl KnowledgeGraph {
    /// Open or create a knowledge graph at the given path.
    pub fn open(db_path: impl AsRef<Path>) -> Result<Self> {
        let path = db_path.as_ref().to_path_buf();
        SymbolStore::init_schema(&path)?;
        Ok(Self { db_path: path })
    }

    /// Create a temporary knowledge graph (for testing).
    pub fn open_in_memory() -> Result<Self> {
        let temp_dir = std::env::temp_dir();
        let file_name = format!("surpassing_test_{}.db", Uuid::new_v4());
        let path = temp_dir.join(file_name);
        SymbolStore::init_schema(&path)?;
        Ok(Self { db_path: path })
    }

    /// Add a symbol to the graph. Returns the symbol's ID.
    pub fn add_symbol(
        &self,
        name: &str,
        symbol_type: SymbolType,
        language: &str,
        file_path: &str,
        start_line: usize,
        end_line: usize,
        signature: Option<&str>,
        is_public: bool,
    ) -> Result<String> {
        let id = Uuid::new_v4().to_string();
        let node = SymbolNode {
            id: id.clone(),
            name: name.to_string(),
            symbol_type,
            language: language.to_string(),
            file_path: file_path.to_string(),
            start_line,
            end_line,
            signature: signature.map(String::from),
            documentation: None,
            is_public,
        };
        SymbolStore::upsert_symbol(&self.db_path, &node)?;
        Ok(id)
    }

    /// Add a relationship between two symbols.
    pub fn add_edge(
        &self,
        source_id: &str,
        target_id: &str,
        edge_type: EdgeType,
        strength: f32,
    ) -> Result<()> {
        let edge = Edge {
            id: Uuid::new_v4().to_string(),
            source_id: source_id.to_string(),
            target_id: target_id.to_string(),
            edge_type,
            strength,
        };
        SymbolStore::add_edge(&self.db_path, &edge)
    }

    /// Find symbols by exact name.
    pub fn find_symbol(&self, name: &str) -> Result<Vec<SymbolNode>> {
        SymbolStore::find_by_name(&self.db_path, name)
    }

    /// Find symbols by type.
    pub fn find_by_type(&self, symbol_type: SymbolType) -> Result<Vec<SymbolNode>> {
        SymbolStore::find_by_type(&self.db_path, symbol_type)
    }

    /// Find all symbols in a file.
    pub fn find_in_file(&self, file_path: &str) -> Result<Vec<SymbolNode>> {
        SymbolStore::find_by_file(&self.db_path, file_path)
    }

    /// Find all callers of a symbol.
    pub fn find_callers(&self, symbol_id: &str) -> Result<Vec<SymbolNode>> {
        SymbolStore::find_callers(&self.db_path, symbol_id)
    }

    /// Find all symbols called by a symbol.
    pub fn find_callees(&self, symbol_id: &str) -> Result<Vec<SymbolNode>> {
        SymbolStore::find_callees(&self.db_path, symbol_id)
    }

    /// Remove all data for a file (symbols + edges).
    pub fn remove_file(&self, file_path: &str) -> Result<()> {
        SymbolStore::remove_file(&self.db_path, file_path)
    }

    /// Get total symbol count.
    pub fn symbol_count(&self) -> Result<usize> {
        SymbolStore::symbol_count(&self.db_path)
    }

    /// Get total edge count.
    pub fn edge_count(&self) -> Result<usize> {
        SymbolStore::edge_count(&self.db_path)
    }

    /// List all symbol names.
    pub fn list_symbols(&self) -> Result<Vec<String>> {
        SymbolStore::all_names(&self.db_path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_and_find_symbol() {
        let graph = KnowledgeGraph::open_in_memory().unwrap();
        let id = graph.add_symbol(
            "fibonacci",
            SymbolType::Function,
            "rust",
            "src/math.rs",
            10,
            20,
            Some("fn fibonacci(n: u32) -> u64"),
            true,
        ).unwrap();

        let found = graph.find_symbol("fibonacci").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].id, id);
        assert_eq!(found[0].symbol_type, SymbolType::Function);
        assert_eq!(found[0].file_path, "src/math.rs");
    }

    #[test]
    fn test_add_edge_and_query() {
        let graph = KnowledgeGraph::open_in_memory().unwrap();
        let main_id = graph.add_symbol("main", SymbolType::Function, "rust", "main.rs", 1, 5, None, false).unwrap();
        let helper_id = graph.add_symbol("helper", SymbolType::Function, "rust", "lib.rs", 1, 3, None, true).unwrap();

        graph.add_edge(&main_id, &helper_id, EdgeType::Calls, 1.0).unwrap();

        let callers = graph.find_callers(&helper_id).unwrap();
        assert_eq!(callers.len(), 1);
        assert_eq!(callers[0].name, "main");

        let callees = graph.find_callees(&main_id).unwrap();
        assert_eq!(callees.len(), 1);
        assert_eq!(callees[0].name, "helper");
    }

    #[test]
    fn test_symbol_count() {
        let graph = KnowledgeGraph::open_in_memory().unwrap();
        assert_eq!(graph.symbol_count().unwrap(), 0);

        graph.add_symbol("a", SymbolType::Function, "rust", "a.rs", 1, 2, None, true).unwrap();
        graph.add_symbol("b", SymbolType::Struct, "rust", "a.rs", 5, 10, None, true).unwrap();
        assert_eq!(graph.symbol_count().unwrap(), 2);
    }

    #[test]
    fn test_remove_file() {
        let graph = KnowledgeGraph::open_in_memory().unwrap();
        graph.add_symbol("a", SymbolType::Function, "rust", "a.rs", 1, 2, None, true).unwrap();
        graph.add_symbol("b", SymbolType::Function, "rust", "b.rs", 1, 2, None, true).unwrap();
        assert_eq!(graph.symbol_count().unwrap(), 2);

        graph.remove_file("a.rs").unwrap();
        assert_eq!(graph.symbol_count().unwrap(), 1);
        assert!(graph.find_symbol("a").unwrap().is_empty());
    }
}
