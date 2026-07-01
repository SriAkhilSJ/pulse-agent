//! Multi-language AST parser using tree-sitter.
use std::collections::HashMap;
use std::path::Path;
use tree_sitter::{Node, Parser, Tree};

/// Supported programming languages.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Language {
    Rust,
    Python,
    JavaScript,
    TypeScript,
    Go,
    Java,
    Unknown,
}

impl Language {
    pub fn from_path(path: &Path) -> Self {
        match path.extension().and_then(|e| e.to_str()) {
            Some("rs") => Language::Rust,
            Some("py") | Some("pyi") => Language::Python,
            Some("js") | Some("mjs") | Some("cjs") => Language::JavaScript,
            Some("ts") | Some("tsx") => Language::TypeScript,
            Some("go") => Language::Go,
            Some("java") => Language::Java,
            _ => Language::Unknown,
        }
    }

    pub fn grammar(&self) -> Option<tree_sitter::Language> {
        match self {
            Language::Rust => Some(tree_sitter_rust::language()),
            Language::Python => Some(tree_sitter_python::language()),
            Language::JavaScript => Some(tree_sitter_javascript::language()),
            Language::TypeScript => Some(tree_sitter_typescript::language_typescript()),
            Language::Go => Some(tree_sitter_go::language()),
            Language::Java => Some(tree_sitter_java::language()),
            Language::Unknown => None,
        }
    }
}

/// Position in source code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Position {
    pub line: usize,
    pub column: usize,
}

/// Semantic type extracted from an AST node.
#[derive(Debug, Clone, PartialEq)]
pub enum SemanticType {
    Function {
        params: Vec<String>,
        return_type: Option<String>,
    },
    Struct {
        fields: Vec<String>,
    },
    Enum {
        variants: Vec<String>,
    },
    Trait {
        methods: Vec<String>,
    },
    Impl {
        target: String,
    },
    Import {
        path: String,
        symbols: Vec<String>,
    },
    Variable {
        var_type: Option<String>,
        mutable: bool,
    },
    Class {
        methods: Vec<String>,
        parent: Option<String>,
    },
    Module {
        name: String,
    },
}

/// Kind of symbol for classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SymbolKind {
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

/// A parsed AST node with semantic information.
#[derive(Debug, Clone, PartialEq)]
pub struct AstNode {
    pub kind: String,
    pub name: Option<String>,
    pub start_position: Position,
    pub end_position: Position,
    pub children: Vec<AstNode>,
    pub semantic_type: Option<SemanticType>,
}

/// Multi-language AST parser.
pub struct AstParser {
    parsers: HashMap<Language, Parser>,
}

impl AstParser {
    pub fn new() -> Self {
        let mut parsers = HashMap::new();
        for lang in [
            Language::Rust,
            Language::Python,
            Language::JavaScript,
            Language::TypeScript,
            Language::Go,
            Language::Java,
        ] {
            if let Some(grammar) = lang.grammar() {
                let mut parser = Parser::new();
                if parser.set_language(&grammar).is_ok() {
                    parsers.insert(lang, parser);
                }
            }
        }
        Self { parsers }
    }

    pub fn parse_file(&mut self, path: &Path, content: &str) -> Option<Vec<AstNode>> {
        let lang = Language::from_path(path);
        let parser = self.parsers.get_mut(&lang)?;
        let tree = parser.parse(content, None)?;
        let root = tree.root_node();
        Some(self.extract_nodes(root, content))
    }

    pub fn parse_incremental(
        &mut self,
        path: &Path,
        old_tree: &Tree,
        content: &str,
    ) -> Option<Tree> {
        let lang = Language::from_path(path);
        let parser = self.parsers.get_mut(&lang)?;
        parser.parse(content, Some(old_tree))
    }

    pub fn symbol_kind(node_kind: &str) -> SymbolKind {
        match node_kind {
            "function_item" | "function_definition" | "function_declaration" | "method_definition" => SymbolKind::Function,
            "struct_item" | "class_item" => SymbolKind::Struct,
            "enum_item" => SymbolKind::Enum,
            "trait_item" => SymbolKind::Trait,
            "impl_item" => SymbolKind::Impl,
            "import_statement" | "use_declaration" | "import_declaration" => SymbolKind::Import,
            "let_declaration" | "variable_declaration" => SymbolKind::Variable,
            "class_definition" | "class_declaration" => SymbolKind::Class,
            "module" | "mod_item" => SymbolKind::Module,
            _ => SymbolKind::Unknown,
        }
    }

    fn extract_nodes(&self, node: Node, source: &str) -> Vec<AstNode> {
        let mut nodes = Vec::new();
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if let Some(ast_node) = self.node_to_ast(child, source) {
                nodes.push(ast_node);
            }
        }
        nodes
    }

    fn node_to_ast(&self, node: Node, source: &str) -> Option<AstNode> {
        let semantic_type = self.classify_node(node, source);
        let name = self.find_name(node, source);
        if semantic_type.is_none() && name.is_none() {
            return None;
        }
        Some(AstNode {
            kind: node.kind().to_string(),
            name,
            start_position: Position {
                line: node.start_position().row,
                column: node.start_position().column,
            },
            end_position: Position {
                line: node.end_position().row,
                column: node.end_position().column,
            },
            children: self.extract_nodes(node, source),
            semantic_type,
        })
    }

    fn classify_node(&self, node: Node, source: &str) -> Option<SemanticType> {
        let mut cursor = node.walk();
        let children: Vec<Node> = node.children(&mut cursor).collect();
        match node.kind() {
            "function_item" | "function_definition" | "function_declaration" | "method_definition" => {
                let mut params = Vec::new();
                let mut return_type = None;
                for child in &children {
                    match child.kind() {
                        "parameters" | "parameter_list" | "formal_parameters" => {
                            let mut pc = child.walk();
                            for param in child.children(&mut pc) {
                                if param.kind() == "parameter" || param.kind() == "identifier" {
                                    let text = &source[param.start_byte()..param.end_byte()];
                                    params.push(text.to_string());
                                }
                            }
                        }
                        "type_identifier" | "primitive_type" | "return_type" => {
                            return_type = Some(source[child.start_byte()..child.end_byte()].to_string());
                        }
                        _ => {}
                    }
                }
                Some(SemanticType::Function { params, return_type })
            }
            "struct_item" | "class_definition" | "class_declaration" => {
                let mut fields = Vec::new();
                let mut parent = None;
                let mut methods = Vec::new();
                for child in &children {
                    match child.kind() {
                        "field_declaration_list" | "class_body" | "body" => {
                            let mut fc = child.walk();
                            for field in child.children(&mut fc) {
                                if field.kind() == "field_declaration" || field.kind() == "variable_declaration" {
                                    let text = &source[field.start_byte()..field.end_byte()];
                                    fields.push(text.to_string());
                                }
                                if field.kind() == "method_definition" || field.kind() == "function_definition" {
                                    if let Some(n) = self.find_name(field, source) {
                                        methods.push(n);
                                    }
                                }
                            }
                        }
                        "superclass" | "class_heritage" => {
                            parent = Some(source[child.start_byte()..child.end_byte()].to_string());
                        }
                        _ => {}
                    }
                }
                if node.kind().contains("class") {
                    Some(SemanticType::Class { methods, parent })
                } else {
                    Some(SemanticType::Struct { fields })
                }
            }
            "enum_item" => {
                let mut variants = Vec::new();
                for child in &children {
                    if child.kind() == "enum_body" || child.kind() == "body" {
                        let mut vc = child.walk();
                        for variant in child.children(&mut vc) {
                            if variant.kind() == "enum_variant" || variant.kind() == "identifier" {
                                let text = &source[variant.start_byte()..variant.end_byte()];
                                variants.push(text.to_string());
                            }
                        }
                    }
                }
                Some(SemanticType::Enum { variants })
            }
            "trait_item" => {
                let mut methods = Vec::new();
                for child in &children {
                    if child.kind() == "declaration_list" || child.kind() == "body" {
                        let mut mc = child.walk();
                        for m in child.children(&mut mc) {
                            if m.kind() == "function_item" {
                                if let Some(n) = self.find_name(m, source) {
                                    methods.push(n);
                                }
                            }
                        }
                    }
                }
                Some(SemanticType::Trait { methods })
            }
            "impl_item" => {
                let mut target = String::new();
                for child in &children {
                    if child.kind() == "type_identifier" || child.kind() == "scoped_type_identifier" {
                        target = source[child.start_byte()..child.end_byte()].to_string();
                        break;
                    }
                }
                Some(SemanticType::Impl { target })
            }
            "use_declaration" | "import_statement" | "import_declaration" => {
                let path = source[node.start_byte()..node.end_byte()].to_string();
                Some(SemanticType::Import { path, symbols: vec![] })
            }
            "let_declaration" | "variable_declaration" => {
                let var_type = children.iter().find_map(|c| {
                    if c.kind() == "type_identifier" || c.kind() == "primitive_type" {
                        Some(source[c.start_byte()..c.end_byte()].to_string())
                    } else {
                        None
                    }
                });
                let mutable = source[node.start_byte()..node.end_byte()].contains("mut");
                Some(SemanticType::Variable { var_type, mutable })
            }
            _ => None,
        }
    }

    fn find_name(&self, node: Node, source: &str) -> Option<String> {
        let mut cursor = node.walk();
        for child in node.children(&mut cursor) {
            if child.kind() == "identifier" || child.kind() == "name" || child.kind() == "type_identifier" {
                return Some(source[child.start_byte()..child.end_byte()].to_string());
            }
        }
        None
    }
}

impl Default for AstParser {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_language_detection() {
        assert_eq!(Language::from_path(Path::new("foo.rs")), Language::Rust);
        assert_eq!(Language::from_path(Path::new("foo.py")), Language::Python);
        assert_eq!(Language::from_path(Path::new("foo.js")), Language::JavaScript);
        assert_eq!(Language::from_path(Path::new("foo.ts")), Language::TypeScript);
        assert_eq!(Language::from_path(Path::new("foo.go")), Language::Go);
        assert_eq!(Language::from_path(Path::new("foo.java")), Language::Java);
        assert_eq!(Language::from_path(Path::new("foo.txt")), Language::Unknown);
    }

    #[test]
    fn test_symbol_kind() {
        assert_eq!(AstParser::symbol_kind("function_item"), SymbolKind::Function);
        assert_eq!(AstParser::symbol_kind("struct_item"), SymbolKind::Struct);
        assert_eq!(AstParser::symbol_kind("enum_item"), SymbolKind::Enum);
        assert_eq!(AstParser::symbol_kind("class_definition"), SymbolKind::Class);
        assert_eq!(AstParser::symbol_kind("random_thing"), SymbolKind::Unknown);
    }

    #[test]
    fn test_parse_rust_function() {
        let mut parser = AstParser::new();
        let code = "fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n";
        let nodes = parser.parse_file(Path::new("test.rs"), code);
        assert!(nodes.is_some());
        let nodes = nodes.unwrap();
        assert!(!nodes.is_empty());
        assert_eq!(nodes[0].kind, "function_item");
        assert_eq!(nodes[0].name, Some("add".to_string()));
    }

    #[test]
    fn test_parse_python_function() {
        let mut parser = AstParser::new();
        let code = "def greet(name: str) -> str:\n    return f\"Hello\"\n";
        let nodes = parser.parse_file(Path::new("test.py"), code);
        assert!(nodes.is_some());
        let nodes = nodes.unwrap();
        assert!(!nodes.is_empty());
        assert_eq!(nodes[0].kind, "function_definition");
        assert_eq!(nodes[0].name, Some("greet".to_string()));
    }

    #[test]
    fn test_parse_rust_struct() {
        let mut parser = AstParser::new();
        let code = "struct User {\n    name: String,\n    age: u32,\n}\n";
        let nodes = parser.parse_file(Path::new("test.rs"), code);
        assert!(nodes.is_some());
        let nodes = nodes.unwrap();
        assert!(!nodes.is_empty());
        assert_eq!(nodes[0].kind, "struct_item");
        assert_eq!(nodes[0].name, Some("User".to_string()));
    }

    #[test]
    fn test_parse_unknown_extension() {
        let mut parser = AstParser::new();
        let nodes = parser.parse_file(Path::new("test.txt"), "hello world");
        assert!(nodes.is_none());
    }
}
