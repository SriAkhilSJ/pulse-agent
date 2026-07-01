//! Real-time file watching and AST parsing for the Surpassing IDE Agent.
//!
//! This crate provides:
//! - FileWatcher: detects file changes in <50ms using platform-native APIs
//! - AstParser: tree-sitter based multi-language parser
//! - SymbolExtractor: extracts functions, structs, classes, imports from AST

#![warn(missing_docs)]
#![warn(unreachable_pub)]

pub mod parser;
pub mod symbols;
pub mod watcher;

pub use parser::{AstParser, AstNode, Language, SymbolKind, Position, SemanticType};
pub use symbols::{Symbol, SymbolExtractor, SymbolStore, SymbolType};
pub use watcher::{FileWatcher, FileChangeEvent, ChangeType};
