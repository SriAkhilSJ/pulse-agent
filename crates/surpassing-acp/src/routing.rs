//! Method router — dispatches ACP requests to the appropriate handler.

use crate::context::AppContext;
use surpassing_core::{Result, SurpassingError};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Arc;

type HandlerFn = Arc<dyn Fn(Value, AppContext) -> Result<Value> + Send + Sync>;

/// Routes method calls to registered handlers.
pub struct MethodRouter {
    handlers: HashMap<String, HandlerFn>,
    notification_handlers: HashMap<String, Arc<dyn Fn(Value) + Send + Sync>>,
    context: AppContext,
}

impl MethodRouter {
    /// Create a new empty method router with the given context.
    pub fn new(context: AppContext) -> Self {
        Self {
            handlers: HashMap::new(),
            notification_handlers: HashMap::new(),
            context,
        }
    }

    /// Register a handler for a method.
    pub fn register<F>(mut self, method: &str, handler: F) -> Self
    where
        F: Fn(Value, AppContext) -> Result<Value> + Send + Sync + 'static,
    {
        self.handlers.insert(method.to_string(), Arc::new(handler));
        self
    }

    /// Register a notification handler.
    pub fn register_notification<F>(mut self, method: &str, handler: F) -> Self
    where
        F: Fn(Value) + Send + Sync + 'static,
    {
        self.notification_handlers
            .insert(method.to_string(), Arc::new(handler));
        self
    }

    /// Route a request to its handler.
    pub fn route(&self, method: String, params: Value) -> Result<Value> {
        match self.handlers.get(&method) {
            Some(handler) => handler(params, self.context.clone()),
            None => Err(SurpassingError::Protocol(format!(
                "unknown method: {}",
                method
            ))),
        }
    }

    /// Route a notification to its handler.
    pub fn route_notification(&self, method: String, params: Value) {
        if let Some(handler) = self.notification_handlers.get(&method) {
            handler(params);
        }
    }
}
