use surpassing_indexer::{AstParser, SymbolExtractor, SymbolStore, Language};
use std::path::Path;
use std::fs;

fn main() {
    println!("=== Slice 2: File Watcher + AST Parser Demo ===\n");

    // 1. Create a temp Rust file to analyze
    let test_dir = std::env::temp_dir().join("pulse_demo");
    let _ = fs::create_dir_all(&test_dir);
    let test_file = test_dir.join("example.rs");
    let code = "use std::collections::HashMap;\n\nfn fibonacci(n: u32) -> u64 {\n    if n <= 1 { return n as u64; }\n    let mut a = 0u64;\n    let mut b = 1u64;\n    for _ in 2..=n {\n        let temp = a + b;\n        a = b;\n        b = temp;\n    }\n    b\n}\n\nstruct Cache {\n    data: HashMap<String, Vec<u8>>,\n    hits: usize,\n}\n\nimpl Cache {\n    fn new() -> Self {\n        Self { data: HashMap::new(), hits: 0 }\n    }\n}\n\nenum Status {\n    Active,\n    Inactive,\n}\n";
    fs::write(&test_file, code).unwrap();
    println!("[1] Created test file: {}", test_file.display());

    // 2. Detect language from extension
    let lang = Language::from_path(&test_file);
    println!("[2] Language detected: {:?}", lang);

    // 3. Parse the file into AST
    let mut parser = AstParser::new();
    let nodes = parser.parse_file(&test_file, code);
    assert!(nodes.is_some(), "Parser returned None!");
    let nodes = nodes.unwrap();
    println!("[3] AST nodes extracted: {}", nodes.len());

    // Print first-level nodes
    for node in &nodes {
        let sem = match &node.semantic_type {
            Some(s) => format!("{:?}", s).chars().take(60).collect::<String>(),
            None => "—".to_string(),
        };
        println!("    {:<25} name={:<15} sem={}", node.kind, node.name.as_deref().unwrap_or("?"), sem);
    }

    // 4. Extract symbols
    let symbols = SymbolExtractor::extract_symbols(test_file.clone(), &nodes, code);
    println!("\n[4] Symbols extracted: {}", symbols.len());
    for sym in &symbols {
        println!("    {:<20} {:<15} @ {}:{}",
            format!("{:?}", sym.symbol_type).chars().take(20).collect::<String>(),
            sym.name,
            sym.file_path.file_name().unwrap().to_string_lossy(),
            sym.line
        );
    }

    // 5. Store and query
    let mut store = SymbolStore::new();
    store.add_many(symbols);
    println!("\n[5] Symbol store: {} symbols total", store.len());

    // Query by name
    let found = store.find_by_name("fibonacci");
    assert!(!found.is_empty());
    println!("    Query 'fibonacci' -> found at line {}", found[0].line);

    let found = store.find_by_name("Cache");
    assert!(!found.is_empty());
    println!("    Query 'Cache' -> found at line {}", found[0].line);

    // Query by type
    let funcs = store.find_by_type(surpassing_indexer::SymbolType::Function);
    println!("    Functions: {}", funcs.len());

    let structs = store.find_by_type(surpassing_indexer::SymbolType::Struct);
    println!("    Structs: {}", structs.len());

    let enums = store.find_by_type(surpassing_indexer::SymbolType::Enum);
    println!("    Enums: {}", enums.len());

    let impls = store.find_by_type(surpassing_indexer::SymbolType::Impl);
    println!("    Impls: {}", impls.len());

    // 6. Simulate file change -> re-parse
    let new_code = code.replace("fn fibonacci", "fn fibonacci_fast");
    let new_nodes = parser.parse_file(&test_file, &new_code).unwrap();
    let new_symbols = SymbolExtractor::extract_symbols(test_file.clone(), &new_nodes, &new_code);
    assert!(new_symbols.iter().any(|s| s.name == "fibonacci_fast"));
    println!("\n[6] After edit: 'fibonacci' -> 'fibonacci_fast' detected");

    // Cleanup
    let _ = fs::remove_dir_all(&test_dir);

    println!("\n=== All verifications passed ===");
}
