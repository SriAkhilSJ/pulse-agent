//! Scheduler — determines execution order for agent tasks.
//!
//! Groups subtasks into parallel execution waves based on dependencies.

use crate::registry::AgentType;
use std::collections::HashSet;

/// A unit of work to be scheduled.
#[derive(Debug, Clone)]
pub struct TaskUnit {
    pub id: String,
    pub description: String,
    pub agent_type: AgentType,
    pub dependencies: Vec<String>,
}

/// A group of tasks that can execute in parallel.
pub type ParallelGroup = Vec<String>;

/// Scheduler — computes parallel execution groups from dependency graph.
pub struct Scheduler;

impl Scheduler {
    /// Create a new scheduler.
    pub fn new() -> Self {
        Self
    }

    /// Compute parallel execution groups from tasks.
    ///
    /// Each group contains task IDs that can run simultaneously.
    /// Groups are ordered — group N must complete before group N+1 starts.
    pub fn compute_parallel_groups(&self, tasks: &[TaskUnit]) -> Vec<ParallelGroup> {
        let mut remaining: HashSet<String> = tasks.iter().map(|t| t.id.clone()).collect();
        let mut groups = Vec::new();

        while !remaining.is_empty() {
            let group: Vec<String> = remaining.iter()
                .filter(|id| {
                    let task = tasks.iter().find(|t| &t.id == *id).unwrap();
                    task.dependencies.iter().all(|d| !remaining.contains(d))
                })
                .cloned()
                .collect();

            if group.is_empty() {
                // Cycle detected — force progress by picking one
                let forced = remaining.iter().next().unwrap().clone();
                groups.push(vec![forced.clone()]);
                remaining.remove(&forced);
            } else {
                for id in &group {
                    remaining.remove(id);
                }
                groups.push(group);
            }
        }

        groups
    }

    /// Validate that the task graph has no cycles.
    pub fn validate(&self, tasks: &[TaskUnit]) -> Result<(), String> {
        let ids: HashSet<String> = tasks.iter().map(|t| t.id.clone()).collect();

        // Check all dependencies exist
        for task in tasks {
            for dep in &task.dependencies {
                if !ids.contains(dep) {
                    return Err(format!("Task '{}' depends on non-existent task '{}'", task.id, dep));
                }
            }
        }

        // Check for cycles
        let mut visited = HashSet::new();
        let mut temp = HashSet::new();

        fn has_cycle(
            id: &str,
            tasks: &[TaskUnit],
            visited: &mut HashSet<String>,
            temp: &mut HashSet<String>,
        ) -> bool {
            if temp.contains(id) { return true; }
            if visited.contains(id) { return false; }

            temp.insert(id.to_string());

            if let Some(task) = tasks.iter().find(|t| t.id == id) {
                for dep in &task.dependencies {
                    if has_cycle(dep, tasks, visited, temp) {
                        return true;
                    }
                }
            }

            temp.remove(id);
            visited.insert(id.to_string());
            false
        }

        for task in tasks {
            if has_cycle(&task.id, tasks, &mut visited, &mut temp) {
                return Err(format!("Dependency cycle detected involving task '{}'", task.id));
            }
        }

        Ok(())
    }
}

impl Default for Scheduler {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_task(id: &str, deps: &[&str]) -> TaskUnit {
        TaskUnit {
            id: id.to_string(),
            description: format!("Task {}", id),
            agent_type: AgentType::Coder,
            dependencies: deps.iter().map(|d| d.to_string()).collect(),
        }
    }

    #[test]
    fn test_linear_dependencies() {
        let scheduler = Scheduler::new();
        let tasks = vec![
            make_task("T1", &[]),
            make_task("T2", &["T1"]),
            make_task("T3", &["T2"]),
        ];

        let groups = scheduler.compute_parallel_groups(&tasks);
        assert_eq!(groups.len(), 3);
        assert_eq!(groups[0], vec!["T1"]);
        assert_eq!(groups[1], vec!["T2"]);
        assert_eq!(groups[2], vec!["T3"]);
    }

    #[test]
    fn test_parallel_groups() {
        let scheduler = Scheduler::new();
        let tasks = vec![
            make_task("T1", &[]),
            make_task("T2", &[]),
            make_task("T3", &["T1", "T2"]),
        ];

        let groups = scheduler.compute_parallel_groups(&tasks);
        assert_eq!(groups.len(), 2);
        // Group 0: T1 and T2 (no dependencies)
        assert!(groups[0].contains(&"T1".to_string()));
        assert!(groups[0].contains(&"T2".to_string()));
        // Group 1: T3 (depends on T1 and T2)
        assert_eq!(groups[1], vec!["T3"]);
    }

    #[test]
    fn test_validate_no_cycles() {
        let scheduler = Scheduler::new();
        let tasks = vec![
            make_task("T1", &[]),
            make_task("T2", &["T1"]),
        ];
        assert!(scheduler.validate(&tasks).is_ok());
    }

    #[test]
    fn test_validate_detects_cycle() {
        let scheduler = Scheduler::new();
        let tasks = vec![
            make_task("T1", &["T2"]),
            make_task("T2", &["T1"]),
        ];
        assert!(scheduler.validate(&tasks).is_err());
    }

    #[test]
    fn test_validate_missing_dependency() {
        let scheduler = Scheduler::new();
        let tasks = vec![
            make_task("T1", &["NONEXISTENT"]),
        ];
        assert!(scheduler.validate(&tasks).is_err());
    }
}
