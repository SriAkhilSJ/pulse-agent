//! Sandbox runner — executes code in Docker containers or directly with resource limits.

use serde::{Deserialize, Serialize};
use std::path::Path;
use std::time::Duration;
use tokio::process::Command;
use tracing::{debug, info, warn};

use surpassing_core::Result;

use crate::{IsolationLevel, Language, SandboxRequest};

/// Result of code execution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExecutionResult {
    pub exit_code: i32,
    pub stdout: String,
    pub stderr: String,
}

/// Sandbox runner that tries Docker first, falls back to direct execution.
pub struct SandboxRunner {
    docker_available: bool,
}

impl SandboxRunner {
    /// Create a new runner, detecting Docker availability.
    pub async fn new() -> Result<Self> {
        let docker_available = Self::check_docker().await;
        if docker_available {
            info!("Docker available — using container sandbox");
        } else {
            warn!("Docker not available — using direct execution with timeout");
        }
        Ok(Self { docker_available })
    }

    /// Check if Docker is available.
    async fn check_docker() -> bool {
        match Command::new("docker")
            .args(["version", "--format", "{{.Server.Version}}"])
            .output()
            .await
        {
            Ok(output) => output.status.success(),
            Err(_) => false,
        }
    }

    /// Execute code in the sandbox.
    pub async fn execute(&self, request: &SandboxRequest) -> Result<ExecutionResult> {
        match request.isolation {
            IsolationLevel::Docker if self.docker_available => {
                self.execute_docker(request).await
            }
            _ => {
                self.execute_direct(request).await
            }
        }
    }

    /// Execute code in a Docker container.
    async fn execute_docker(&self, request: &SandboxRequest) -> Result<ExecutionResult> {
        let file_name = format!("code.{}", request.language.extension());
        let work_dir = request.working_dir.as_deref().unwrap_or_else(|| Path::new("."));

        // Write code to a temp file in the working dir
        let code_path = work_dir.join(&file_name);
        tokio::fs::write(&code_path, &request.code).await.map_err(|e| {
            surpassing_core::SurpassingError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Failed to write code file: {}", e),
            ))
        })?;

        let run_cmd = request.language.run_command(&file_name);
        let container_name = format!("sandbox-{}", uuid::Uuid::new_v4());

        // Build docker run command
        let mut args = vec![
            "run".to_string(),
            "--rm".to_string(),
            "--name".to_string(),
            container_name,
            "--network=none".to_string(),
            "--memory=128m".to_string(),
            "--cpus=0.5".to_string(),
            "--read-only".to_string(),
            "-v".to_string(),
            format!("{}:/code", work_dir.canonicalize().unwrap_or_else(|_| work_dir.to_path_buf()).display()),
            "-w".to_string(),
            "/code".to_string(),
            request.language.docker_image().to_string(),
        ];
        args.extend(run_cmd);

        info!(image = request.language.docker_image(), "Running code in Docker container");

        let timeout_duration = request.resource_limits.timeout();
        let output = tokio::time::timeout(
            timeout_duration,
            Command::new("docker").args(&args).output(),
        ).await.map_err(|_| {
            surpassing_core::SurpassingError::Sandbox("Execution timed out".to_string())
        })??;

        // Cleanup temp file
        let _ = tokio::fs::remove_file(&code_path).await;

        Ok(ExecutionResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }

    /// Execute code directly with timeout (fallback when Docker unavailable).
    async fn execute_direct(&self, request: &SandboxRequest) -> Result<ExecutionResult> {
        let file_name = format!("code.{}", request.language.extension());
        let work_dir = request.working_dir.clone().unwrap_or_else(|| std::env::temp_dir().join("surpassing-sandbox"));
        std::fs::create_dir_all(&work_dir)?;

        let code_path = work_dir.join(&file_name);
        tokio::fs::write(&code_path, &request.code).await.map_err(|e| {
            surpassing_core::SurpassingError::Io(std::io::Error::new(
                std::io::ErrorKind::Other,
                format!("Failed to write code file: {}", e),
            ))
        })?;

        let run_cmd = request.language.run_command(&file_name);
        let mut cmd = Command::new(&run_cmd[0]);
        cmd.args(&run_cmd[1..])
            .current_dir(&work_dir);

        // Clear environment for security — only pass allowed vars
        cmd.env_clear();
        for (key, val) in &request.env_vars {
            cmd.env(key, val);
        }

        info!(command = ?run_cmd, "Running code directly with timeout");

        let timeout_duration = request.resource_limits.timeout();
        let output = tokio::time::timeout(
            timeout_duration,
            cmd.output(),
        ).await.map_err(|_| {
            surpassing_core::SurpassingError::Sandbox("Execution timed out".to_string())
        })??;

        // Cleanup
        let _ = tokio::fs::remove_file(&code_path).await;
        let _ = tokio::fs::remove_dir(&work_dir).await;

        Ok(ExecutionResult {
            exit_code: output.status.code().unwrap_or(-1),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
        })
    }
}
