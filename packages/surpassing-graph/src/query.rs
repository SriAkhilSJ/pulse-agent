//! Query interface for the knowledge graph.

use crate::graph::KnowledgeGraph;
use crate::store::{SymbolNode, SymbolType};
use surpassing_core::Result;

/// Query builder for the knowledge graph.
pub struct GraphQuery<'a> {
    graph: &'a KnowledgeGraph,
}

impl<'a> GraphQuery<'a> {
    pub fn new(graph: &'a KnowledgeGraph) -> Self {
        Self { graph }
    }

    pub fn symbol(&self, name: &str) -> Result<Vec<SymbolNode>> {
        self.graph.find_symbol(name)
    }

    pub fn functions(&self) -> Result<Vec<SymbolNode>> {
        self.graph.find_by_type(SymbolType::Function)
    }

    pub fn structs(&self) -> Result<Vec<SymbolNode>> {
        self.graph.find_by_type(SymbolType::Struct)
    }

    pub fn classes(&self) -> Result<Vec<SymbolNode>> {
        self.graph.find_by_type(SymbolType::Class)
    }

    pub fn types(&self) -> Result<Vec<SymbolNode>> {
        let mut results = Vec::new();
        for st in [SymbolType::Struct, SymbolType::Enum, SymbolType::Trait, SymbolType::Class, SymbolType::Interface] {
            results.extend(self.graph.find_by_type(st)?);
        }
        Ok(results)
    }

    pub fn in_file(&self, file_path: &str) -> Result<Vec<SymbolNode>> {
        self.graph.find_in_file(file_path)
    }

    pub fn who_calls(&self, function_name: &str) -> Result<Vec<SymbolNode>> {
        let targets = self.graph.find_symbol(function_name)?;
        let mut callers = Vec::new();
        for target in &targets {
            callers.extend(self.graph.find_callers(&target.id)?);
        }
        let mut seen = std::collections::HashSet::new();
        callers.retain(|c| seen.insert(c.id.clone()));
        Ok(callers)
    }

    pub fn calls_what(&self, function_name: &str) -> Result<Vec<SymbolNode>> {
        let sources = self.graph.find_symbol(function_name)?;
        let mut callees = Vec::new();
        for source in &sources {
            callees.extend(self.graph.find_callees(&source.id)?);
        }
        let mut seen = std::collections::HashSet::new();
        callees.retain(|c| seen.insert(c.id.clone()));
        Ok(callees)
    }

    pub fn summary(&self) -> Result<GraphSummary> {
        Ok(GraphSummary {
            total_symbols: self.graph.list_symbols()?.len(),
            total_functions: self.graph.find_by_type(SymbolType::Function)?.len(),
            total_structs: self.graph.find_by_type(SymbolType::Struct)?.len(),
            total_enums: self.graph.find_by_type(SymbolType::Enum)?.len(),
            total_traits: self.graph.find_by_type(SymbolType::Trait)?.len(),
            total_classes: self.graph.find_by_type(SymbolType::Class)?.len(),
            total_edges: self.graph.edge_count()?,
        })
    }
}

/// Summary statistics about the graph.
#[derive(Debug, Clone)]
pub struct GraphSummary {
    pub total_symbols: usize,
    pub total_functions: usize,
    pub total_structs: usize,
    pub total_enums: usize,
    pub total_traits: usize,
    pub total_classes: usize,
    pub total_edges: usize,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::EdgeType;

    fn setup_graph() -> KnowledgeGraph {
        let graph = KnowledgeGraph::open_in_memory();
        let main_id = graph.add_symbol("main", SymbolType::Function, "rust", "main.rs", 1, 10, None, false).unwrap();
        let helper_id = graph.add_symbol("helper", SymbolType::Function, "rust", "lib.rs", 1, 5, None, true).unwrap();
        let _cache_id = graph.add_symbol("Cache", SymbolType::Struct, "rust", "cache.rs", 1, 20, None, true).unwrap();
        graph.add_edge(&main_id, &helper_id, EdgeType::Calls, 1.0).unwrap();
        graph
    }

    #[test]
    fn test_query_by_name() {
        let graph = setup_graph();
        let query = GraphQuery::new(&graph);
        let found = query.symbol("helper").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "helper");
    }

    #[test]
    fn test_query_functions() {
        let graph = setup_graph();
        let query = GraphQuery::new(&graph);
        let funcs = query.functions().unwrap();
        assert_eq!(funcs.len(), 2);
    }

    #[test]
    fn test_query_structs() {
        let graph = setup_graph();
        let query = GraphQuery::new(&graph);
        let structs = query.structs().unwrap();
        assert_eq!(structs.len(), 1);
        assert_eq!(structs[0].name, "Cache");
    }

    #[test]
    fn test_who_calls() {
        let graph = setup_graph();
        let query = GraphQuery::new(&graph);
        let callers = query.who_calls("helper").unwrap();
        assert_eq!(callers.len(), 2);
    }

    #[test]
    fn test_calls_what() {
        let graph = setup_graph();
        let query = GraphQuery::new(&graph);
        let callees = query.calls_what("main").unwrap();
        assert_eq!(callees.len(), 2);
    }

    #[test]
    fn test_summary() {
        let graph = setup_graph();
        let query = GraphQuery::new(&graph);
        let summary = query.summary().unwrap();
        assert_eq!(summary.total_symbols, 3);
        assert_eq!(summary.total_functions, 2);
        assert_eq!(summary.total_structs, 1);
        assert_eq!(summary.total_edges, 1);
    }
}
