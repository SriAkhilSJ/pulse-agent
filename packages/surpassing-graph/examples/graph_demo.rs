use surpassing_graph::{KnowledgeGraph, GraphQuery, SymbolType};

fn main() {
    println!("=== Knowledge Graph Demo ===\n");

    let graph = KnowledgeGraph::open_in_memory().unwrap();

    // Index a small Rust codebase
    let main_id = graph.add_symbol("main", SymbolType::Function, "rust", "src/main.rs", 1, 15, Some("fn main()"), false).unwrap();
    let helper_id = graph.add_symbol("helper", SymbolType::Function, "rust", "src/lib.rs", 1, 10, Some("pub fn helper(input: &str) -> String"), true).unwrap();
    let cache_id = graph.add_symbol("Cache", SymbolType::Struct, "rust", "src/cache.rs", 1, 30, Some("pub struct Cache { data: HashMap }"), true).unwrap();
    let insert_id = graph.add_symbol("insert", SymbolType::Method, "rust", "src/cache.rs", 5, 12, Some("pub fn insert(&mut self, key: String, value: Vec<u8>)"), true).unwrap();
    let status_id = graph.add_symbol("Status", SymbolType::Enum, "rust", "src/models.rs", 1, 5, Some("pub enum Status { Active, Inactive }"), true).unwrap();

    // Add edges (relationships)
    graph.add_edge(&main_id, &helper_id, surpassing_graph::EdgeType::Calls, 1.0).unwrap();
    graph.add_edge(&main_id, &cache_id, surpassing_graph::EdgeType::References, 0.8).unwrap();
    graph.add_edge(&helper_id, &status_id, surpassing_graph::EdgeType::References, 0.6).unwrap();

    println!("Indexed {} symbols, {} edges\n",
        graph.symbol_count().unwrap(),
        graph.edge_count().unwrap());

    // Query: find by name
    let found = graph.find_symbol("helper").unwrap();
    println!("Query 'helper': found at {}:{}", found[0].file_path, found[0].start_line);

    // Query: find all functions
    let query = GraphQuery::new(&graph);
    let funcs = query.functions().unwrap();
    println!("\nFunctions ({}):", funcs.len());
    for f in &funcs {
        println!("  - {} @ {}:{}", f.name, f.file_path, f.start_line);
    }

    // Query: find all types
    let types = query.types().unwrap();
    println!("\nTypes ({}):", types.len());
    for t in &types {
        println!("  - {} ({:?}) @ {}", t.name, t.symbol_type, t.file_path);
    }

    // Query: who calls helper?
    let callers = query.who_calls("helper").unwrap();
    println!("\nWho calls 'helper':");
    for c in &callers {
        println!("  - {} @ {}", c.name, c.file_path);
    }

    // Summary
    let summary = query.summary().unwrap();
    println!("\nSummary: {} symbols, {} edges", summary.total_symbols, summary.total_edges);

    println!("\n=== Knowledge graph working ===");
}
