//! Safe Execution Environment — sandboxed code execution.
//!
//! Security layers:
//! 1. Docker container per execution (isolated from host)
//! 2. Resource limits (CPU, memory, disk, timeout)
//! 3. Network isolation (no network by default)
//! 4. Security scan before execution (pattern-based)
//! 5. Timeout enforcement

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tracing::{info, instrument, warn};

use surpassing_core::Result;

use crate::limits::ResourceLimits;
use crate::runner::{ExecutionResult, SandboxRunner};
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum IsolationLevel {
    /// Docker container — good for trusted code.
    Docker,
    /// Direct execution with timeout — fallback when Docker unavailable.
    Direct,
}

/// A request to execute code in the sandbox.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxRequest {
    pub code: String,
    pub language: Language,
    pub test_command: Option<String>,
    pub resource_limits: ResourceLimits,
    pub isolation: IsolationLevel,
    pub working_dir: Option<PathBuf>,
    pub env_vars: Vec<(String, String)>,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub enum Language {
    Rust,
    Python,
    JavaScript,
    TypeScript,
    Go,
    Java,
}

impl Language {
    /// File extension for this language.
    pub fn extension(&self) -> &str {
        match self {
            Language::Rust => "rs",
            Language::Python => "py",
            Language::JavaScript => "js",
            Language::TypeScript => "ts",
            Language::Go => "go",
            Language::Java => "java",
        }
    }

    /// Docker image for this language.
    pub fn docker_image(&self) -> &str {
        match self {
            Language::Python => "python:3.12-slim",
            Language::Rust => "rust:1.79-slim",
            Language::JavaScript | Language::TypeScript => "node:20-slim",
            Language::Go => "golang:1.22-alpine",
            Language::Java => "eclipse-temurin:21-jdk",
        }
    }

    /// Command to run the code file.
    pub fn run_command(&self, file_name: &str) -> Vec<String> {
        match self {
            Language::Python => vec!["python".to_string(), file_name.to_string()],
            Language::Rust => vec!["sh".to_string(), "-c".to_string(), format!("rustc {file_name} -o /tmp/out && /tmp/out")],
            Language::JavaScript => vec!["node".to_string(), file_name.to_string()],
            Language::TypeScript => vec!["npx".to_string(), "tsx".to_string(), file_name.to_string()],
            Language::Go => vec!["go".to_string(), "run".to_string(), file_name.to_string()],
            Language::Java => vec!["sh".to_string(), "-c".to_string(), format!("javac {file_name} && java {}", file_name.trim_end_matches(".java"))],
        }
    }
}

/// Security finding from pre-execution scan.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecurityFinding {
    pub severity: String,
    pub rule: String,
    pub message: String,
    pub line: Option<usize>,
}

/// Result of sandbox execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SandboxResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
    pub duration_ms: u64,
    pub security_findings: Vec<SecurityFinding>,
    pub approved: bool,
}

/// The sandbox execution engine.
pub struct Sandbox {
    runner: SandboxRunner,
}

impl Sandbox {
    /// Create a new sandbox, auto-detecting Docker availability.
    pub async fn new() -> Result<Self> {
        let runner = SandboxRunner::new().await?;
        Ok(Self { runner })
    }

    /// Execute code in the sandbox with full validation pipeline.
    #[instrument(skip(self, request))]
    pub async fn execute(&self, request: SandboxRequest) -> Result<SandboxResult> {
        let start = std::time::Instant::now();

        // Step 1: Security scan
        let findings = security_scan(&request.code, &request.language);

        let critical_count = findings.iter().filter(|f| f.severity == "critical").count();
        if critical_count > 0 {
            warn!("Critical security findings: {}, blocking execution", critical_count);
            return Ok(SandboxResult {
                exit_code: -1,
                stdout: String::new(),
                stderr: format!("Execution blocked: {} critical security finding(s)", critical_count),
                duration_ms: start.elapsed().as_millis() as u64,
                security_findings: findings,
                approved: false,
            });
        }

        // Step 2: Execute
        let result = self.runner.execute(&request).await?;

        // Step 3: Determine approval
        let approved = result.exit_code == 0
            && !findings.iter().any(|f| f.severity == "high");

        let duration_ms = start.elapsed().as_millis() as u64;

        info!(
            exit_code = result.exit_code,
            duration_ms = duration_ms,
            approved = approved,
            "Sandbox execution complete"
        );

        Ok(SandboxResult {
            exit_code: result.exit_code,
            stdout: result.stdout,
            stderr: result.stderr,
            duration_ms,
            security_findings: findings,
            approved,
        })
    }
}

/// Pattern-based security scan.
pub fn security_scan(code: &str, language: &Language) -> Vec<SecurityFinding> {
    let mut findings = Vec::new();

    let patterns: Vec<(&str, &str, &str, &str)> = match language {
        Language::Python => vec![
            ("eval_usage", r"\beval\s*\(", "critical", "eval() is dangerous"),
            ("exec_usage", r"\bexec\s*\(", "critical", "exec() is dangerous"),
            ("os_system", r"os\.system\s*\(", "high", "os.system() can execute arbitrary commands"),
            ("subprocess_shell", r"subprocess\..*shell\s*=\s*True", "high", "shell=True enables command injection"),
            ("pickle_loads", r"pickle\.loads", "high", "pickle.loads is unsafe"),
            ("yaml_load", r"yaml\.load\s*\(", "high", "yaml.load without Loader is unsafe"),
            ("hardcoded_password", r#"password\s*=\s*["'][^"']{3,}["']"#, "medium", "Possible hardcoded password"),
            ("hardcoded_secret", r#"secret\s*=\s*["'][^"']{3,}["']"#, "medium", "Possible hardcoded secret"),
            ("open_file", r"\bopen\s*\(", "low", "File access — verify intended"),
        ],
        Language::Rust => vec![
            ("unsafe_block", r"unsafe\s*\{", "medium", "Unsafe block detected"),
            ("unwrap_usage", r"\.unwrap\(\)", "low", "unwrap() can panic"),
            ("std_process", r"std::process::", "medium", "Process execution"),
        ],
        Language::JavaScript | Language::TypeScript => vec![
            ("eval_usage", r"\beval\s*\(", "critical", "eval() is dangerous"),
            ("innerHTML", r"\.innerHTML\s*=", "high", "innerHTML enables XSS"),
            ("document_write", r"document\.write\s*\(", "high", "document.write is dangerous"),
            ("child_process", r#"require\s*\(\s*['"]child_process['"]\s*\)"#, "medium", "Child process execution"),
        ],
        Language::Go => vec![
            ("exec_command", r"exec\.Command", "medium", "Process execution"),
            ("os_exec", r"os/exec", "medium", "Process execution"),
        ],
        Language::Java => vec![
            ("runtime_exec", r"Runtime\.getRuntime\(\)\.exec", "high", "Process execution"),
            ("process_builder", r"ProcessBuilder", "medium", "Process execution"),
        ],
    };

    for (rule, pattern, severity, message) in patterns {
        if let Ok(re) = regex::Regex::new(pattern) {
            for mat in re.find_iter(code) {
                let line = code[..mat.start()].chars().filter(|&c| c == '\n').count() + 1;
                findings.push(SecurityFinding {
                    severity: severity.to_string(),
                    rule: rule.to_string(),
                    message: message.to_string(),
                    line: Some(line),
                });
            }
        }
    }

    // Entropy scan for potential secrets
    for (line_num, line) in code.lines().enumerate() {
        for word in line.split_whitespace() {
            if word.len() >= 20 && shannon_entropy(word) > 4.5 {
                findings.push(SecurityFinding {
                    severity: "medium".to_string(),
                    rule: "high_entropy_string".to_string(),
                    message: format!("High-entropy string (possible secret): {}...", &word[..10.min(word.len())]),
                    line: Some(line_num + 1),
                });
            }
        }
    }

    findings
}

fn shannon_entropy(s: &str) -> f64 {
    use std::collections::HashMap;
    let mut freq = HashMap::new();
    for c in s.chars() {
        *freq.entry(c).or_insert(0) += 1;
    }
    let len = s.len() as f64;
    freq.values()
        .map(|&count| {
            let p = count as f64 / len;
            -p * p.log2()
        })
        .sum()
}
