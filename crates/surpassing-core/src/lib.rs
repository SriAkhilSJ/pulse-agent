//! Core types, errors, and shared utilities for the Surpassing IDE Agent.
//!
//! This crate contains:
//! - Error types used across all layers
//! - Common data structures (Symbol, File, Position, etc.)
//! - Tracing and instrumentation utilities
//! - Async helpers and channel wrappers

#![warn(missing_docs)]
#![warn(unreachable_pub)]

pub mod error;
pub mod types;
pub mod tracing;
pub mod async_utils;

pub use error::{SurpassingError, Result};
pub use types::*;
