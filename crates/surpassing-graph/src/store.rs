//! SQLite-backed storage for the knowledge graph.
//!
//! Each operation opens a fresh connection to avoid !Send issues.
//! SQLite handles concurrent access via file locking.

use surpassing_core::Result;
use rusqlite::{Connection, params};
use std::path::Path;
use serde::{Serialize, Deserialize};
use uuid::Uuid;

fn db_err(e: rusqlite::Error) -> surpassing_core::SurpassingError {
    surpassing_core::SurpassingError::Database(e.to_string())
}

/// A node in the knowledge graph — represents a code symbol.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SymbolNode {
    pub id: String,
    pub name: String,
    pub symbol_type: SymbolType,
    pub language: String,
    pub file_path: String,
    pub start_line: usize,
    pub end_line: usize,
    pub signature: Option<String>,
    pub documentation: Option<String>,
    pub is_public: bool,
}

/// Type of symbol in the graph.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SymbolType {
    Function,
    Method,
    Class,
    Struct,
    Enum,
    Trait,
    Interface,
    Module,
    Variable,
    Constant,
    Import,
    Macro,
}

impl std::fmt::Display for SymbolType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl std::str::FromStr for SymbolType {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "Function" => Ok(SymbolType::Function),
            "Method" => Ok(SymbolType::Method),
            "Class" => Ok(SymbolType::Class),
            "Struct" => Ok(SymbolType::Struct),
            "Enum" => Ok(SymbolType::Enum),
            "Trait" => Ok(SymbolType::Trait),
            "Interface" => Ok(SymbolType::Interface),
            "Module" => Ok(SymbolType::Module),
            "Variable" => Ok(SymbolType::Variable),
            "Constant" => Ok(SymbolType::Constant),
            "Import" => Ok(SymbolType::Import),
            "Macro" => Ok(SymbolType::Macro),
            other => Err(format!("Unknown symbol type: {}", other)),
        }
    }
}

/// An edge in the knowledge graph — represents a relationship.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Edge {
    pub id: String,
    pub source_id: String,
    pub target_id: String,
    pub edge_type: EdgeType,
    pub strength: f32,
}

/// Type of relationship between symbols.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum EdgeType {
    Calls,
    Imports,
    Inherits,
    Implements,
    Contains,
    References,
    Tests,
    DependsOn,
}

impl std::fmt::Display for EdgeType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}", self)
    }
}

impl std::str::FromStr for EdgeType {
    type Err = String;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "Calls" => Ok(EdgeType::Calls),
            "Imports" => Ok(EdgeType::Imports),
            "Inherits" => Ok(EdgeType::Inherits),
            "Implements" => Ok(EdgeType::Implements),
            "Contains" => Ok(EdgeType::Contains),
            "References" => Ok(EdgeType::References),
            "Tests" => Ok(EdgeType::Tests),
            "DependsOn" => Ok(EdgeType::DependsOn),
            other => Err(format!("Unknown edge type: {}", other)),
        }
    }
}

/// SQLite-backed symbol store. Each operation opens a fresh connection.
pub struct SymbolStore;

impl SymbolStore {
    /// Initialize the schema at the given path.
    pub fn init_schema(db_path: impl AsRef<Path>) -> Result<()> {
        let path = db_path.as_ref();
        // Ensure parent directory exists (SQLite won't create it)
        if let Some(parent) = path.parent() {
            if !parent.as_os_str().is_empty() && !parent.exists() {
                std::fs::create_dir_all(parent).map_err(|e| {
                    surpassing_core::SurpassingError::Database(format!(
                        "failed to create directory {}: {}",
                        parent.display(),
                        e
                    ))
                })?;
            }
        }
        let conn = Connection::open(path).map_err(db_err)?;
        conn.execute_batch("
            CREATE TABLE IF NOT EXISTS symbols (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                symbol_type TEXT NOT NULL,
                language TEXT NOT NULL,
                file_path TEXT NOT NULL,
                start_line INTEGER NOT NULL,
                end_line INTEGER NOT NULL,
                signature TEXT,
                documentation TEXT,
                is_public BOOLEAN NOT NULL DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_symbols_name ON symbols(name);
            CREATE INDEX IF NOT EXISTS idx_symbols_file ON symbols(file_path);
            CREATE INDEX IF NOT EXISTS idx_symbols_type ON symbols(symbol_type);
            CREATE TABLE IF NOT EXISTS edges (
                id TEXT PRIMARY KEY,
                source_id TEXT NOT NULL REFERENCES symbols(id),
                target_id TEXT NOT NULL REFERENCES symbols(id),
                edge_type TEXT NOT NULL,
                strength REAL NOT NULL DEFAULT 1.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
            CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
            CREATE INDEX IF NOT EXISTS idx_edges_type ON edges(edge_type);
            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                language TEXT,
                line_count INTEGER,
                last_modified TIMESTAMP,
                checksum TEXT
            );
        ").map_err(db_err)?;
        Ok(())
    }

    /// Insert or update a symbol.
    pub fn upsert_symbol(db_path: impl AsRef<Path>, symbol: &SymbolNode) -> Result<()> {
        let path = db_path.as_ref();
        let conn = Connection::open(path).map_err(db_err)?;
        conn.execute("
            INSERT INTO symbols (id, name, symbol_type, language, file_path, start_line, end_line, signature, documentation, is_public)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                signature = excluded.signature,
                documentation = excluded.documentation,
                is_public = excluded.is_public,
                updated_at = CURRENT_TIMESTAMP
        ", params![
            symbol.id,
            symbol.name,
            symbol.symbol_type.to_string(),
            symbol.language,
            symbol.file_path,
            symbol.start_line as i64,
            symbol.end_line as i64,
            symbol.signature,
            symbol.documentation,
            symbol.is_public,
        ]).map_err(db_err)?;
        Ok(())
    }

    /// Insert or update an edge.
    pub fn add_edge(db_path: impl AsRef<Path>, edge: &Edge) -> Result<()> {
        let path = db_path.as_ref();
        let conn = Connection::open(path).map_err(db_err)?;
        conn.execute("
            INSERT OR REPLACE INTO edges (id, source_id, target_id, edge_type, strength)
            VALUES (?1, ?2, ?3, ?4, ?5)
        ", params![
            edge.id,
            edge.source_id,
            edge.target_id,
            edge.edge_type.to_string(),
            edge.strength,
        ]).map_err(db_err)?;
        Ok(())
    }

    /// Find a symbol by exact name.
    pub fn find_by_name(db_path: impl AsRef<Path>, name: &str) -> Result<Vec<SymbolNode>> {
        let path = db_path.as_ref();
        let conn = Connection::open(path).map_err(db_err)?;
        let mut stmt = conn.prepare("
            SELECT id, name, symbol_type, language, file_path, start_line, end_line, signature, documentation, is_public
            FROM symbols WHERE name = ?1
        ").map_err(db_err)?;
        let rows = stmt.query_map([name], |row| {
            Ok(SymbolNode {
                id: row.get(0)?,
                name: row.get(1)?,
                symbol_type: row.get::<_, String>(2)?.parse().unwrap_or(SymbolType::Variable),
                language: row.get(3)?,
                file_path: row.get(4)?,
                start_line: row.get::<_, i64>(5)? as usize,
                end_line: row.get::<_, i64>(6)? as usize,
                signature: row.get(7)?,
                documentation: row.get(8)?,
                is_public: row.get(9)?,
            })
        }).map_err(db_err)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Find symbols by type.
    pub fn find_by_type(db_path: impl AsRef<Path>, symbol_type: SymbolType) -> Result<Vec<SymbolNode>> {
        let path = db_path.as_ref();
        let conn = Connection::open(path).map_err(db_err)?;
        let type_str = symbol_type.to_string();
        let mut stmt = conn.prepare("
            SELECT id, name, symbol_type, language, file_path, start_line, end_line, signature, documentation, is_public
            FROM symbols WHERE symbol_type = ?1
        ").map_err(db_err)?;
        let rows = stmt.query_map([type_str], |row| {
            Ok(SymbolNode {
                id: row.get(0)?,
                name: row.get(1)?,
                symbol_type: row.get::<_, String>(2)?.parse().unwrap_or(SymbolType::Variable),
                language: row.get(3)?,
                file_path: row.get(4)?,
                start_line: row.get::<_, i64>(5)? as usize,
                end_line: row.get::<_, i64>(6)? as usize,
                signature: row.get(7)?,
                documentation: row.get(8)?,
                is_public: row.get(9)?,
            })
        }).map_err(db_err)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Find all symbols in a file.
    pub fn find_by_file(db_path: impl AsRef<Path>, file_path: &str) -> Result<Vec<SymbolNode>> {
        let path = db_path.as_ref();
        let conn = Connection::open(path).map_err(db_err)?;
        let mut stmt = conn.prepare("
            SELECT id, name, symbol_type, language, file_path, start_line, end_line, signature, documentation, is_public
            FROM symbols WHERE file_path = ?1
            ORDER BY start_line
        ").map_err(db_err)?;
        let rows = stmt.query_map([file_path], |row| {
            Ok(SymbolNode {
                id: row.get(0)?,
                name: row.get(1)?,
                symbol_type: row.get::<_, String>(2)?.parse().unwrap_or(SymbolType::Variable),
                language: row.get(3)?,
                file_path: row.get(4)?,
                start_line: row.get::<_, i64>(5)? as usize,
                end_line: row.get::<_, i64>(6)? as usize,
                signature: row.get(7)?,
                documentation: row.get(8)?,
                is_public: row.get(9)?,
            })
        }).map_err(db_err)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Find all callers of a symbol.
    pub fn find_callers(db_path: impl AsRef<Path>, symbol_id: &str) -> Result<Vec<SymbolNode>> {
        let path = db_path.as_ref();
        let conn = Connection::open(path).map_err(db_err)?;
        let mut stmt = conn.prepare("
            SELECT s.id, s.name, s.symbol_type, s.language, s.file_path, s.start_line, s.end_line, s.signature, s.documentation, s.is_public
            FROM symbols s
            JOIN edges e ON s.id = e.source_id
            WHERE e.target_id = ?1 AND e.edge_type = 'Calls'
            ORDER BY e.strength DESC
        ").map_err(db_err)?;
        let rows = stmt.query_map([symbol_id], |row| {
            Ok(SymbolNode {
                id: row.get(0)?,
                name: row.get(1)?,
                symbol_type: row.get::<_, String>(2)?.parse().unwrap_or(SymbolType::Variable),
                language: row.get(3)?,
                file_path: row.get(4)?,
                start_line: row.get::<_, i64>(5)? as usize,
                end_line: row.get::<_, i64>(6)? as usize,
                signature: row.get(7)?,
                documentation: row.get(8)?,
                is_public: row.get(9)?,
            })
        }).map_err(db_err)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Find all symbols called by a symbol.
    pub fn find_callees(db_path: impl AsRef<Path>, symbol_id: &str) -> Result<Vec<SymbolNode>> {
        let path = db_path.as_ref();
        let conn = Connection::open(path).map_err(db_err)?;
        let mut stmt = conn.prepare("
            SELECT s.id, s.name, s.symbol_type, s.language, s.file_path, s.start_line, s.end_line, s.signature, s.documentation, s.is_public
            FROM symbols s
            JOIN edges e ON s.id = e.target_id
            WHERE e.source_id = ?1 AND e.edge_type = 'Calls'
            ORDER BY e.strength DESC
        ").map_err(db_err)?;
        let rows = stmt.query_map([symbol_id], |row| {
            Ok(SymbolNode {
                id: row.get(0)?,
                name: row.get(1)?,
                symbol_type: row.get::<_, String>(2)?.parse().unwrap_or(SymbolType::Variable),
                language: row.get(3)?,
                file_path: row.get(4)?,
                start_line: row.get::<_, i64>(5)? as usize,
                end_line: row.get::<_, i64>(6)? as usize,
                signature: row.get(7)?,
                documentation: row.get(8)?,
                is_public: row.get(9)?,
            })
        }).map_err(db_err)?;
        Ok(rows.filter_map(|r| r.ok()).collect())
    }

    /// Remove all symbols and edges for a file.
    pub fn remove_file(db_path: impl AsRef<Path>, file_path: &str) -> Result<()> {
        let path = db_path.as_ref();
        let conn = Connection::open(path).map_err(db_err)?;
        let mut stmt = conn.prepare("SELECT id FROM symbols WHERE file_path = ?1").map_err(db_err)?;
        let ids: Vec<String> = stmt.query_map([file_path], |row| row.get(0))
            .map_err(db_err)?
            .filter_map(|r| r.ok()).collect();

        for id in &ids {
            conn.execute("DELETE FROM edges WHERE source_id = ?1 OR target_id = ?1", [id.clone()])
                .map_err(db_err)?;
        }
        conn.execute("DELETE FROM symbols WHERE file_path = ?1", [file_path]).map_err(db_err)?;
        conn.execute("DELETE FROM files WHERE path = ?1", [file_path]).map_err(db_err)?;
        Ok(())
    }

    /// Get total symbol count.
    pub fn symbol_count(db_path: impl AsRef<Path>) -> Result<usize> {
        let path = db_path.as_ref();
        let conn = Connection::open(path).map_err(db_err)?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM symbols", [], |row| row.get(0))
            .map_err(db_err)?;
        Ok(count as usize)
    }

    /// Get total edge count.
    pub fn edge_count(db_path: impl AsRef<Path>) -> Result<usize> {
        let path = db_path.as_ref();
        let conn = Connection::open(path).map_err(db_err)?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM edges", [], |row| row.get(0))
            .map_err(db_err)?;
        Ok(count as usize)
    }

    /// Get all symbol names.
    pub fn all_names(db_path: impl AsRef<Path>) -> Result<Vec<String>> {
        let path = db_path.as_ref();
        let conn = Connection::open(path).map_err(db_err)?;
        let mut stmt = conn.prepare("SELECT name FROM symbols ORDER BY name").map_err(db_err)?;
        let names = stmt.query_map([], |row| row.get(0))
            .map_err(db_err)?
            .filter_map(|r| r.ok())
            .collect();
        Ok(names)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_symbol(name: &str, symbol_type: SymbolType, file: &str, line: usize) -> SymbolNode {
        SymbolNode {
            id: Uuid::new_v4().to_string(),
            name: name.to_string(),
            symbol_type,
            language: "rust".to_string(),
            file_path: file.to_string(),
            start_line: line,
            end_line: line + 2,
            signature: Some(format!("{}()", name)),
            documentation: None,
            is_public: true,
        }
    }

    fn test_db() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("test_graph_{}.db", Uuid::new_v4()));
        SymbolStore::init_schema(&path).unwrap();
        path
    }

    #[test]
    fn test_upsert_and_find_by_name() {
        let path = test_db();
        let sym = make_symbol("process", SymbolType::Function, "src/lib.rs", 10);
        SymbolStore::upsert_symbol(&path, &sym).unwrap();
        let found = SymbolStore::find_by_name(&path, "process").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "process");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_find_by_type() {
        let path = test_db();
        SymbolStore::upsert_symbol(&path, &make_symbol("foo", SymbolType::Function, "a.rs", 1)).unwrap();
        SymbolStore::upsert_symbol(&path, &make_symbol("bar", SymbolType::Function, "a.rs", 5)).unwrap();
        SymbolStore::upsert_symbol(&path, &make_symbol("MyStruct", SymbolType::Struct, "a.rs", 10)).unwrap();
        let funcs = SymbolStore::find_by_type(&path, SymbolType::Function).unwrap();
        assert_eq!(funcs.len(), 2);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_find_by_file() {
        let path = test_db();
        SymbolStore::upsert_symbol(&path, &make_symbol("a", SymbolType::Function, "a.rs", 1)).unwrap();
        SymbolStore::upsert_symbol(&path, &make_symbol("b", SymbolType::Function, "b.rs", 1)).unwrap();
        let found = SymbolStore::find_by_file(&path, "a.rs").unwrap();
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].name, "a");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_edges_and_callers() {
        let path = test_db();
        let caller = make_symbol("main", SymbolType::Function, "main.rs", 1);
        let callee = make_symbol("helper", SymbolType::Function, "lib.rs", 1);
        SymbolStore::upsert_symbol(&path, &caller).unwrap();
        SymbolStore::upsert_symbol(&path, &callee).unwrap();
        let edge = Edge {
            id: Uuid::new_v4().to_string(),
            source_id: caller.id.clone(),
            target_id: callee.id.clone(),
            edge_type: EdgeType::Calls,
            strength: 1.0,
        };
        SymbolStore::add_edge(&path, &edge).unwrap();
        let callers = SymbolStore::find_callers(&path, &callee.id).unwrap();
        assert_eq!(callers.len(), 1);
        assert_eq!(callers[0].name, "main");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_remove_file() {
        let path = test_db();
        SymbolStore::upsert_symbol(&path, &make_symbol("a", SymbolType::Function, "a.rs", 1)).unwrap();
        SymbolStore::upsert_symbol(&path, &make_symbol("b", SymbolType::Function, "b.rs", 1)).unwrap();
        assert_eq!(SymbolStore::symbol_count(&path).unwrap(), 2);
        SymbolStore::remove_file(&path, "a.rs").unwrap();
        assert_eq!(SymbolStore::symbol_count(&path).unwrap(), 1);
        assert!(SymbolStore::find_by_name(&path, "a").unwrap().is_empty());
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_symbol_type_roundtrip() {
        for st in [SymbolType::Function, SymbolType::Struct, SymbolType::Enum, SymbolType::Trait] {
            let s = st.to_string();
            let parsed: SymbolType = s.parse().unwrap();
            assert_eq!(st, parsed);
        }
    }
}
