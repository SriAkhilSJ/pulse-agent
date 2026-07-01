"""API error classification — structured taxonomy for smart retry and fallback.

Provides a priority-ordered classification pipeline that maps exceptions and
HTTP responses to recovery actions: retry, compress, fallback provider, or abort.
"""

from __future__ import annotations

import enum
import logging
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


class FailoverReason(enum.Enum):
    """Why an API call failed — determines recovery strategy."""
    auth = "auth"
    auth_permanent = "auth_permanent"
    billing = "billing"
    rate_limit = "rate_limit"
    overloaded = "overloaded"
    server_error = "server_error"
    timeout = "timeout"
    context_overflow = "context_overflow"
    payload_too_large = "payload_too_large"
    model_not_found = "model_not_found"
    content_policy_blocked = "content_policy_blocked"
    format_error = "format_error"
    unknown = "unknown"


@dataclass
class ClassifiedError:
    """Structured classification with recovery hints."""
    reason: FailoverReason
    status_code: Optional[int] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    message: str = ""
    retryable: bool = True
    should_compress: bool = False
    should_fallback: bool = False


# ── Pattern sets ──────────────────────────────────────────────────────

_BILLING_PATTERNS = [
    "insufficient credits", "insufficient_quota", "insufficient balance",
    "credit balance", "credits exhausted", "payment required",
    "exceeded your current quota", "out of funds", "balance_depleted",
]

_RATE_LIMIT_PATTERNS = [
    "rate limit", "rate_limit", "too many requests", "throttled",
    "try again in", "please retry after", "resource_exhausted",
]

_CONTEXT_OVERFLOW_PATTERNS = [
    "context length", "context size", "maximum context", "token limit",
    "too many tokens", "context window", "prompt is too long",
    "exceeds the limit", "reduce the length",
]

_MODEL_NOT_FOUND_PATTERNS = [
    "model not found", "model_not_found", "invalid model",
    "does not exist", "unknown model",
]

_AUTH_PATTERNS = [
    "invalid api key", "authentication", "unauthorized", "forbidden",
    "invalid token", "token expired", "access denied",
]

_CONTENT_POLICY_PATTERNS = [
    "violates our usage policies", "flagged by our safety",
    "content_filter", "prompt was flagged",
]

_TIMEOUT_PATTERNS = [
    "timed out", "timeout", "deadline exceeded", "operation timed out",
]

_SERVER_ERROR_PATTERNS = [
    "internal server error", "service unavailable", "bad gateway",
]

_PAYLOAD_LARGE_PATTERNS = [
    "request entity too large", "payload too large", "error code: 413",
]


def _extract_status_code(error: Exception) -> Optional[int]:
    """Extract HTTP status from exception if available."""
    for attr in ("status_code", "status", "code"):
        val = getattr(error, attr, None)
        if isinstance(val, int):
            return val
    return None


def _extract_error_body(error: Exception) -> str:
    """Extract the best error message string from an exception."""
    msg = str(error)
    # Try to unwrap httpx response body
    if hasattr(error, "response") and hasattr(error.response, "text"):
        body = error.response.text
        if body and body != msg:
            return body
    return msg


def classify_api_error(
    error: Exception,
    *,
    provider: str = "",
    model: str = "",
    approx_tokens: int = 0,
    context_length: int = 200_000,
) -> ClassifiedError:
    """Classify an API error into a structured recovery recommendation.

    Priority pipeline:
      1. HTTP status code classification
      2. Error message pattern matching
      3. Transport/timeout heuristics
      4. Fallback: unknown (retryable with backoff)
    """
    status_code = _extract_status_code(error)
    body = _extract_error_body(error)
    body_lower = body.lower()

    def _match(patterns: list[str]) -> bool:
        return any(p in body_lower for p in patterns)

    # ── Status-code-first classification ────────────────────────────
    if status_code == 401:
        return ClassifiedError(
            reason=FailoverReason.auth, status_code=401,
            provider=provider, model=model, message=body[:200],
            retryable=False,
        )
    if status_code == 403:
        return ClassifiedError(
            reason=FailoverReason.auth, status_code=403,
            provider=provider, model=model, message=body[:200],
            retryable=False,
        )
    if status_code == 402:
        return ClassifiedError(
            reason=FailoverReason.billing, status_code=402,
            provider=provider, model=model, message=body[:200],
            retryable=False, should_fallback=True,
        )
    if status_code == 429:
        reason = FailoverReason.rate_limit
        if _match(_BILLING_PATTERNS):
            reason = FailoverReason.billing
        return ClassifiedError(
            reason=reason, status_code=429,
            provider=provider, model=model, message=body[:200],
            retryable=True, should_fallback=False,
        )
    if status_code == 413:
        return ClassifiedError(
            reason=FailoverReason.payload_too_large, status_code=413,
            provider=provider, model=model, message=body[:200],
            retryable=False, should_compress=True,
        )
    if status_code == 404 and _match(_MODEL_NOT_FOUND_PATTERNS):
        return ClassifiedError(
            reason=FailoverReason.model_not_found, status_code=404,
            provider=provider, model=model, message=body[:200],
            retryable=False, should_fallback=True,
        )
    if status_code == 400:
        if _match(_CONTEXT_OVERFLOW_PATTERNS):
            return ClassifiedError(
                reason=FailoverReason.context_overflow, status_code=400,
                provider=provider, model=model, message=body[:200],
                retryable=True, should_compress=True,
            )
        if _match(_CONTENT_POLICY_PATTERNS):
            return ClassifiedError(
                reason=FailoverReason.content_policy_blocked, status_code=400,
                provider=provider, model=model, message=body[:200],
                retryable=False, should_fallback=True,
            )
        return ClassifiedError(
            reason=FailoverReason.format_error, status_code=400,
            provider=provider, model=model, message=body[:200],
            retryable=False,
        )
    if status_code in (502, 503, 504):
        return ClassifiedError(
            reason=FailoverReason.overloaded if status_code in (503, 504)
            else FailoverReason.server_error,
            status_code=status_code,
            provider=provider, model=model, message=body[:200],
            retryable=True,
        )
    if status_code and status_code >= 500:
        return ClassifiedError(
            reason=FailoverReason.server_error, status_code=status_code,
            provider=provider, model=model, message=body[:200],
            retryable=True,
        )

    # ── No status code — pattern match on message ───────────────────
    if _match(_TIMEOUT_PATTERNS):
        return ClassifiedError(
            reason=FailoverReason.timeout,
            provider=provider, model=model, message=body[:200],
            retryable=True,
        )
    if _match(_BILLING_PATTERNS):
        return ClassifiedError(
            reason=FailoverReason.billing,
            provider=provider, model=model, message=body[:200],
            retryable=False, should_fallback=True,
        )
    if _match(_RATE_LIMIT_PATTERNS):
        return ClassifiedError(
            reason=FailoverReason.rate_limit,
            provider=provider, model=model, message=body[:200],
            retryable=True,
        )
    if _match(_CONTEXT_OVERFLOW_PATTERNS):
        return ClassifiedError(
            reason=FailoverReason.context_overflow,
            provider=provider, model=model, message=body[:200],
            retryable=True, should_compress=True,
        )
    if _match(_AUTH_PATTERNS):
        return ClassifiedError(
            reason=FailoverReason.auth,
            provider=provider, model=model, message=body[:200],
            retryable=False,
        )
    if _match(_CONTENT_POLICY_PATTERNS):
        return ClassifiedError(
            reason=FailoverReason.content_policy_blocked,
            provider=provider, model=model, message=body[:200],
            retryable=False, should_fallback=True,
        )
    if _match(_SERVER_ERROR_PATTERNS):
        return ClassifiedError(
            reason=FailoverReason.server_error,
            provider=provider, model=model, message=body[:200],
            retryable=True,
        )

    # ── Transport-level heuristics ──────────────────────────────────
    type_name = type(error).__name__
    if type_name in frozenset({
        "ReadTimeout", "ConnectTimeout", "ConnectError",
        "ConnectionError", "TimeoutError", "RemoteProtocolError",
    }):
        return ClassifiedError(
            reason=FailoverReason.timeout,
            provider=provider, model=model, message=str(error)[:200],
            retryable=True,
        )

    # ── Fallback ────────────────────────────────────────────────────
    return ClassifiedError(
        reason=FailoverReason.unknown,
        provider=provider, model=model, message=str(error)[:200],
        retryable=True,
    )
