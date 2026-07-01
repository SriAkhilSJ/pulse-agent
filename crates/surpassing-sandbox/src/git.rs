//! Git Integration — safe version control operations.

use std::path::Path;
use tokio::process::Command;
use tracing::{info, instrument, warn};

use surpassing_core::Result;

/// Git operation result.
#[derive(Debug, Clone)]
pub struct GitResult {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    pub branch: String,
    pub commit_hash: Option<String>,
}

/// Git integration for safe code changes.
pub struct GitIntegration {
    repo_path: std::path::PathBuf,
}

impl GitIntegration {
    pub fn new(repo_path: impl AsRef<Path>) -> Self {
        Self {
            repo_path: repo_path.as_ref().to_path_buf(),
        }
    }

    /// Check if git repo is clean.
    pub async fn is_clean(&self) -> Result<bool> {
        let output = Command::new("git")
            .args(["status", "--porcelain"])
            .current_dir(&self.repo_path)
            .output()
            .await?;
        Ok(output.stdout.is_empty())
    }

    /// Stash current WIP before making changes.
    #[instrument(skip(self))]
    pub async fn stash_wip(&self, message: &str) -> Result<Option<String>> {
        if !self.is_clean().await? {
            let output = Command::new("git")
                .args(["stash", "push", "-m", message])
                .current_dir(&self.repo_path)
                .output()
                .await?;
            if output.status.success() {
                let stash_ref = String::from_utf8_lossy(&output.stdout).trim().to_string();
                info!(%stash_ref, "WIP stashed");
                return Ok(Some(stash_ref));
            }
        }
        Ok(None)
    }

    /// Create a feature branch.
    #[instrument(skip(self))]
    pub async fn create_branch(&self, feature_name: &str) -> Result<String> {
        let branch_name = format!("agent/{}", Self::sanitize_branch_name(feature_name));
        let output = Command::new("git")
            .args(["checkout", "-b", &branch_name])
            .current_dir(&self.repo_path)
            .output()
            .await?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(surpassing_core::SurpassingError::Io(
                std::io::Error::new(std::io::ErrorKind::Other, format!("Failed to create branch: {}", stderr))
            ));
        }
        info!(%branch_name, "Created feature branch");
        Ok(branch_name)
    }

    /// Commit changes with conventional commit format.
    #[instrument(skip(self))]
    pub async fn commit(&self, change_type: &str, scope: &str, description: &str, body: Option<&str>) -> Result<String> {
        let commit_message = if let Some(b) = body {
            format!("{}({}): {}\n\n{}", change_type, scope, description, b)
        } else {
            format!("{}({}): {}", change_type, scope, description)
        };
        Command::new("git")
            .args(["add", "-A"])
            .current_dir(&self.repo_path)
            .output()
            .await?;
        let output = Command::new("git")
            .args(["commit", "-m", &commit_message])
            .current_dir(&self.repo_path)
            .output()
            .await?;
        if !output.status.success() {
            warn!("Commit failed — possibly nothing to commit");
            return Ok(String::new());
        }
        let hash_output = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&self.repo_path)
            .output()
            .await?;
        let hash = String::from_utf8_lossy(&hash_output.stdout).trim().to_string();
        info!(%hash, "Committed");
        Ok(hash)
    }

    /// Get current branch name.
    pub async fn current_branch(&self) -> Result<String> {
        let output = Command::new("git")
            .args(["branch", "--show-current"])
            .current_dir(&self.repo_path)
            .output()
            .await?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    /// Sanitize a string for use as a branch name.
    fn sanitize_branch_name(name: &str) -> String {
        name.to_lowercase()
            .replace(|c: char| !c.is_alphanumeric() && c != '-' && c != '_', "-")
            .replace("--", "-")
            .trim_matches('-')
            .to_string()
            .chars()
            .take(50)
            .collect()
    }

    /// Restore stashed WIP.
    pub async fn restore_stash(&self, stash_ref: &str) -> Result<()> {
        Command::new("git")
            .args(["stash", "pop", stash_ref])
            .current_dir(&self.repo_path)
            .output()
            .await?;
        info!("Restored stashed WIP");
        Ok(())
    }
}
