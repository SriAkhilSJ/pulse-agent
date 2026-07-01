#!/usr/bin/env python3
"""Run the full Planner + Coder pipeline for a given task.

Usage:
    python -m hermes_agents.run_pipeline --task "Add auth" --mode feature

Outputs JSON with the plan and code changes to stdout.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

# Load .env
try:
    from dotenv import load_dotenv
    # Load .env from project root (3 levels up from hermes_agents/run_pipeline.py)
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".env")
    load_dotenv(env_path, override=True)
except ImportError:
    pass

# Ensure python/ is on path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from hermes_agents.base import AgentConfig, AgentContext
from hermes_agents.planner import PlannerAgent
from hermes_agents.coder import CoderAgent
from hermes_agents.project_context import scan_project, read_file_for_context


async def run_pipeline(task: str, mode: str, current_file: str = "") -> dict:
    """Run Planner → Coder pipeline with full codebase context."""

    # Scan project to understand structure (like Hermes coding_context.py)
    project_root = os.environ.get("SURPASSING_WORKSPACE", os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    project_ctx = scan_project(project_root)

    # Read the prompt file if it exists (Slice-specific instructions)
    prompt_content = ""
    prompt_path = os.path.join(project_root, "prompts")
    if os.path.exists(prompt_path):
        # Find relevant prompt file based on keywords in task
        task_lower = task.lower()
        for fname in os.listdir(prompt_path):
            if fname.endswith(".md"):
                # Simple keyword matching
                kw = fname.replace(".md", "").replace("-", " ").lower()
                if any(w in task_lower for w in kw.split("_")[:3]):
                    p = os.path.join(prompt_path, fname)
                    with open(p) as f:
                        prompt_content = f.read(8000)
                    break

    # Build rich context for agents
    shared_context = {
        "task": task,
        "mode": mode,
        "current_file": current_file,
        "project_type": project_ctx.project_type,
        "project_name": project_ctx.name,
        "project_language": project_ctx.language,
        "project_modules": project_ctx.modules,
        "project_dependencies": project_ctx.dependencies,
        "project_architecture": project_ctx.architecture,
        "project_patterns": project_ctx.patterns,
        "project_context_summary": project_ctx.to_prompt_context(),
        "prompt_file_content": prompt_content,
    }

    # Phase 1: Planner (with full context)
    planner_config = AgentConfig(agent_id="planner-1", agent_type="planner")
    planner = PlannerAgent(planner_config)
    planner_ctx = AgentContext(
        task_id="task-pipeline",
        conversation_id="conv-pipeline",
        code_context=shared_context,
        memory_context={},
    )
    print(json.dumps({"status": "planning", "message": "Analyzing task and creating plan..."}), flush=True)
    planner_result = await planner.execute(planner_ctx)

    if not planner_result.success:
        return {
            "success": False,
            "phase": "planner",
            "error": planner_result.output,
        }

    plan = json.loads(planner_result.output)

    # Phase 2: Coder (with full context + existing file content)
    coder_config = AgentConfig(agent_id="coder-1", agent_type="coder")
    coder = CoderAgent(coder_config)

    # Read existing file content so the Coder knows what's already there
    existing_content = ""
    if current_file:
        existing_content = read_file_for_context(current_file, max_chars=4000)
    # Also read related files from the same crate
    crate_files = {}
    if current_file and "crates/" in current_file:
        crate_dir = current_file.split("/src/")[0] + "/src"
        if os.path.exists(crate_dir):
            for fname in os.listdir(crate_dir):
                if fname.endswith(".rs") and fname != os.path.basename(current_file):
                    fpath = os.path.join(crate_dir, fname)
                    with open(fpath) as f:
                        crate_files[fname] = f.read(2000)

    coder_shared = dict(shared_context)
    coder_shared.update({
        "target_file": current_file or "src/main.rs",
        "file_content": existing_content,
        "crate_files": crate_files,
        "plan_subtasks": plan.get("subtasks", []),
    })
    coder_ctx = AgentContext(
        task_id="task-pipeline",
        conversation_id="conv-pipeline",
        code_context=coder_shared,
        memory_context={},
    )
    print(json.dumps({"status": "coding", "message": f"Generating code with {len(plan.get('subtasks', []))} subtasks..."}), flush=True)
    coder_result = await coder.execute(coder_ctx)

    if not coder_result.success:
        return {
            "success": False,
            "phase": "coder",
            "error": coder_result.output,
            "plan": plan,
        }

    # Combine results
    code_changes = coder_result.artifacts[0].get("data", [])

    return {
        "success": True,
        "plan": plan,
        "code_changes": code_changes,
        "confidence": coder_result.confidence,
        "explanation": f"Planner created {len(plan.get('subtasks', []))} subtasks, Coder generated {len(code_changes)} code changes",
    }


def main():
    parser = argparse.ArgumentParser(description="Run Planner + Coder pipeline")
    parser.add_argument("--task", required=True, help="Task description")
    parser.add_argument("--mode", default="feature", help="Task mode")
    parser.add_argument("--file", default="", help="Current file path")
    args = parser.parse_args()

    # Stream progress to stdout for IDE integration
    print(json.dumps({"status": "starting", "task": args.task}), flush=True)

    result = asyncio.run(run_pipeline(args.task, args.mode, args.file))
    print(json.dumps(result, indent=2), flush=True)


if __name__ == "__main__":
    main()
