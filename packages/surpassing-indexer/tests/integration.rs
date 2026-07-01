//! Integration tests for the file watcher + AST parser pipeline.

use surpassing_indexer::*;
use std::path::{Path, PathBuf};

#[test]
fn test_full_pipeline_rust_file() {
    let mut parser = AstParser::new();
    let code = "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n\nstruct Calculator {\n    result: i32,\n}\n\nimpl Calculator {\n    fn new() -> Self {\n        Self { result: 0 }\n    }\n}\n";
    let nodes = parser.parse_file(Path::new("calc.rs"), code);
    assert!(nodes.is_some());
    let nodes = nodes.unwrap();

    // Extract symbols
    let symbols = SymbolExtractor::extract_symbols(
        PathBuf::from("calc.rs"),
        &nodes,
        code,
    );

    // Should find: add, Calculator, new
    let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"add"), "Should find function 'add'");
    assert!(names.contains(&"Calculator"), "Should find struct 'Calculator'");

    // Store in symbol store
    let mut store = SymbolStore::new();
    store.add_many(symbols);

    let add_symbols = store.find_by_name("add");
    assert!(!add_symbols.is_empty());
    assert_eq!(add_symbols[0].symbol_type, SymbolType::Function);

    let calc_symbols = store.find_by_name("Calculator");
    assert!(!calc_symbols.is_empty());
    assert_eq!(calc_symbols[0].symbol_type, SymbolType::Struct);
}

#[test]
fn test_full_pipeline_python_file() {
    let mut parser = AstParser::new();
    let code = "def greet(name: str) -> str:\n    return f\"Hello, {name}\"\n\nclass Greeter:\n    def __init__(self, greeting: str):\n        self.greeting = greeting\n\n    def greet(self, name: str) -> str:\n        return f\"{self.greeting}, {name}\"\n";
    let nodes = parser.parse_file(Path::new("greeter.py"), code);
    assert!(nodes.is_some());
    let nodes = nodes.unwrap();

    let symbols = SymbolExtractor::extract_symbols(
        PathBuf::from("greeter.py"),
        &nodes,
        code,
    );

    let names: Vec<&str> = symbols.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains(&"greet"), "Should find function 'greet'");
    assert!(names.contains(&"Greeter"), "Should find class 'Greeter'");
}

#[test]
fn test_symbol_store_file_lifecycle() {
    let mut store = SymbolStore::new();
    let file_a = PathBuf::from("a.rs");
    let file_b = PathBuf::from("b.rs");

    // Index file A
    store.add_many(SymbolExtractor::extract_symbols(
        file_a.clone(),
        &[
            AstNode {
                kind: "function_item".to_string(),
                name: Some("process".to_string()),
                start_position: Position { line: 0, column: 0 },
                end_position: Position { line: 2, column: 1 },
                children: vec![],
                semantic_type: Some(SemanticType::Function {
                    params: vec!["data".to_string()],
                    return_type: Some("Result".to_string()),
                }),
            }
        ],
        "fn process(data: String) -> Result { }",
    ));

    // Index file B
    store.add_many(SymbolExtractor::extract_symbols(
        file_b.clone(),
        &[
            AstNode {
                kind: "struct_item".to_string(),
                name: Some("Config".to_string()),
                start_position: Position { line: 0, column: 0 },
                end_position: Position { line: 3, column: 1 },
                children: vec![],
                semantic_type: Some(SemanticType::Struct {
                    fields: vec!["path".to_string()],
                }),
            }
        ],
        "struct Config { path: String }",
    ));

    assert_eq!(store.len(), 2);

    // Remove file A (simulating deletion)
    store.remove_file(&file_a);
    assert_eq!(store.len(), 1);
    assert!(store.find_by_name("process").is_empty());
    assert!(!store.find_by_name("Config").is_empty());
}

#[test]
fn test_parse_javascript_function() {
    let mut parser = AstParser::new();
    let code = "function fetchData(url) {\n    return fetch(url);\n}\n";
    let nodes = parser.parse_file(Path::new("api.js"), code);
    assert!(nodes.is_some());
    let nodes = nodes.unwrap();
    assert!(!nodes.is_empty());
    assert_eq!(nodes[0].name, Some("fetchData".to_string()));
}

#[test]
fn test_parse_typescript_function() {
    let mut parser = AstParser::new();
    let code = "function greet(name: string): string {\n    return `Hello`;\n}\n";
    let nodes = parser.parse_file(Path::new("greet.ts"), code);
    assert!(nodes.is_some());
    let nodes = nodes.unwrap();
    assert!(!nodes.is_empty());
    assert_eq!(nodes[0].name, Some("greet".to_string()));
}

#[test]
fn test_parse_go_function() {
    let mut parser = AstParser::new();
    let code = "package main\n\nfunc add(a int, b int) int {\n    return a + b\n}\n";
    let nodes = parser.parse_file(Path::new("main.go"), code);
    assert!(nodes.is_some());
    let nodes = nodes.unwrap();
    assert!(!nodes.is_empty());
    assert_eq!(nodes[0].name, Some("add".to_string()));
}

#[test]
fn test_parse_java_class() {
    let mut parser = AstParser::new();
    let code = "public class Calculator {\n    public int add(int a, int b) {\n        return a + b;\n    }\n}\n";
    let nodes = parser.parse_file(Path::new("Calculator.java"), code);
    assert!(nodes.is_some());
    let nodes = nodes.unwrap();
    assert!(!nodes.is_empty());
    assert_eq!(nodes[0].name, Some("Calculator".to_string()));
}

#[test]
fn test_multi_language_symbol_extraction() {
    let mut parser = AstParser::new();
    let mut store = SymbolStore::new();

    // Parse Rust
    let rust_code = "fn compute() -> i32 { 42 }";
    let nodes = parser.parse_file(Path::new("lib.rs"), rust_code).unwrap();
    store.add_many(SymbolExtractor::extract_symbols(
        PathBuf::from("lib.rs"), &nodes, rust_code,
    ));

    // Parse Python
    let py_code = "def helper(): pass";
    let nodes = parser.parse_file(Path::new("utils.py"), py_code).unwrap();
    store.add_many(SymbolExtractor::extract_symbols(
        PathBuf::from("utils.py"), &nodes, py_code,
    ));

    // Parse JavaScript
    let js_code = "function init() { return true; }";
    let nodes = parser.parse_file(Path::new("init.js"), js_code).unwrap();
    store.add_many(SymbolExtractor::extract_symbols(
        PathBuf::from("init.js"), &nodes, js_code,
    ));

    assert_eq!(store.len(), 3);
    assert!(!store.find_by_name("compute").is_empty());
    assert!(!store.find_by_name("helper").is_empty());
    assert!(!store.find_by_name("init").is_empty());
}

#[test]
fn test_semantic_type_function_extraction() {
    let mut parser = AstParser::new();
    let code = "fn process(data: String, count: usize) -> bool {\n    true\n}\n";
    let nodes = parser.parse_file(Path::new("test.rs"), code);
    assert!(nodes.is_some());

    let node = &nodes.unwrap()[0];
    match &node.semantic_type {
        Some(SemanticType::Function { params, return_type }) => {
            assert_eq!(params.len(), 2);
            assert_eq!(return_type, &Some("bool".to_string()));
        }
        other => panic!("Expected Function semantic type, got {:?}", other),
    }
}
