fn main() {
    use surpassing_indexer::{AstParser, SymbolExtractor};
    use surpassing_graph::{KnowledgeGraph, SymbolType};
    use surpassing_indexer::SymbolType as ISymbolType;

    let temp_dir = std::env::temp_dir().join("hermes-verify-case");
    let _ = std::fs::create_dir_all(&temp_dir);
    let test_file = temp_dir.join("my_service.rs");
    let source = "fn handleRequest(id: u64) -> bool { true }\n\nstruct ResponseParser {\n    data: String,\n}\n\nfn ProcessData(input: &str) -> String { input.to_string() }\n";
    std::fs::write(&test_file, source).unwrap();

    let mut parser = AstParser::new();
    let nodes = parser.parse_file(&test_file, source).unwrap();
    let graph = KnowledgeGraph::open_in_memory().unwrap();
    let file_path_str = test_file.to_string_lossy().to_string();
    let symbols = SymbolExtractor::extract_symbols(test_file.clone(), &nodes, source);

    for sym in &symbols {
        let sg_type = match sym.symbol_type {
            ISymbolType::Function => SymbolType::Function,
            ISymbolType::Struct => SymbolType::Struct,
            _ => SymbolType::Variable,
        };
        let _ = graph.add_symbol(
            &sym.name, sg_type, "rust", &file_path_str,
            sym.line, sym.line + 1, Some(&sym.signature), true,
        );
    }

    use surpassing_acp::{AppContext, handlers::handle_chat};
    let ctx = AppContext::new(graph);

    let queries = [
        "what is handleRequest?",
        "what is ResponseParser?",
        "what is ProcessData?",
    ];

    let mut all_pass = true;
    for query in &queries {
        let params = serde_json::json!({ "message": query, "mode": "chat" });
        let result = handle_chat(params, ctx.clone()).unwrap();
        let response = result.get("response").and_then(|v| v.as_str()).unwrap();

        let symbol_name = query
            .strip_prefix("what is ").unwrap()
            .strip_suffix("?").unwrap();

        let contains_file = response.contains("my_service.rs");
        let contains_name = response.contains(symbol_name);
        let pass = contains_file && contains_name;
        if !pass { all_pass = false; }

        println!(
            "  {} | {} → {}",
            if pass { "PASS" } else { "FAIL" },
            query,
            response
        );
    }

    let _ = std::fs::remove_dir_all(&temp_dir);

    if all_pass {
        println!("\nCASE-PRESERVING SYMBOL LOOKUP: VERIFIED");
    } else {
        println!("\nFAILED");
        std::process::exit(1);
    }
}
