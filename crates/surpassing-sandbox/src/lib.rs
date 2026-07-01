//! Safe execution environment — sandboxed code execution with resource limits
//!
//! This crate is part of the Surpassing IDE Agent architecture.

#![warn(missing_docs)]
#![warn(unreachable_pub)]

pub mod git;
pub mod limits;
pub mod runner;
pub mod sandbox;

pub use git::GitIntegration;
pub use limits::ResourceLimits;
pub use runner::{ExecutionResult, SandboxRunner};
pub use sandbox::{security_scan, IsolationLevel, Language, Sandbox, SandboxRequest, SandboxResult, SecurityFinding};
