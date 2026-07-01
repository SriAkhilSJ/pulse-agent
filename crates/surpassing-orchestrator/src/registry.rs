//! Agent registry — tracks available agent types and their capabilities.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Type of specialized agent in the swarm.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub enum AgentType {
    Planner,
    Coder,
    Reviewer,
    Tester,
    Debugger,
}

impl std::fmt::Display for AgentType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AgentType::Planner => write!(f, "planner"),
            AgentType::Coder => write!(f, "coder"),
            AgentType::Reviewer => write!(f, "reviewer"),
            AgentType::Tester => write!(f, "tester"),
            AgentType::Debugger => write!(f, "debugger"),
        }
    }
}

/// Capabilities and metadata for an agent type.
#[derive(Debug, Clone)]
pub struct AgentInfo {
    pub agent_type: AgentType,
    pub description: String,
    pub supported_modes: Vec<String>,
}

/// Registry of all available agent types.
pub struct AgentRegistry {
    agents: HashMap<AgentType, AgentInfo>,
}

impl AgentRegistry {
    /// Create a new registry with all built-in agent types.
    pub fn new() -> Self {
        let mut agents = HashMap::new();

        agents.insert(AgentType::Planner, AgentInfo {
            agent_type: AgentType::Planner,
            description: "Task decomposition, dependency ordering, risk assessment".to_string(),
            supported_modes: vec![
                "feature".into(), "bugfix".into(), "refactor".into(),
                "test".into(), "docs".into(), "migrate".into(),
            ],
        });

        agents.insert(AgentType::Coder, AgentInfo {
            agent_type: AgentType::Coder,
            description: "TDD-mode implementation, refactoring, code generation".to_string(),
            supported_modes: vec![
                "feature".into(), "bugfix".into(), "refactor".into(),
                "docs".into(), "migrate".into(),
            ],
        });

        agents.insert(AgentType::Reviewer, AgentInfo {
            agent_type: AgentType::Reviewer,
            description: "Static analysis, security scan, style, architecture alignment".to_string(),
            supported_modes: vec!["review".into()],
        });

        agents.insert(AgentType::Tester, AgentInfo {
            agent_type: AgentType::Tester,
            description: "Unit/integration/e2e test generation, coverage analysis".to_string(),
            supported_modes: vec!["unit".into(), "integration".into(), "e2e".into()],
        });

        agents.insert(AgentType::Debugger, AgentInfo {
            agent_type: AgentType::Debugger,
            description: "Stack trace analysis, breakpoint suggestion, fix proposals".to_string(),
            supported_modes: vec!["debug".into()],
        });

        Self { agents }
    }

    /// Get info for a specific agent type.
    pub fn get(&self, agent_type: &AgentType) -> Option<&AgentInfo> {
        self.agents.get(agent_type)
    }

    /// List all registered agent types.
    pub fn list(&self) -> Vec<&AgentInfo> {
        self.agents.values().collect()
    }

    /// Find agent types that support a given mode.
    pub fn find_for_mode(&self, mode: &str) -> Vec<AgentType> {
        self.agents.iter()
            .filter(|(_, info)| info.supported_modes.iter().any(|m| m == mode))
            .map(|(t, _)| *t)
            .collect()
    }
}

impl Default for AgentRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_registry_has_all_agents() {
        let reg = AgentRegistry::new();
        assert!(reg.get(&AgentType::Planner).is_some());
        assert!(reg.get(&AgentType::Coder).is_some());
        assert!(reg.get(&AgentType::Reviewer).is_some());
        assert!(reg.get(&AgentType::Tester).is_some());
        assert!(reg.get(&AgentType::Debugger).is_some());
    }

    #[test]
    fn test_find_for_mode() {
        let reg = AgentRegistry::new();
        let feature_agents = reg.find_for_mode("feature");
        assert!(feature_agents.contains(&AgentType::Planner));
        assert!(feature_agents.contains(&AgentType::Coder));
    }

    #[test]
    fn test_list_agents() {
        let reg = AgentRegistry::new();
        assert_eq!(reg.list().len(), 5);
    }
}
