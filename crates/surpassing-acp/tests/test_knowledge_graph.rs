//! Integration test: full pipeline from source file → chat query → definition.
//!
//! Tests the Slice 2 verification:
//!   "Open a file with a function, Ask 'What does functionX do?', Get correct answer with file location"

/// Simulates the full pipeline: parse file → index symbols → query via chat.
///
/// 1. Creates a temp Rust file with a known function
/// 2. Parses it with tree-sitter (via surpassing-indexer)
/// 3. Extracts symbols into the knowledge graph (via surpassing-graph)
/// 4. Queries via ACP chat handler with "what is functionX?"
/// 5. Verifies response contains correct file location
#[test]
fn test_chat_returns_function_definition_from_real_file() {
    // Step 1: Create a temp Rust file with a known function
    let temp_dir = std::env::temp_dir().join("surpassing_integration_test");
    let _ = std::fs::create_dir_all(&temp_dir);
    let test_file = temp_dir.join("calculator.rs");
    let source_code = r#"
pub fn calculate_sum(a: i32, b: i32) -> i32 {
    a + b
}

struct Calculator {
    result: i32,
}

impl Calculator {
    fn new() -> Self {
        Self { result: 0 }
    }

    fn add(&mut self, value: i32) {
        self.result += value;
    }
}
"#;
    std::fs::write(&test_file, source_code).unwrap();

    // Step 2: Parse the file with tree-sitter
    use surpassing_indexer::{AstParser, SymbolExtractor};
    let mut parser = AstParser::new();
    let nodes = parser.parse_file(&test_file, source_code)
        .expect("Failed to parse test file");
    assert!(!nodes.is_empty(), "Parser returned no nodes");

    // Step 3: Extract symbols and add to knowledge graph
    use surpassing_graph::{KnowledgeGraph, SymbolType};
    use surpassing_indexer::SymbolType as ISymbolType;

    let graph = KnowledgeGraph::open_in_memory().unwrap();
    let symbols = SymbolExtractor::extract_symbols(test_file.clone(), &nodes, source_code);
    assert!(!symbols.is_empty(), "No symbols extracted");

    for sym in &symbols {
        let sg_type = match sym.symbol_type {
            ISymbolType::Function => SymbolType::Function,
            ISymbolType::Struct => SymbolType::Struct,
            ISymbolType::Enum => SymbolType::Enum,
            ISymbolType::Trait => SymbolType::Trait,
            ISymbolType::Class => SymbolType::Class,
            ISymbolType::Import => SymbolType::Import,
            ISymbolType::Variable => SymbolType::Variable,
            ISymbolType::Module => SymbolType::Module,
            ISymbolType::Method => SymbolType::Method,
            ISymbolType::Impl => SymbolType::Function,
            ISymbolType::Unknown => SymbolType::Variable,
        };
        let file_path_str = sym.file_path.to_string_lossy().to_string();
        let _ = graph.add_symbol(
            &sym.name,
            sg_type,
            "rust",
            &file_path_str,
            sym.line,
            sym.line + 1,
            Some(&sym.signature),
            true,
        );
    }

    // Step 4: Query via ACP chat handler
    use surpassing_acp::{AppContext, handlers::handle_chat};
    let ctx = AppContext::new(graph);

    let params = serde_json::json!({
        "message": "what is calculate_sum?",
        "mode": "chat"
    });
    let result = handle_chat(params, ctx).unwrap();

    // Step 5: Verify the response contains correct file location
    let response = result.get("response")
        .and_then(|v| v.as_str())
        .expect("No response field");

    // Verify function name is in the response
    assert!(
        response.contains("calculate_sum"),
        "Response should mention function name. Got: {}", response
    );

    // Verify file path is in the response
    assert!(
        response.contains("calculator.rs"),
        "Response should contain file location. Got: {}", response
    );

    // Cleanup
    let _ = std::fs::remove_dir_all(&temp_dir);
}

/// Test "who calls X" query end-to-end with parsed file
#[test]
fn test_chat_who_calls_from_real_file() {
    let temp_dir = std::env::temp_dir().join("surpassing_integration_test2");
    let _ = std::fs::create_dir_all(&temp_dir);
    let test_file = temp_dir.join("main.rs");
    let source_code = "fn helper() -> i32 { 42 }\n\nfn main() {\n    let x = helper();\n}\n";
    std::fs::write(&test_file, source_code).unwrap();

    use surpassing_indexer::{AstParser, SymbolExtractor};
    use surpassing_graph::{KnowledgeGraph, SymbolType};
    use surpassing_indexer::SymbolType as ISymbolType;

    let mut parser = AstParser::new();
    let nodes = parser.parse_file(&test_file, source_code).unwrap();
    let graph = KnowledgeGraph::open_in_memory().unwrap();
    let symbols = SymbolExtractor::extract_symbols(test_file.clone(), &nodes, source_code);

    let mut id_map = std::collections::HashMap::new();
    for sym in &symbols {
        let sg_type = match sym.symbol_type {
            ISymbolType::Function => SymbolType::Function,
            _ => SymbolType::Variable,
        };
        let file_path_str = sym.file_path.to_string_lossy().to_string();
        let id = graph.add_symbol(
            &sym.name, sg_type, "rust", &file_path_str,
            sym.line, sym.line + 1, Some(&sym.signature), true,
        ).unwrap();
        id_map.insert(sym.name.clone(), id);
    }

    // Add edge: main calls helper
    if let (Some(main_id), Some(helper_id)) = (id_map.get("main"), id_map.get("helper")) {
        graph.add_edge(main_id, helper_id, surpassing_graph::EdgeType::Calls, 1.0).unwrap();
    }

    use surpassing_acp::{AppContext, handlers::handle_chat};
    let ctx = AppContext::new(graph);

    let params = serde_json::json!({ "message": "who calls helper", "mode": "chat" });
    let result = handle_chat(params, ctx).unwrap();
    let response = result.get("response").and_then(|v| v.as_str()).unwrap();

    assert!(response.contains("main"), "Should find 'main' as caller. Got: {}", response);

    let _ = std::fs::remove_dir_all(&temp_dir);
}
