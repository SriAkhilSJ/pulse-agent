"""
Pulse Agent — Tool Approval Gates.

Approval system for IDE file operations. Prevents accidental/destructive writes
by requiring user confirmation before modifying files outside safe zones.

Design:
- ApprovalGate: per-operation approval request with timeout
- ApprovalPolicy: configurable rules (always allow, always deny, pattern-match)
- ApprovalManager: integrates with session DB for audit trail
- Structured JSON events emitted to webview for dialog rendering

Safety contract:
- ALL write operations go through check_approval() BEFORE executing
- Denied operations return a clear error to the agent, not silent failure
- Audit log persists all approval outcomes
"""

from __future__ import annotations

import fnmatch
import json
import logging
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Optional

logger = logging.getLogger(__name__)


# ═══════════════════════════════════════════════════════════════════════════════
# Enums & Constants
# ═══════════════════════════════════════════════════════════════════════════════

class ApprovalDecision(Enum):
    """Outcome of an approval check."""
    APPROVED = "approved"
    DENIED = "denied"
    NEEDS_INPUT = "needs_input"
    TIMEOUT = "timeout"
    ERROR = "error"


class ApprovalAction(Enum):
    """Type of action requiring approval."""
    FILE_WRITE = "file_write"
    FILE_DELETE = "file_delete"
    FILE_MODIFY = "file_modify"
    COMMAND_RUN = "command_run"
    BULK_OPERATION = "bulk_operation"
    UNKNOWN = "unknown"


# Default timeout for pending approvals (seconds)
_DEFAULT_APPROVAL_TIMEOUT = 120.0

# Paths that are ALWAYS denied (safety-critical)
_DENY_LIST_GLOBS = [
    "**/node_modules/**",
    "**/.git/**",
    "**/__pycache__/**",
    "**/.venv/**",
    "**/venv/**",
    "**/target/**",
    "**/.next/**",
    "**/dist/**",
    "**/build/**",
]

# Paths that are ALWAYS auto-approved (safe operations)
_AUTO_APPROVE_GLOBS = [
    "**/*.md",
    "**/*.txt",
    "**/*.json",
    "**/*.yaml",
    "**/*.yml",
    "**/*.toml",
    "**/*.env.example",
    "**/*.gitignore",
    "**/*.editorconfig",
]

# Extension patterns that trigger approval (dangerous writes)
_DANGEROUS_EXTENSIONS = {
    ".exe", ".dll", ".so", ".dylib", ".bin",
    ".pdb", ".o", ".obj", ".lib", ".a",
    ".pyc", ".pyo", ".pyd",
    ".key", ".pem", ".crt", ".cer", ".p12", ".pfx",
    ".env", ".env.local", ".env.production",
}


# ═══════════════════════════════════════════════════════════════════════════════
# Data classes
# ═══════════════════════════════════════════════════════════════════════════════

@dataclass
class ApprovalRequest:
    """A pending approval request."""
    id: str
    action: ApprovalAction
    path: str
    description: str
    content_preview: str = ""
    old_content_preview: str = ""
    mode: str = "write"  # write, delete, modify
    created_at: float = field(default_factory=time.time)
    timeout: float = _DEFAULT_APPROVAL_TIMEOUT
    decision: ApprovalDecision | None = None
    decided_at: float | None = None
    decided_by: str | None = None  # "user", "policy", "timeout"

    @property
    def is_expired(self) -> bool:
        return time.time() > (self.created_at + self.timeout)

    @property
    def is_decided(self) -> bool:
        return self.decision is not None


@dataclass
class ApprovalPolicy:
    """Configurable approval rules.

    ``allow_globs``: Glob patterns that bypass approval (auto-approved).
    ``deny_globs``: Glob patterns that are always denied.
    ``require_approval_globs``: Glob patterns that always require user approval.
    ``require_approval_extensions``: File extensions that always require approval.
    ``max_file_size_bytes``: Files larger than this require approval.
    ``auto_approve_threshold``: Allow N auto-approvals before requiring confirmation.
    """
    allow_globs: tuple[str, ...] = tuple(_AUTO_APPROVE_GLOBS)
    deny_globs: tuple[str, ...] = tuple(_DENY_LIST_GLOBS)
    require_approval_globs: tuple[str, ...] = ()
    require_approval_extensions: frozenset[str] = frozenset(_DANGEROUS_EXTENSIONS)
    max_file_size_bytes: int = 0  # 0 = no limit
    auto_approve_threshold: int = 20  # auto-approve up to 20 writes per session


# ═══════════════════════════════════════════════════════════════════════════════
# ApprovalManager
# ═══════════════════════════════════════════════════════════════════════════════

class ApprovalManager:
    """Manages approval lifecycle for IDE operations.

    Usage::

        mgr = ApprovalManager()
        decision = mgr.check_approval(
            path="/project/src/main.py",
            content="print('hello')",
            mode="write",
        )
        if decision == ApprovalDecision.APPROVED:
            # proceed with write
            pass
    """

    def __init__(
        self,
        policy: ApprovalPolicy | None = None,
        emit_callback: Callable | None = None,
        session_db: Any | None = None,
    ):
        self.policy = policy or ApprovalPolicy()
        self.emit_callback = emit_callback
        self.session_db = session_db
        self._pending_requests: dict[str, ApprovalRequest] = {}
        self._lock = threading.Lock()
        self._auto_approve_count = 0

    # ── Main entry point ────────────────────────────────────────────────────

    def check_approval(
        self,
        path: str,
        content: str = "",
        old_content: str = "",
        mode: str = "write",
        description: str = "",
        timeout: float = _DEFAULT_APPROVAL_TIMEOUT,
    ) -> ApprovalDecision:
        """Check whether an operation is approved, denied, or needs user input.

        Resolution order:
        1. If path matches a deny glob → DENIED immediately
        2. If path matches an auto-approve glob → APPROVED immediately
        3. If path matches require-approval → create pending request
        4. If path extension is dangerous → create pending request
        5. If large file → create pending request
        6. Otherwise → APPROVED (safe default)

        Returns:
            ApprovalDecision enum value.
        """
        path_obj = Path(path)
        action = self._classify_action(path, mode)
        desc = description or f"{mode} {path_obj.name}"

        # 1. Deny list check
        if self._matches_glob(path, self.policy.deny_globs):
            self._log_decision(path, ApprovalDecision.DENIED, "deny_glob")
            self._emit_approval_event("denied", path, "Denied by policy (protected path)")
            return ApprovalDecision.DENIED

        # 2. Auto-approve globs
        if self._matches_glob(path, self.policy.allow_globs):
            self._auto_approve_count += 1
            self._log_decision(path, ApprovalDecision.APPROVED, "auto_approve_glob")
            return ApprovalDecision.APPROVED

        # 3. Check auto-approve threshold
        if self._auto_approve_count < self.policy.auto_approve_threshold:
            self._auto_approve_count += 1
            self._log_decision(path, ApprovalDecision.APPROVED, "auto_approve_threshold")
            return ApprovalDecision.APPROVED

        # 4. Require-approval globs
        if self._matches_glob(path, self.policy.require_approval_globs):
            return self._create_pending(path, action, desc, content, old_content, mode, timeout)

        # 5. Dangerous extension check (check suffix AND full filename for dotfiles)
        ext = path_obj.suffix.lower()
        fname = path_obj.name.lower()
        if ext in self.policy.require_approval_extensions or fname in self.policy.require_approval_extensions:
            return self._create_pending(path, action, desc, content, old_content, mode, timeout)

        # 6. Large file check
        if self.policy.max_file_size_bytes > 0 and path_obj.exists():
            try:
                if path_obj.stat().st_size > self.policy.max_file_size_bytes:
                    return self._create_pending(path, action, desc, content, old_content, mode, timeout)
            except OSError:
                pass

        # 7. Default: approve (safe operations)
        self._auto_approve_count += 1
        self._log_decision(path, ApprovalDecision.APPROVED, "default_approve")
        return ApprovalDecision.APPROVED

    # ── Pending request management ──────────────────────────────────────────

    def create_pending_request(
        self,
        path: str,
        action: ApprovalAction = ApprovalAction.FILE_WRITE,
        description: str = "File modification",
        content_preview: str = "",
        old_content_preview: str = "",
        mode: str = "write",
        timeout: float = _DEFAULT_APPROVAL_TIMEOUT,
    ) -> ApprovalRequest:
        """Create a pending approval request and emit to webview.

        Returns the ApprovalRequest. Call ``resolve_request()`` when user responds.
        """
        req_id = f"approval_{uuid.uuid4().hex[:12]}"

        request = ApprovalRequest(
            id=req_id,
            action=action,
            path=path,
            description=description,
            content_preview=content_preview,
            old_content_preview=old_content_preview,
            mode=mode,
            timeout=timeout,
        )

        with self._lock:
            self._pending_requests[req_id] = request

        self._emit_approval_event("pending", path, description, {
            "request_id": req_id,
            "action": action.value,
            "mode": mode,
            "content_preview": content_preview[:200],
            "timeout": timeout,
        })

        return request

    def resolve_request(
        self,
        request_id: str,
        decision: ApprovalDecision,
        decided_by: str = "user",
    ) -> ApprovalRequest | None:
        """Resolve a pending approval request.

        Returns the resolved ApprovalRequest, or None if not found.
        """
        with self._lock:
            request = self._pending_requests.pop(request_id, None)

        if request is None:
            logger.warning("Approval request %s not found or already resolved", request_id)
            return None

        request.decision = decision
        request.decided_at = time.time()
        request.decided_by = decided_by

        self._log_decision(request.path, decision, decided_by)
        self._emit_approval_event(
            decision.value, request.path, request.description,
            {"request_id": request_id, "decided_by": decided_by},
        )

        return request

    def get_pending_request(self, request_id: str) -> ApprovalRequest | None:
        """Get a pending request without resolving it."""
        with self._lock:
            return self._pending_requests.get(request_id)

    def list_pending_requests(self) -> list[ApprovalRequest]:
        """List all currently pending approval requests."""
        with self._lock:
            return list(self._pending_requests.values())

    def expire_old_requests(self) -> int:
        """Expire all requests past their timeout.

        Returns the number of expired requests.
        """
        now = time.time()
        expired_ids = []
        with self._lock:
            for req_id, req in self._pending_requests.items():
                if req.is_expired:
                    expired_ids.append(req_id)

            for req_id in expired_ids:
                req = self._pending_requests.pop(req_id)
                req.decision = ApprovalDecision.TIMEOUT
                req.decided_at = now
                req.decided_by = "timeout"

        for req_id in expired_ids:
            logger.info("Approval request %s expired", req_id)

        return len(expired_ids)

    # ── Helpers ─────────────────────────────────────────────────────────────

    def _create_pending(
        self,
        path: str,
        action: ApprovalAction,
        description: str,
        content: str,
        old_content: str,
        mode: str,
        timeout: float,
    ) -> ApprovalDecision:
        req = self.create_pending_request(
            path=path,
            action=action,
            description=description,
            content_preview=content[:200] if content else "",
            old_content_preview=old_content[:200] if old_content else "",
            mode=mode,
            timeout=timeout,
        )
        # Return NEEDS_INPUT — caller must wait for resolution
        return ApprovalDecision.NEEDS_INPUT

    def _classify_action(self, path: str, mode: str) -> ApprovalAction:
        if mode == "delete":
            return ApprovalAction.FILE_DELETE
        if mode == "write":
            return ApprovalAction.FILE_WRITE
        if mode in ("modify", "patch", "replace"):
            return ApprovalAction.FILE_MODIFY
        if mode == "command":
            return ApprovalAction.COMMAND_RUN
        return ApprovalAction.UNKNOWN

    def _matches_glob(self, path: str, globs: tuple[str, ...]) -> bool:
        """Check if path matches any glob pattern."""
        path_str = path.replace("\\", "/")
        for pattern in globs:
            normalized_pattern = pattern.replace("\\", "/")
            if fnmatch.fnmatch(path_str, normalized_pattern):
                return True
        return False

    def _log_decision(self, path: str, decision: ApprovalDecision, reason: str) -> None:
        """Log approval decision and optionally persist to session DB."""
        logger.info("Approval: %s → %s (%s)", path, decision.value, reason)
        if self.session_db is not None:
            try:
                self.session_db.save_messages(
                    session_id="_approval_audit",
                    messages=[{
                        "role": "tool",
                        "content": json.dumps({
                            "type": "approval",
                            "path": path,
                            "decision": decision.value,
                            "reason": reason,
                            "timestamp": time.time(),
                        }),
                    }],
                )
            except Exception as e:
                logger.debug("Failed to log approval to session DB: %s", e)

    def _emit_approval_event(
        self,
        event_type: str,
        path: str,
        description: str,
        extra: dict | None = None,
    ) -> None:
        """Emit structured JSON to webview via callback."""
        if self.emit_callback is None:
            return
        try:
            event = {
                "type": "approval",
                "event": event_type,
                "path": path,
                "description": description,
            }
            if extra:
                event.update(extra)
            self.emit_callback("approval", event_type, event)
        except Exception as e:
            logger.debug("Approval emit failed: %s", e)


# ═══════════════════════════════════════════════════════════════════════════════
# Integration helpers
# ═══════════════════════════════════════════════════════════════════════════════

def with_approval(approval_mgr: ApprovalManager):
    """Decorator factory: wraps a tool function to check approval before executing.

    Usage::

        @with_approval(mgr)
        def apply_edit(path: str, content: str, ...):
            # only runs if approved
            ...

    The wrapped function returns an error dict if denied, or proceeds if approved.
    """
    def decorator(func):
        def wrapper(path: str, content: str = "", **kwargs):
            mode = kwargs.get("mode", "write")
            decision = approval_mgr.check_approval(
                path=path,
                content=content,
                mode=mode,
            )
            if decision == ApprovalDecision.DENIED:
                return json.dumps({"error": f"Operation denied by approval policy: {path}"})
            if decision == ApprovalDecision.NEEDS_INPUT:
                return json.dumps({
                    "error": "Operation requires user approval",
                    "approval_required": True,
                    "path": path,
                    "mode": mode,
                })
            return func(path=path, content=content, **kwargs)
        return wrapper
    return decorator
