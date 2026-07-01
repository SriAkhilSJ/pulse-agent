"""Pulse Agent — Error type hierarchy for structured error handling across the agent pipeline."""

from __future__ import annotations


class PulseError(Exception):
    """Base for all Pulse-specific errors."""


class LLMError(PulseError):
    """LLM API call failed (network, auth, rate-limit, content-policy)."""


class LLMTimeoutError(LLMError):
    """LLM call timed out."""


class LLMAuthError(LLMError):
    """LLM call failed due to auth (401/403)."""


class LLMRateLimitError(LLMError):
    """LLM call rate-limited (429)."""


class LLMBillingError(LLMError):
    """LLM call blocked by billing (402/insufficient credits)."""


class LLMContentPolicyError(LLMError):
    """LLM call blocked by content policy / safety filter."""


class LLMContextOverflowError(LLMError):
    """LLM call rejected due to context length overflow."""


class LLMModelNotFoundError(LLMError):
    """LLM model identifier not found / invalid."""


class LLMFormatError(LLMError):
    """LLM rejected the request format (400 bad request)."""


class ToolError(PulseError):
    """Tool execution failed."""


class ToolNotFoundError(ToolError):
    """Requested tool is not registered."""


class ToolExecutionError(ToolError):
    """Tool raised an exception during execution."""


class ToolGuardrailBlocked(PulseError):
    """Tool call blocked by a guardrail policy."""


class ConfigError(PulseError):
    """Invalid or missing configuration."""


class ModelNotFoundError(ConfigError):
    """Model identifier is not in the registry."""


class ProviderNotFoundError(ConfigError):
    """Provider identifier is not configured."""


class PipelineError(PulseError):
    """Pipeline execution error."""


__all__ = [
    "PulseError",
    "LLMError",
    "LLMTimeoutError",
    "LLMAuthError",
    "LLMRateLimitError",
    "LLMBillingError",
    "LLMContentPolicyError",
    "LLMContextOverflowError",
    "LLMModelNotFoundError",
    "LLMFormatError",
    "ToolError",
    "ToolNotFoundError",
    "ToolExecutionError",
    "ToolGuardrailBlocked",
    "ConfigError",
    "ModelNotFoundError",
    "ProviderNotFoundError",
    "PipelineError",
]
