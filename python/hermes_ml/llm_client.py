"""LLM Router — calls OpenAI-compatible APIs via raw HTTP.

Supports: Groq, OpenRouter, OpenAI, local (Ollama).
Reads API keys from environment variables.
"""

from __future__ import annotations

import json
import logging
import os
import time
from typing import Any, Optional

import httpx

# Load .env file if present
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

logger = logging.getLogger(__name__)

# ── Provider Endpoints ────────────────────────────────────────────────

PROVIDERS: dict[str, dict[str, Any]] = {
    "groq": {
        "base_url": "https://api.groq.com/openai/v1",
        "env_key": "GROQ_API_KEY",
    },
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1",
        "env_key": "OPENROUTER_API_KEY",
        "extra_headers": {
            "HTTP-Referer": "https://surpassing.dev",
            "X-Title": "Surpassing IDE Agent",
        },
    },
    "openai": {
        "base_url": "https://api.openai.com/v1",
        "env_key": "OPENAI_API_KEY",
    },
    "local": {
        "base_url": "http://localhost:11434/v1",
        "env_key": "LOCAL_API_KEY",
    },
}

# Per-provider env var for model override.
# Provider-specific env var takes priority over the global SURPASSING_MODEL,
# so you can set SURPASSING_PROVIDER=openrouter + GROQ_MODEL=xxx without
# breaking the other provider.
PROVIDER_MODEL_ENV: dict[str, str] = {
    "groq": "GROQ_MODEL",
    "openrouter": "OPENROUTER_MODEL",
    "openai": "OPENAI_MODEL",
    "local": "LOCAL_MODEL",
}


class LLMError(Exception):
    """Wraps HTTP/API errors from the LLM client."""

    def __init__(self, message: str, status_code: int = 0, retryable: bool = False):
        super().__init__(message)
        self.status_code = status_code
        self.retryable = retryable


class LLMClient:
    """Raw HTTP Chat Completions client. No SDK dependency.

    Usage:
        client = LLMClient(provider="groq")
        response = client.chat(messages=[{"role": "user", "content": "hello"}])
    """

    def __init__(
        self,
        provider: Optional[str] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        model: Optional[str] = None,
        timeout: float = 60.0,
    ):
        self.provider = provider or os.environ.get("SURPASSING_PROVIDER", "groq")
        self.timeout = timeout

        pconfig = PROVIDERS.get(self.provider, {})

        self.base_url = (
            base_url
            or os.environ.get("SURPASSING_BASE_URL")
            or pconfig.get("base_url", "https://api.groq.com/openai/v1")
        ).rstrip("/")

        self.api_key = api_key or os.environ.get(pconfig.get("env_key", ""), "")
        if not self.api_key:
            raise ValueError(
                f"No API key for provider '{self.provider}'. "
                f"Set {pconfig.get('env_key', 'API_KEY')} env var or pass api_key=."
            )

        self.model = (
            model
            or os.environ.get(PROVIDER_MODEL_ENV.get(self.provider, ""), "")
            or os.environ.get("SURPASSING_MODEL")
        )
        if not self.model:
            raise ValueError(
                f"No model for provider '{self.provider}'. "
                f"Set {PROVIDER_MODEL_ENV.get(self.provider, 'MODEL')} or SURPASSING_MODEL env var."
            )

        self._extra_headers: dict[str, str] = pconfig.get("extra_headers", {})

    def chat(
        self,
        messages: list[dict[str, Any]],
        tools: Optional[list[dict[str, Any]]] = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
    ) -> dict[str, Any]:
        """Call Chat Completions. Returns parsed JSON response dict."""
        payload: dict[str, Any] = {
            "model": self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools

        headers = {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
            **self._extra_headers,
        }

        url = f"{self.base_url}/chat/completions"

        try:
            resp = self._post(url, headers, payload)
        except httpx.TimeoutException:
            raise LLMError("Request timed out", status_code=408)
        except httpx.ConnectError:
            raise LLMError(f"Cannot reach {self.base_url}", status_code=502)

        if resp.status_code == 401:
            raise LLMError("Invalid API key", status_code=401)
        if resp.status_code == 429:
            raise LLMError("Rate limited", status_code=429, retryable=True)
        if resp.status_code >= 500:
            raise LLMError(f"Server error: {resp.status_code}", status_code=resp.status_code, retryable=True)
        if resp.status_code != 200:
            raise LLMError(f"API error {resp.status_code}: {resp.text[:300]}", status_code=resp.status_code)

        return resp.json()

    def chat_with_retries(
        self,
        messages: list[dict[str, Any]],
        tools: Optional[list[dict[str, Any]]] = None,
        max_tokens: int = 4096,
        temperature: float = 0.7,
        max_retries: int = 3,
    ) -> dict[str, Any]:
        """chat() with automatic retry on transient errors."""
        backoff = 2.0
        last_error: Optional[LLMError] = None

        for attempt in range(max_retries):
            try:
                return self.chat(messages=messages, tools=tools, max_tokens=max_tokens, temperature=temperature)
            except LLMError as e:
                last_error = e
                if not e.retryable:
                    raise
                if attempt < max_retries - 1:
                    logger.warning("LLM retry %d/%d: %s", attempt + 1, max_retries, e)
                    time.sleep(backoff)
                    backoff = min(backoff * 2, 16.0)

        raise last_error or LLMError("Max retries exceeded")

    def _post(self, url: str, headers: dict, payload: dict) -> httpx.Response:
        with httpx.Client(timeout=self.timeout) as client:
            return client.post(url, headers=headers, json=payload)

    def __repr__(self) -> str:
        return f"LLMClient(provider={self.provider!r}, model={self.model!r})"


def parse_tool_calls(response: dict[str, Any]) -> list[dict[str, Any]]:
    """Extract tool calls from Chat Completions response."""
    try:
        choice = response["choices"][0]
        message = choice["message"]
    except (KeyError, IndexError):
        return []

    raw_calls = message.get("tool_calls")
    if not raw_calls:
        return []

    parsed = []
    for tc in raw_calls:
        func = tc.get("function", {})
        parsed.append({
            "id": tc.get("id", ""),
            "name": func.get("name", ""),
            "arguments": func.get("arguments", "{}"),
        })
    return parsed


def parse_assistant_content(response: dict[str, Any]) -> tuple[str, str]:
    """Extract assistant text content and finish_reason."""
    try:
        choice = response["choices"][0]
        message = choice["message"]
        content = message.get("content") or ""
        finish_reason = choice.get("finish_reason", "stop")
    except (KeyError, IndexError):
        return "", "stop"
    return content, finish_reason
