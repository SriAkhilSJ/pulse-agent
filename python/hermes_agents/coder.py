"""Coder agent — generates implementation code.

Modes:
- feature: Implement new functionality
- bugfix: Fix existing code
- refactor: Restructure without changing behavior
- docs: Add documentation
- migrate: Technology migration

Principles:
- Works in TDD mode when possible (tests first)
- Generates diff patches, not full rewrites
- Respects existing code style from developer profile
- Always adds error handling
"""

from __future__ import annotations

import json
import logging
import re
import structlog
import sys
from enum import Enum
from typing import Any, Optional

structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(logging.WARNING),
    logger_factory=structlog.PrintLoggerFactory(file=sys.stderr),
)
from pydantic import BaseModel, Field

from hermes_agents.base import AgentConfig, AgentContext, AgentResult, BaseAgent

logger = structlog.get_logger()


class CodeMode(str, Enum):
    FEATURE = "feature"
    BUGFIX = "bugfix"
    REFACTOR = "refactor"
    DOCS = "docs"
    MIGRATE = "migrate"


class CodeChange(BaseModel):
    """A single code change (diff)."""
    file_path: str
    original: Optional[str]  # None for new files
    modified: str
    explanation: str
    start_line: Optional[int] = None
    end_line: Optional[int] = None


class CoderAgent(BaseAgent):
    """Coder — generates implementation code using real LLM."""

    def __init__(self, config: AgentConfig) -> None:
        super().__init__(config)
        self._llm = None

    @property
    def llm(self):
        """Lazy-init LLM client."""
        if self._llm is None:
            from hermes_ml.llm_client import LLMClient
            self._llm = LLMClient()
        return self._llm

    async def execute(self, context: AgentContext) -> AgentResult:
        """Generate code based on the task."""
        mode = CodeMode(context.code_context.get("mode", "feature"))
        task = context.code_context.get("task", "")
        target_file = context.code_context.get("target_file")
        existing_code = context.code_context.get("file_content", "")
        plan_subtasks = context.code_context.get("plan_subtasks", [])

        self.logger.info("coder_start", mode=mode.value, task=task[:100])

        # Generate code based on mode
        changes = await self._generate(mode, task, existing_code, plan_subtasks, context)

        # Security pre-check (lightweight, local)
        changes = self._security_prescan(changes)

        return AgentResult(
            agent_id=self.config.agent_id,
            task_id=context.task_id,
            success=True,
            output=self._format_output(changes),
            artifacts=[{"type": "code_changes", "data": [c.model_dump() for c in changes]}],
            confidence=self._calculate_confidence(changes),
        )

    async def _generate(
        self,
        mode: CodeMode,
        task: str,
        existing_code: str,
        plan_subtasks: list[dict],
        context: AgentContext,
    ) -> list[CodeChange]:
        """Generate code changes based on mode."""

        generators = {
            CodeMode.FEATURE: self._generate_feature,
            CodeMode.BUGFIX: self._generate_bugfix,
            CodeMode.REFACTOR: self._generate_refactor,
            CodeMode.DOCS: self._generate_docs,
            CodeMode.MIGRATE: self._generate_migration,
        }

        generator = generators.get(mode, self._generate_feature)
        return await generator(task, existing_code, plan_subtasks, context)

    async def _call_llm_for_code(
        self,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int = 4096,
    ) -> str:
        """Call LLM and return text content."""
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        try:
            response = self.llm.chat_with_retries(
                messages=messages,
                max_tokens=max_tokens,
                temperature=0.2,
            )
            return response["choices"][0]["message"]["content"] or ""
        except Exception as e:
            self.logger.warning("coder_llm_failed", error=str(e)[:200])
            return ""

    async def _generate_feature(
        self, task: str, existing: str, plan_subtasks: list[dict], context: AgentContext
    ) -> list[CodeChange]:
        """Generate new feature implementation with full project context."""
        project_ctx = context.code_context.get("project_context_summary", "")
        prompt_content = context.code_context.get("prompt_file_content", "")
        crate_files = context.code_context.get("crate_files", {})

        crate_files_str = ""
        if crate_files:
            crate_files_str = "\n\nRELATED FILES IN THIS CRATE:\n"
            for fname, content in crate_files.items():
                crate_files_str += f"\n--- {fname} ---\n{content[:1000]}\n"

        prompt_section = ""
        if prompt_content:
            prompt_section = f"\n\nPROMPT FILE (what to build):\n{prompt_content[:5000]}\n"

        system_prompt = f"""You are the Coder agent in the Surpassing IDE Agent — a next-generation AI coding assistant.
Generate minimal, targeted RUST code changes for the given task.

PROJECT CONTEXT:
{project_ctx}

RUST STANDARDS (NON-NEGOTIABLE):
1. Use thiserror for error types, anyhow for application errors
2. Async with tokio, channels with tokio::sync::mpsc
3. Instrument every public function with #[tracing::instrument]
4. Use serde {{Serialize, Deserialize}} for data types
5. NEVER use unsafe — forbidden in this project
6. Add proper error handling — no unwrap() in production code
7. Use Arc<str> for frequently cloned strings
8. Follow existing patterns in the codebase
9. File paths MUST be crates/<crate-name>/src/<file>.rs

Output format — JSON array of code changes:
[
  {{
    "file_path": "crates/surpassing-sandbox/src/filename.rs",
    "original": "existing code to replace (or null for new files)",
    "modified": "new Rust code",
    "explanation": "why this change"
  }}
]

Output ONLY valid JSON. No markdown backticks, no explanation."""

        user_prompt = f"""Task: {task}

Existing code:
```rust
{existing[:3000]}
```{crate_files_str}{prompt_section}

Output JSON:"""

        content = await self._call_llm_for_code(system_prompt, user_prompt)
        return self._parse_changes(content, context.code_context.get("target_file"))

    async def _generate_bugfix(
        self, task: str, existing: str, plan_subtasks: list[dict], context: AgentContext
    ) -> list[CodeChange]:
        """Generate bug fix."""
        system_prompt = """You are the Coder agent fixing a bug.
Generate minimal, targeted changes that fix the bug.

Rules:
1. Make the smallest change that fixes the bug
2. Don't refactor unrelated code
3. Add a regression test if possible
4. Explain the root cause in the explanation field

Output ONLY valid JSON array of code changes."""

        user_prompt = f"""Bug: {task}

Code to fix:
```
{existing[:3000]}
```

Output JSON:"""

        content = await self._call_llm_for_code(system_prompt, user_prompt)
        return self._parse_changes(content, context.code_context.get("target_file"))

    async def _generate_refactor(
        self, task: str, existing: str, plan_subtasks: list[dict], context: AgentContext
    ) -> list[CodeChange]:
        """Generate refactoring changes."""
        system_prompt = """You are the Coder agent refactoring code.
Preserve behavior, improve structure only.

Rules:
1. Behavior must be identical (no functional changes)
2. Extract functions/classes where they improve clarity
3. Remove duplication
4. Improve naming

Output ONLY valid JSON array of code changes."""

        user_prompt = f"""Refactoring goal: {task}

Code to refactor:
```
{existing[:3000]}
```

Output JSON:"""

        content = await self._call_llm_for_code(system_prompt, user_prompt)
        return self._parse_changes(content, context.code_context.get("target_file"))

    async def _generate_docs(
        self, task: str, existing: str, plan_subtasks: list[dict], context: AgentContext
    ) -> list[CodeChange]:
        """Generate documentation."""
        system_prompt = """You are the Coder agent adding documentation.

Add:
1. Module-level docstring if missing
2. Function docstrings (params, returns, raises)
3. Inline comments for complex logic
4. Type hints where missing

Output ONLY valid JSON array of code changes."""

        user_prompt = f"""Documentation request: {task}

Code:
```
{existing[:3000]}
```

Output JSON:"""

        content = await self._call_llm_for_code(system_prompt, user_prompt, max_tokens=2048)
        return self._parse_changes(content, context.code_context.get("target_file"))

    async def _generate_migration(
        self, task: str, existing: str, plan_subtasks: list[dict], context: AgentContext
    ) -> list[CodeChange]:
        """Generate migration changes."""
        system_prompt = """You are the Coder agent migrating code to a new technology.

Rules:
1. Preserve all functionality
2. Update imports and dependencies
3. Follow best practices of the target technology
4. Flag any breaking changes

Output ONLY valid JSON array of code changes."""

        user_prompt = f"""Migration: {task}

Current code:
```
{existing[:3000]}
```

Output JSON:"""

        content = await self._call_llm_for_code(system_prompt, user_prompt)
        return self._parse_changes(content, context.code_context.get("target_file"))

    def _parse_changes(self, response: str, target_file: Optional[str]) -> list[CodeChange]:
        """Parse code changes from LLM response."""
        if not response.strip():
            return [CodeChange(
                file_path=target_file or "unknown",
                original=None,
                modified="// LLM did not return code changes",
                explanation="No response from LLM",
            )]

        # Try to extract JSON from response (handle markdown-wrapped JSON)
        # Strip markdown code fences if present
        cleaned = response.strip()
        cleaned = re.sub(r'^```(?:json)?\s*', '', cleaned)
        cleaned = re.sub(r'\s*```$', '', cleaned)

        json_match = re.search(r'\[.*\]', cleaned, re.DOTALL)
        if json_match:
            try:
                raw_changes = json.loads(json_match.group())
                normalized = []
                for c in raw_changes:
                    # Normalize LLM key variations
                    normalized.append(CodeChange(
                        file_path=c.get("file_path") or c.get("path", target_file or "unknown"),
                        original=c.get("original") or c.get("old") or None,
                        modified=c.get("modified") or c.get("new") or c.get("content"),
                        explanation=c.get("explanation", ""),
                    ))
                return normalized
            except (json.JSONDecodeError, TypeError) as e:
                self.logger.warning("json_parse_failed", error=str(e)[:100])
                pass

        # Fallback: wrap as single change
        return [CodeChange(
            file_path=target_file or "unknown",
            original=None,
            modified=response,
            explanation="Raw LLM output (JSON parse failed)",
        )]

    def _security_prescan(self, changes: list[CodeChange]) -> list[CodeChange]:
        """Lightweight security check before returning changes."""
        dangerous_patterns = [
            (r'eval\s*\(', "eval() usage detected"),
            (r'exec\s*\(', "exec() usage detected"),
            (r'subprocess\.call.*shell\s*=\s*True', "shell=True in subprocess"),
            (r'SELECT\s+.*\+.*FROM', "SQL string concatenation"),
            (r'innerHTML\s*=', "XSS risk: innerHTML"),
            (r'password\s*=\s*["\'][^"\']{4,}', "Possible hardcoded password"),
        ]

        for change in changes:
            for pattern, warning in dangerous_patterns:
                if re.search(pattern, change.modified, re.IGNORECASE):
                    change.explanation = f"[SECURITY WARNING: {warning}] {change.explanation}"
                    self.logger.warning("security_pattern_detected", pattern=pattern)

        return changes

    def _format_output(self, changes: list[CodeChange]) -> str:
        """Format changes for human review."""
        output = []
        for i, change in enumerate(changes, 1):
            output.append(f"### Change {i}: `{change.file_path}`")
            output.append(f"**Explanation:** {change.explanation}")
            if change.original:
                output.append(f"```diff\n- {change.original[:200]}\n+ {change.modified[:200]}\n```")
            else:
                output.append(f"```\n{change.modified[:300]}\n```")
        return "\n\n".join(output)

    def _calculate_confidence(self, changes: list[CodeChange]) -> float:
        """Calculate confidence score."""
        if not changes:
            return 0.0
        total_lines = sum(len(c.modified.split("\n")) for c in changes)
        if total_lines < 20:
            return 0.95
        elif total_lines < 100:
            return 0.85
        else:
            return 0.70

    async def health_check(self) -> bool:
        return True
