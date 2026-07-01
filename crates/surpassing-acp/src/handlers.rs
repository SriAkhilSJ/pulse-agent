//! ACP method handlers — implement the protocol specification.

use crate::context::AppContext;
use surpassing_core::{Result, SurpassingError};
use surpassing_graph::{KnowledgeGraph, SymbolType};
use serde_json::{json, Value};

/// Initialize handler — responds with server capabilities.
pub fn handle_initialize(params: Value, ctx: AppContext) -> Result<Value> {
    let root_uri = params
        .get("rootUri")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    tracing::info!(%root_uri, "initialize called");

    // Index the project if rootUri is provided
    if !root_uri.is_empty() {
        let target_dir = root_uri
            .strip_prefix("file://")
            .or_else(|| root_uri.strip_prefix("file:///"))
            .unwrap_or(root_uri);
        // On Windows, paths like /C:/... need the leading slash removed
        let target_dir = if target_dir.len() > 2 && target_dir.starts_with('/') && target_dir.as_bytes()[2] == b':' {
            &target_dir[1..]
        } else {
            target_dir
        };
        index_project(&ctx.graph, target_dir);
    }

    Ok(json!({
        "capabilities": {
            "chat": true,
            "inlineCompletion": true,
            "diffPreview": true,
            "knowledgeGraph": true,
            "agents": ["planner", "coder", "reviewer", "tester", "debugger"],
            "llmTiers": ["local", "edge", "cloud"],
        },
        "serverInfo": {
            "name": "surpassing",
            "version": env!("CARGO_PKG_VERSION"),
            "agents": ["planner", "coder", "reviewer", "tester", "debugger"],
            "models": ["local", "edge", "cloud"],
        }
    }))
}

/// Chat handler — main entry point for natural language commands.
pub fn handle_chat(params: Value, ctx: AppContext) -> Result<Value> {
    let message = params
        .get("message")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mode = params
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("chat");

    let context = params.get("context").cloned().unwrap_or(json!({}));

    tracing::info!(%message, %mode, "chat received");

    // Check if the message is a symbol query
    let lower = message.to_lowercase();
    let symbol_name = extract_symbol_query(&lower);

    if let Some(name) = symbol_name {
        let symbols = ctx.graph.find_symbol(name.as_str())?;
        if !symbols.is_empty() {
            let sym = &symbols[0];
            let response = format!(
                "Found `{}` ({}) at `{}:{}` — {}",
                sym.name,
                format!("{:?}", sym.symbol_type).to_lowercase(),
                sym.file_path,
                sym.start_line,
                sym.signature.as_deref().unwrap_or("no signature")
            );

            let callers = ctx.graph.find_callers(&sym.id)?;
            let caller_names: Vec<String> = callers.iter().map(|c| c.name.clone()).collect();

            return Ok(json!({
                "response": response,
                "suggestedEdits": [],
                "explanation": if !caller_names.is_empty() {
                    format!("Called by: {}", caller_names.join(", "))
                } else {
                    "No callers found".to_string()
                },
                "confidence": 0.95,
                "alternatives": [],
                "knowledgeGraph": {
                    "symbol": sym.name,
                    "file": sym.file_path,
                    "line": sym.start_line,
                    "type": format!("{:?}", sym.symbol_type),
                    "callers": caller_names,
                }
            }));
        }
    }

    // Check for "what calls X" pattern
    if let Some(name) = extract_who_calls(&lower) {
        let targets = ctx.graph.find_symbol(name.as_str())?;
        if !targets.is_empty() {
            let callers = ctx.graph.find_callers(&targets[0].id)?;
            let caller_names: Vec<String> = callers.iter().map(|c| c.name.clone()).collect();
            return Ok(json!({
                "response": format!("`{}` is called by: {}", name, caller_names.join(", ")),
                "suggestedEdits": [],
                "explanation": null,
                "confidence": 0.9,
                "alternatives": [],
            }));
        }
    }

    tracing::debug!(%lower, "checking code generation"); // Check if this is a code generation request
    if is_code_generation_request(&lower) {
        return handle_code_generation(message, ctx);
    }

    // Default: echo with context awareness
    let file_hint = context
        .get("currentFile")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    Ok(json!({
        "response": format!("Hermes received: '{}' (mode: {}, file: {})", message, mode, file_hint),
        "suggestedEdits": [],
        "explanation": null,
        "confidence": 1.0,
        "alternatives": [],
    }))
}

/// Check if the message is a code generation request.
fn is_code_generation_request(input: &str) -> bool {
    let keywords = [
        "add ", "create ", "implement ", "write ", "build ", "make ",
        "generate ", "fix ", "refactor ", "update ", "modify ",
    ];
    keywords.iter().any(|kw| input.starts_with(kw))
}

/// Extract a JSON object from output that may contain non-JSON text before/after.
fn extract_json_from_output(output: &str) -> Option<serde_json::Value> {
    // Find all positions of '{' and try to parse from each one
    for (start, _) in output.match_indices('{') {
        let trimmed = &output[start..];
        for end in (1..=trimmed.len()).rev() {
            if let Ok(v) = serde_json::from_str::<serde_json::Value>(&trimmed[..end]) {
                return Some(v);
            }
        }
    }
    None
}

/// Handle a code generation request — returns suggested edits with diffs.
fn handle_code_generation(message: &str, ctx: AppContext) -> Result<Value> {
    tracing::info!(%message, "code generation requested");
    // Spawn Python pipeline process
    let pipeline_script = std::env::var("PIPELINE_SCRIPT")
        .unwrap_or_else(|_| "python -m hermes_agents.run_pipeline".to_string());

    // Split the pipeline script into executable + args
    let pipeline_parts: Vec<&str> = pipeline_script.split_whitespace().collect();
    if pipeline_parts.is_empty() {
        return Err(SurpassingError::Protocol("empty PIPELINE_SCRIPT".into()));
    }
    let python_exe = pipeline_parts[0];
    let mut cmd = std::process::Command::new(python_exe);
    // Always resolve PYTHONPATH from binary location — ignore any pre-existing
    // PYTHONPATH from the IDE environment (e.g. VS Code Python extension sets it)
    {
        let exe_path = std::env::current_exe().unwrap_or_default();
        let exe_dir = exe_path.parent().unwrap_or(std::path::Path::new("."));
        let python_dir = exe_dir.join("../../python");
        let python_path = if python_dir.exists() {
            python_dir
        } else if let Ok(home) = std::env::var("SURPASSING_HOME") {
            std::path::Path::new(&home).join("python")
        } else if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            std::path::Path::new(&manifest_dir).join("../../python")
        } else {
            std::path::PathBuf::from("python")
        };
        let path_str = std::fs::canonicalize(&python_path)
            .unwrap_or(python_path)
            .display()
            .to_string()
            .replace(r"\\?\", "")
            .replace('\\', "/");
        tracing::debug!(%path_str, "resolved PYTHONPATH for pipeline");
        cmd.env("PYTHONPATH", path_str);
    }
    for arg in &pipeline_parts[1..] { cmd.arg(arg); }
    cmd.arg("--task").arg(message).arg("--mode").arg("feature");
    tracing::debug!(command = ?cmd, "spawning pipeline process");

    // Use piped stdout so we can stream progress (avoids VS Code timeout)
    cmd.stdout(std::process::Stdio::piped());
    cmd.stderr(std::process::Stdio::piped());

    let mut child = cmd.spawn()
        .map_err(|e| SurpassingError::Protocol(format!("pipeline spawn failed: {}", e)))?;

    let stdout = child.stdout.take().unwrap();
    let reader = std::io::BufReader::new(stdout);

    let mut final_result = String::new();
    let mut progress_lines = Vec::new();

    for line in reader.lines() {
        let line = line.map_err(|e| SurpassingError::Protocol(format!("read error: {}", e)))?;
        if line.trim().is_empty() { continue; }

        // Try to parse as JSON — if it's a progress update, log it
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            if val.get("status").is_some() && val.get("success").is_none() {
                // Progress update
                tracing::info!(?val, "pipeline progress");
                progress_lines.push(val);
            } else {
                // Final result
                final_result = line;
            }
        } else {
            // Non-JSON line, might be part of the final output
            final_result = line;
        }
    }

    let status = child.wait()
        .map_err(|e| SurpassingError::Protocol(format!("pipeline wait failed: {}", e)))?;

    let stdout_str = if final_result.is_empty() {
        // No final JSON found, reconstruct from what we have
        format!("{{\"success\": false, \"error\": \"pipeline produced no output\", \"progress\": {:?}}}", progress_lines)
    } else {
        final_result
    };

    let stderr = {
        let mut buf = String::new();
        if let Some(mut stderr_handle) = child.stderr.take() {
            use std::io::Read;
            let _ = stderr_handle.read_to_string(&mut buf);
        }
        buf
    };

    if !status.success() {
        tracing::error!(%stderr, "pipeline process failed");
        return Ok(json!({
            "response": format!("Pipeline failed: {}", stderr),
            "suggestedEdits": [],
            "confidence": 0.0,
        }));
    }

    // Parse pipeline output — extract JSON from stdout (may have log lines before/after)
    let pipeline_result: serde_json::Value = match extract_json_from_output(&stdout_str) {
        Some(v) => v,
        None => {
            tracing::error!("failed to parse pipeline output");
            return Ok(json!({
                "response": format!("Pipeline output: {}", stdout_str.trim()),
                "suggestedEdits": [],
                "confidence": 0.5,
            }));
        }
    };

    // Extract code changes as suggested edits
    let code_changes = pipeline_result
        .get("code_changes")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    let suggested_edits: Vec<serde_json::Value> = code_changes
        .iter()
        .map(|change| json!({
            "file_path": change.get("file_path").and_then(|v| v.as_str()).unwrap_or("unknown"),
            "original": change.get("original").and_then(|v| v.as_str()).unwrap_or(""),
            "modified": change.get("modified").and_then(|v| v.as_str()).unwrap_or(""),
            "explanation": change.get("explanation").and_then(|v| v.as_str()).unwrap_or(""),
            "confidence": change.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.8),
        }))
        .collect();

    let response_text = pipeline_result.get("explanation")
        .and_then(|v| v.as_str())
        .unwrap_or("Code generated");

    Ok(json!({
        "response": response_text.to_string(),
        "suggestedEdits": suggested_edits,
        "explanation": "Planner created plan, Coder generated implementation",
        "confidence": pipeline_result.get("confidence").and_then(|v| v.as_f64()).unwrap_or(0.8),
        "alternatives": [],
    }))
}

/// Generate code from a natural language request.
/// This is a simplified implementation — the full version would call
/// the Planner and Coder Python agents via the context bus.
fn generate_code_from_request(request: &str) -> String {
    let lower = request.to_lowercase();

    if lower.contains("hello world") || lower.contains("hello world") {
        r#"/// Prints "Hello, World!" to the console.
pub fn hello_world() {
    println!("Hello, World!");
}

fn main() {
    hello_world();
}
"#.to_string()
    } else if lower.contains("add") && lower.contains("function") {
        r#"/// Adds two numbers and returns the result.
pub fn add(a: i32, b: i32) -> i32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add() {
        assert_eq!(add(2, 3), 5);
        assert_eq!(add(-1, 1), 0);
    }
}
"#.to_string()
    } else {
        format!("// TODO: Implement '{}'\npub fn new_feature() {{\n    // Implementation here\n}}\n", request)
    }
}

/// Shutdown handler — graceful cleanup signal.
pub fn handle_shutdown(_params: Value, _ctx: AppContext) -> Result<Value> {
    tracing::info!("shutdown requested");
    Ok(json!({ "status": "shutting_down" }))
}

/// Context query handler — knowledge graph lookup.
pub fn handle_context_query(params: Value, ctx: AppContext) -> Result<Value> {
    let symbol = params
        .get("symbol")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let query_type = params
        .get("queryType")
        .and_then(|v| v.as_str())
        .unwrap_or("definition");

    tracing::debug!(%symbol, %query_type, "context query");

    match query_type {
        "definition" => {
            let symbols = ctx.graph.find_symbol(symbol)?;
            if symbols.is_empty() {
                Ok(json!({
                    "symbols": [],
                    "relationships": [],
                    "fileSnippets": [],
                    "architectureNotes": [format!("Symbol '{}' not found in index", symbol)],
                }))
            } else {
                let sym = &symbols[0];
                let callers = ctx.graph.find_callers(&sym.id)?;
                let callees = ctx.graph.find_callees(&sym.id)?;
                Ok(json!({
                    "symbols": [{
                        "name": sym.name,
                        "type": format!("{:?}", sym.symbol_type),
                        "language": sym.language,
                        "file": sym.file_path,
                        "line": sym.start_line,
                        "signature": sym.signature,
                        "isPublic": sym.is_public,
                    }],
                    "relationships": {
                        "callers": callers.iter().map(|c| c.name.clone()).collect::<Vec<_>>(),
                        "callees": callees.iter().map(|c| c.name.clone()).collect::<Vec<_>>(),
                    },
                    "fileSnippets": [],
                    "architectureNotes": [],
                }))
            }
        }
        "type" => {
            let type_name = params.get("typeName").and_then(|v| v.as_str()).unwrap_or("");
            let symbols = ctx.graph.find_symbol(type_name)?;
            Ok(json!({
                "symbols": symbols.iter().map(|s| {
                    json!({
                        "name": s.name,
                        "type": format!("{:?}", s.symbol_type),
                        "file": s.file_path,
                        "line": s.start_line,
                    })
                }).collect::<Vec<_>>(),
                "relationships": [],
                "fileSnippets": [],
                "architectureNotes": [],
            }))
        }
        "file" => {
            let symbols = ctx.graph.find_in_file(symbol)?;
            Ok(json!({
                "symbols": symbols.iter().map(|s| {
                    json!({
                        "name": s.name,
                        "type": format!("{:?}", s.symbol_type),
                        "line": s.start_line,
                        "signature": s.signature,
                    })
                }).collect::<Vec<_>>(),
                "relationships": [],
                "fileSnippets": [],
                "architectureNotes": [],
            }))
        }
        _ => {
            Ok(json!({
                "symbols": [],
                "relationships": [],
                "fileSnippets": [],
                "architectureNotes": [format!("Unknown query type: {}", query_type)],
            }))
        }
    }
}

/// Extract a symbol name from a natural language query.
fn extract_symbol_query(input: &str) -> Option<String> {
    let prefixes = [
        "what is ", "what's ", "find ", "explain ", "show me ",
        "describe ", "where is ", "tell me about ", "look up ",
    ];
    for prefix in &prefixes {
        if let Some(rest) = input.strip_prefix(prefix) {
            let name = rest.trim_end_matches('?').trim_end_matches('.').trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Extract a symbol name from "who calls X" queries.
fn extract_who_calls(input: &str) -> Option<String> {
    let prefixes = ["who calls ", "what calls ", "callers of "];
    for prefix in &prefixes {
        if let Some(rest) = input.strip_prefix(prefix) {
            let name = rest.trim_end_matches('?').trim_end_matches('.').trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

/// Index all source files in a project directory.
fn index_project(graph: &KnowledgeGraph, target_dir: &str) {
    use walkdir::WalkDir;
    use surpassing_indexer::{AstParser, SymbolExtractor, SymbolType as ISymbolType};

    let mut parser = AstParser::new();
    let mut count = 0;

    for entry in WalkDir::new(target_dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("");

        if !matches!(ext, "rs" | "py" | "js" | "ts" | "go" | "java") {
            continue;
        }

        if path.components().any(|c| {
            let name = c.as_os_str().to_string_lossy();
            name == "target" || name == "node_modules" || name == ".git" || name == "__pycache__"
        }) {
            continue;
        }

        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        eprintln!("[index_project] Found file: {} (ext={})", path.display(), ext);

        if let Some(nodes) = parser.parse_file(path, &content) {
            eprintln!("[index_project] Parsed {} nodes", nodes.len());
            let file_path = path.to_string_lossy().to_string();
            let symbols = SymbolExtractor::extract_symbols(
                std::path::PathBuf::from(&file_path),
                &nodes,
                &content,
            );

            for sym in symbols {
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

                let _ = graph.add_symbol(
                    &sym.name,
                    sg_type,
                    ext,
                    &file_path,
                    sym.line,
                    sym.line + 1,
                    Some(&sym.signature),
                    true,
                );
                count += 1;
            }
        }
    }

    eprintln!("[index_project] Done. Indexed {} symbols", count);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_context() -> AppContext {
        AppContext::new(KnowledgeGraph::open_in_memory().unwrap())
    }

    #[test]
    fn test_initialize_returns_capabilities() {
        let ctx = make_context();
        let result = handle_initialize(serde_json::json!({}), ctx).unwrap();
        let caps = result.get("capabilities").unwrap();
        assert!(caps.get("chat").unwrap().as_bool().unwrap());
        assert!(caps.get("knowledgeGraph").unwrap().as_bool().unwrap());
        let agents = caps.get("agents").unwrap().as_array().unwrap();
        assert_eq!(agents.len(), 5);
    }

    #[test]
    fn test_initialize_returns_server_info() {
        let ctx = make_context();
        let result = handle_initialize(serde_json::json!({}), ctx).unwrap();
        let info = result.get("serverInfo").unwrap();
        assert_eq!(info.get("name").unwrap().as_str().unwrap(), "surpassing");
    }

    #[test]
    fn test_initialize_with_root_uri() {
        let ctx = make_context();
        let params = serde_json::json!({ "rootUri": "file:///C:/tmp/chat_demo/src" });
        let result = handle_initialize(params, ctx).unwrap();
        assert!(result.get("capabilities").is_some());
    }

    #[test]
    fn test_extract_symbol_query() {
        assert_eq!(extract_symbol_query("what is fibonacci"), Some("fibonacci".to_string()));
        assert_eq!(extract_symbol_query("find the helper function"), Some("the helper function".to_string()));
        assert_eq!(extract_symbol_query("explain parse()"), Some("parse()".to_string()));
        assert_eq!(extract_symbol_query("show me the Cache struct"), Some("the Cache struct".to_string()));
        assert_eq!(extract_symbol_query("hello world"), None);
    }

    #[test]
    fn test_extract_who_calls() {
        assert_eq!(extract_who_calls("who calls helper"), Some("helper".to_string()));
        assert_eq!(extract_who_calls("what calls main"), Some("main".to_string()));
        assert_eq!(extract_who_calls("callers of fibonacci"), Some("fibonacci".to_string()));
        assert_eq!(extract_who_calls("hello world"), None);
    }

    #[test]
    fn test_shutdown() {
        let ctx = make_context();
        let result = handle_shutdown(serde_json::json!({}), ctx).unwrap();
        assert_eq!(result.get("status").unwrap().as_str().unwrap(), "shutting_down");
    }

    #[test]
    fn test_chat_with_symbol_query() {
        let ctx = make_context();
        ctx.graph.add_symbol("fib", SymbolType::Function, "rust", "src/lib.rs", 1, 5, Some("fn fib()"), true).unwrap();

        let params = serde_json::json!({ "message": "what is fib", "mode": "chat" });
        let result = handle_chat(params, ctx).unwrap();
        let response = result.get("response").unwrap().as_str().unwrap();
        assert!(response.contains("fib"));
        assert!(response.contains("src/lib.rs"));
    }

    #[test]
    fn test_chat_who_calls() {
        let ctx = make_context();
        let main_id = ctx.graph.add_symbol("main", SymbolType::Function, "rust", "main.rs", 1, 5, None, false).unwrap();
        let helper_id = ctx.graph.add_symbol("helper", SymbolType::Function, "rust", "lib.rs", 1, 3, None, true).unwrap();
        ctx.graph.add_edge(&main_id, &helper_id, surpassing_graph::EdgeType::Calls, 1.0).unwrap();

        let params = serde_json::json!({ "message": "who calls helper", "mode": "chat" });
        let result = handle_chat(params, ctx).unwrap();
        let response = result.get("response").unwrap().as_str().unwrap();
        assert!(response.contains("main"));
    }

    #[test]
    fn test_context_query_not_found() {
        let ctx = make_context();
        let params = serde_json::json!({ "symbol": "myFunction" });
        let result = handle_context_query(params, ctx).unwrap();
        let notes = result.get("architectureNotes").unwrap().as_array().unwrap();
        assert!(notes[0].as_str().unwrap().contains("myFunction"));
    }
}
