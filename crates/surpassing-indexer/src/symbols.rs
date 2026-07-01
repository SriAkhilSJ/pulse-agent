//! Symbol extraction and storage.
//!
//! Extracts symbols from parsed AST nodes and stores them in an in-memory symbol table.

use std::collections::HashMap;
use std::path::PathBuf;
use serde::{Serialize, Deserialize};

use crate::parser::{AstNode, AstParser, SemanticType, SymbolKind};

/// A symbol extracted from source code.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Symbol {
    /// Symbol name.
    pub name: String,
    /// File path where the symbol is defined.
    pub file_path: PathBuf,
    /// Line number (0-indexed).
    pub line: usize,
    /// Column number (0-indexed).
    pub column: usize,
    /// Symbol type classification.
    pub symbol_type: SymbolType,
    /// Source code snippet (first line of definition).
    pub signature: String,
}

/// Type of symbol for search/filtering.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SymbolType {
    Function,
    Struct,
    Enum,
    Trait,
    Impl,
    Import,
    Variable,
    Class,
    Module,
    Method,
    Unknown,
}

impl From<SymbolKind> for SymbolType {
    fn from(kind: SymbolKind) -> Self {
        match kind {
            SymbolKind::Function => SymbolType::Function,
            SymbolKind::Struct => SymbolType::Struct,
            SymbolKind::Enum => SymbolType::Enum,
            SymbolKind::Trait => SymbolType::Trait,
            SymbolKind::Impl => SymbolType::Impl,
            SymbolKind::Import => SymbolType::Import,
            SymbolKind::Variable => SymbolType::Variable,
            SymbolKind::Class => SymbolType::Class,
            SymbolKind::Module => SymbolType::Module,
            SymbolKind::Method => SymbolType::Method,
            SymbolKind::Unknown => SymbolType::Unknown,
        }
    }
}

/// Extracts symbols from parsed AST nodes.
pub struct SymbolExtractor;

impl SymbolExtractor {
    /// Extract all symbols from parsed AST nodes.
    pub fn extract_symbols(file_path: PathBuf, nodes: &[AstNode], source: &str) -> Vec<Symbol> {
        let mut symbols = Vec::new();
        for node in nodes {
            Self::extract_from_node(file_path.clone(), node, source, &mut symbols);
        }
        symbols
    }

    fn extract_from_node(
        file_path: PathBuf,
        node: &AstNode,
        source: &str,
        symbols: &mut Vec<Symbol>,
    ) {
        if let Some(ref name) = node.name {
            let symbol_type = match &node.semantic_type {
                Some(SemanticType::Function { .. }) => SymbolType::Function,
                Some(SemanticType::Struct { .. }) => SymbolType::Struct,
                Some(SemanticType::Enum { .. }) => SymbolType::Enum,
                Some(SemanticType::Trait { .. }) => SymbolType::Trait,
                Some(SemanticType::Impl { .. }) => SymbolType::Impl,
                Some(SemanticType::Import { .. }) => SymbolType::Import,
                Some(SemanticType::Variable { .. }) => SymbolType::Variable,
                Some(SemanticType::Class { .. }) => SymbolType::Class,
                Some(SemanticType::Module { .. }) => SymbolType::Module,
                None => AstParser::symbol_kind(&node.kind).into(),
            };

            // Get the first line of the definition as signature
            let signature = if node.start_position.line < source.lines().count() {
                source.lines().nth(node.start_position.line).unwrap_or("").trim().to_string()
            } else {
                String::new()
            };

            symbols.push(Symbol {
                name: name.clone(),
                file_path: file_path.clone(),
                line: node.start_position.line,
                column: node.start_position.column,
                symbol_type,
                signature,
            });
        }

        // Recurse into children
        for child in &node.children {
            Self::extract_from_node(file_path.clone(), child, source, symbols);
        }
    }
}

/// In-memory symbol store for fast lookups.
#[derive(Debug, Default)]
pub struct SymbolStore {
    symbols: HashMap<String, Vec<Symbol>>,
    by_file: HashMap<PathBuf, Vec<Symbol>>,
}

impl SymbolStore {
    /// Create a new empty symbol store.
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a symbol to the store.
    pub fn add(&mut self, symbol: Symbol) {
        self.symbols
            .entry(symbol.name.clone())
            .or_default()
            .push(symbol.clone());
        self.by_file
            .entry(symbol.file_path.clone())
            .or_default()
            .push(symbol);
    }

    /// Add multiple symbols.
    pub fn add_many(&mut self, symbols: Vec<Symbol>) {
        for symbol in symbols {
            self.add(symbol);
        }
    }

    /// Find all symbols with a given name.
    pub fn find_by_name(&self, name: &str) -> Vec<&Symbol> {
        self.symbols.get(name).map(|v| v.iter().collect()).unwrap_or_default()
    }

    /// Find symbols by type.
    pub fn find_by_type(&self, symbol_type: SymbolType) -> Vec<&Symbol> {
        self.symbols
            .values()
            .flatten()
            .filter(|s| s.symbol_type == symbol_type)
            .collect()
    }

    /// Get all symbols in a file.
    pub fn find_by_file(&self, path: &PathBuf) -> Vec<&Symbol> {
        self.by_file.get(path).map(|v| v.iter().collect()).unwrap_or_default()
    }

    /// Remove all symbols for a file (used when file is modified or deleted).
    pub fn remove_file(&mut self, path: &PathBuf) {
        if let Some(file_symbols) = self.by_file.remove(path) {
            for symbol in file_symbols {
                if let Some(entries) = self.symbols.get_mut(&symbol.name) {
                    entries.retain(|s| s.file_path != *path);
                    if entries.is_empty() {
                        self.symbols.remove(&symbol.name);
                    }
                }
            }
        }
    }

    /// Get total symbol count.
    pub fn len(&self) -> usize {
        self.by_file.values().map(|v| v.len()).sum()
    }

    /// Check if store is empty.
    pub fn is_empty(&self) -> bool {
        self.by_file.is_empty()
    }

    /// Get all symbol names.
    pub fn names(&self) -> Vec<&String> {
        self.symbols.keys().collect()
    }

    /// Clear all symbols.
    pub fn clear(&mut self) {
        self.symbols.clear();
        self.by_file.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::parser::Position;

    fn make_test_node(name: &str, kind: &str, sem: Option<SemanticType>) -> AstNode {
        AstNode {
            kind: kind.to_string(),
            name: Some(name.to_string()),
            start_position: Position { line: 0, column: 0 },
            end_position: Position { line: 0, column: 10 },
            children: vec![],
            semantic_type: sem,
        }
    }

    #[test]
    fn test_extract_function_symbol() {
        let node = make_test_node(
            "add",
            "function_item",
            Some(SemanticType::Function {
                params: vec!["a".to_string(), "b".to_string()],
                return_type: Some("i32".to_string()),
            }),
        );
        let symbols = SymbolExtractor::extract_symbols(
            PathBuf::from("test.rs"),
            &[node],
            "fn add(a: i32, b: i32) -> i32 { a + b }",
        );
        assert_eq!(symbols.len(), 1);
        assert_eq!(symbols[0].name, "add");
        assert_eq!(symbols[0].symbol_type, SymbolType::Function);
    }

    #[test]
    fn test_symbol_store_add_and_find() {
        let mut store = SymbolStore::new();
        store.add(Symbol {
            name: "MyStruct".to_string(),
            file_path: PathBuf::from("test.rs"),
            line: 5,
            column: 0,
            symbol_type: SymbolType::Struct,
            signature: "struct MyStruct".to_string(),
        });

        let found = store.find_by_name("MyStruct");
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].line, 5);
    }

    #[test]
    fn test_symbol_store_remove_file() {
        let mut store = SymbolStore::new();
        store.add(Symbol {
            name: "foo".to_string(),
            file_path: PathBuf::from("a.rs"),
            line: 1,
            column: 0,
            symbol_type: SymbolType::Function,
            signature: "fn foo()".to_string(),
        });
        store.add(Symbol {
            name: "bar".to_string(),
            file_path: PathBuf::from("b.rs"),
            line: 2,
            column: 0,
            symbol_type: SymbolType::Function,
            signature: "fn bar()".to_string(),
        });

        assert_eq!(store.len(), 2);
        store.remove_file(&PathBuf::from("a.rs"));
        assert_eq!(store.len(), 1);
        assert!(store.find_by_name("foo").is_empty());
        assert!(!store.find_by_name("bar").is_empty());
    }

    #[test]
    fn test_find_by_type() {
        let mut store = SymbolStore::new();
        store.add_many(vec![
            Symbol {
                name: "func1".to_string(),
                file_path: PathBuf::from("test.rs"),
                line: 1,
                column: 0,
                symbol_type: SymbolType::Function,
                signature: "fn func1()".to_string(),
            },
            Symbol {
                name: "struct1".to_string(),
                file_path: PathBuf::from("test.rs"),
                line: 5,
                column: 0,
                symbol_type: SymbolType::Struct,
                signature: "struct S".to_string(),
            },
            Symbol {
                name: "func2".to_string(),
                file_path: PathBuf::from("test.rs"),
                line: 10,
                column: 0,
                symbol_type: SymbolType::Function,
                signature: "fn func2()".to_string(),
            },
        ]);

        let funcs = store.find_by_type(SymbolType::Function);
        assert_eq!(funcs.len(), 2);
        let structs = store.find_by_type(SymbolType::Struct);
        assert_eq!(structs.len(), 1);
    }
}
