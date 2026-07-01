"""Shared LLM client — multi-provider httpx caller with retry & error propagation.

Supports two modes:
  - call_llm() — simple system+user chat (backward compat for pipeline.py direct_answer)
  - call_llm_messages() — full conversation with tools, tool_calls, and tool role messages
"""

from __future__ import annotations

import os
import json
import time
import httpx
from typing import Optional

_ENV_PATH = os.path.join(os.path.dirname(__file__), "..", "..", ".env")
_MAX_RETRIES = 3
_BASE_DELAY = 1.0

# Provider config: base_url, env_var_for_api_key
_PROVIDERS = {
    "openrouter": {
        "base_url": "https://openrouter.ai/api/v1/chat/completions",
        "env_key": "OPENROUTER_API_KEY",
        "timeout": 60.0,
        "headers": {
            "HTTP-Referer": "https://pulsecode.ai",
            "X-Title": "Pulse Agent",
        },
    },
    "omniroute": {
        "base_url": "http://localhost:20128/v1/chat/completions",
        "env_key": "OMNIROUTE_API_KEY",
        "timeout": 120.0,
        "headers": {},
    },
}


def _load_api_key(env_var: str) -> str:
    """Load an API key from environment or .env."""
    key = os.environ.get(env_var)
    if key:
        return key
    env_path = os.path.abspath(_ENV_PATH)
    if os.path.isfile(env_path):
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if line.startswith(f"{env_var}="):
                    val = line.split("=", 1)[1].strip().strip("\"'")
                    if val:
                        return val
    raise RuntimeError(
        f"{env_var} not found. Set it in .env or as an environment variable."
    )


def _build_body(
    model: str,
    messages: list[dict],
    temperature: float = 0.3,
    max_tokens: Optional[int] = None,
    tools: Optional[list[dict]] = None,
    tool_choice: str = "auto",
) -> dict:
    """Build the request body for the chat completions API."""
    body: dict = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens:
        body["max_tokens"] = max_tokens
    if tools:
        body["tools"] = tools
        body["tool_choice"] = tool_choice
    return body


def call_llm_messages(
    model: str,
    messages: list[dict],
    tools: Optional[list[dict]] = None,
    tool_choice: str = "auto",
    max_tokens: Optional[int] = None,
    temperature: float = 0.3,
    provider: str = "openrouter",
    base_url: Optional[str] = None,
) -> dict:
    """Call an LLM with full conversation history and optional tool definitions.

    Args:
        model: Model identifier (e.g. 'openrouter/free', 'auto/fast')
        messages: List of message dicts with roles: system, user, assistant, tool
        tools: Optional list of tool definitions in OpenAI format
        tool_choice: 'auto', 'none', 'required', or {"type":"function","function":{"name":"..."}}
        max_tokens: Max output tokens
        temperature: Sampling temperature
        provider: Provider name ('openrouter' or 'omniroute')
        base_url: Override base URL

    Returns:
        {"content": str | None, "tool_calls": list[dict] | None}
        content is None when tool_calls is set, and vice versa.
    """
    prov = _PROVIDERS.get(provider)
    if not prov:
        raise ValueError(f"Unknown provider: {provider}")

    api_key = _load_api_key(prov["env_key"])
    url = base_url or prov["base_url"]
    timeout = prov.get("timeout", 60.0)

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        **prov.get("headers", {}),
    }

    body = _build_body(model, messages, temperature, max_tokens, tools, tool_choice)

    if provider == "omniroute":
        print(f"[OmniRoute] POST {url}", file=__import__("sys").stderr, flush=True)
        print(
            f"[OmniRoute] model={model} tools={'yes' if tools else 'no'} n_messages={len(messages)}",
            file=__import__("sys").stderr, flush=True,
        )

    last_error: Optional[str] = None
    for attempt in range(1, _MAX_RETRIES + 1):
        try:
            resp = httpx.post(url, headers=headers, json=body, timeout=timeout)
            if provider == "omniroute":
                print(
                    f"[OmniRoute] response status={resp.status_code}",
                    file=__import__("sys").stderr, flush=True,
                )
                if resp.status_code != 200:
                    print(
                        f"[OmniRoute] error body={resp.text[:500]}",
                        file=__import__("sys").stderr, flush=True,
                    )

            content_type = resp.headers.get("content-type", "")

            # Handle SSE (Server-Sent Events) streaming responses
            if "text/event-stream" in content_type:
                content = _parse_sse(resp.text)
                if content:
                    return {"content": content, "tool_calls": None}
                last_error = "Empty SSE stream"
                delay = _BASE_DELAY * (2 ** (attempt - 1))
                time.sleep(delay)
                continue

            # Standard JSON response
            if resp.status_code == 200:
                data = resp.json()
                choices = data.get("choices", [])
                if not choices:
                    raise RuntimeError(f"LLM returned no choices: {data}")

                msg = choices[0].get("message", {})
                content = msg.get("content")
                tool_calls = msg.get("tool_calls")

                # Check safety blocks
                if content and ("User Safety" in content or "I cannot" in content.lower() or "I'm unable to" in content.lower()):
                    if attempt < _MAX_RETRIES:
                        last_error = f"Safety block: {content[:100]}"
                        delay = _BASE_DELAY * (2 ** (attempt - 1))
                        time.sleep(delay)
                        continue

                if tool_calls:
                    return {"content": content, "tool_calls": tool_calls}
                if content or content == "":
                    return {"content": content or "", "tool_calls": None}

                if attempt < _MAX_RETRIES:
                    last_error = "Empty content response"
                    delay = _BASE_DELAY * (2 ** (attempt - 1))
                    time.sleep(delay)
                    continue
                return {"content": "", "tool_calls": None}

            elif resp.status_code == 429:
                last_error = f"Rate limited (429): {resp.text}"
                delay = _BASE_DELAY * (2 ** (attempt - 1))
                time.sleep(delay)
                continue
            elif resp.status_code == 400:
                err_body = resp.text
                # Model doesn't support tools? Strip and retry once
                if tools and ("Unknown parameter" in err_body or "tools" in err_body.lower()[:500] or "Function calling" in err_body or "not supported" in err_body.lower()):
                    print(f"[{provider}] Model '{model}' does not support tools. Retrying without tools.", file=__import__("sys").stderr, flush=True)
                    body.pop("tools", None)
                    body.pop("tool_choice", None)
                    tools = None  # clear so we don't loop
                    delay = _BASE_DELAY
                    time.sleep(delay)
                    continue
                if "Provider returned error" in err_body or "Error from provider" in err_body or "400" in err_body[:20]:
                    last_error = f"Provider error (400): {err_body[:300]}"
                    delay = _BASE_DELAY * (2 ** (attempt - 1))
                    time.sleep(delay)
                    continue
                raise RuntimeError(f"Bad request (400): {err_body[:500]}")
            elif resp.status_code in (502, 503, 504):
                last_error = f"Gateway error ({resp.status_code}): {resp.text[:100]}"
                delay = _BASE_DELAY * (2 ** (attempt - 1))
                time.sleep(delay)
                continue
            elif resp.status_code == 401:
                raise RuntimeError(f"Invalid API key (401) for {provider}")
            elif resp.status_code == 402:
                raise RuntimeError(f"Insufficient credits (402) for {provider}")
            else:
                last_error = f"HTTP {resp.status_code}: {resp.text[:200]}"
                delay = _BASE_DELAY * (2 ** (attempt - 1))
                time.sleep(delay)
                continue
        except httpx.TimeoutException:
            last_error = f"Timeout (attempt {attempt}/{_MAX_RETRIES})"
            delay = _BASE_DELAY * (2 ** (attempt - 1))
            time.sleep(delay)
            continue
        except httpx.RequestError as e:
            last_error = f"Request failed: {e}"
            delay = _BASE_DELAY * (2 ** (attempt - 1))
            time.sleep(delay)
            continue
        except (json.JSONDecodeError, ValueError) as e:
            last_error = f"Bad response: {e}"
            delay = _BASE_DELAY * (2 ** (attempt - 1))
            time.sleep(delay)
            continue

    raise RuntimeError(f"LLM call failed after {_MAX_RETRIES} attempts. Last error: {last_error}")


def _parse_sse(text: str) -> str:
    """Parse Server-Sent Events streaming response into concatenated text."""
    full_text = ""
    for line in text.split("\n"):
        line = line.strip()
        if line.startswith("data: "):
            try:
                sse_data = json.loads(line[6:])
                delta = sse_data.get("choices", [{}])[0].get("delta", {})
                content = delta.get("content", "")
                if content:
                    full_text += content
            except json.JSONDecodeError:
                continue
    return full_text


def call_llm(
    model: str,
    system_prompt: str,
    user_message: str,
    max_tokens: Optional[int] = None,
    temperature: float = 0.3,
    provider: str = "openrouter",
    base_url: Optional[str] = None,
) -> str:
    """Simple Q&A — one LLM call, no tools. Backward compat wrapper."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_message},
    ]
    result = call_llm_messages(
        model=model,
        messages=messages,
        max_tokens=max_tokens,
        temperature=temperature,
        provider=provider,
        base_url=base_url,
    )
    if result["tool_calls"]:
        raise RuntimeError("Unexpected tool_calls in simple call_llm")
    return result["content"] or ""


def extract_json(text: str) -> dict:
    """Extract a JSON object from LLM output. Handles markdown fences and raw newlines in string values."""
    cleaned = text.strip()
    if cleaned.startswith("```"):
        nl = cleaned.find("\n")
        if nl != -1:
            cleaned = cleaned[nl + 1:]
        if cleaned.endswith("```"):
            cleaned = cleaned[:-3].strip()

    for start in range(len(cleaned)):
        if cleaned[start] != "{":
            continue
        brace_depth = 0
        in_str = False
        json_end = -1
        for i in range(start, len(cleaned)):
            ch = cleaned[i]
            if ch == '"' and (i == 0 or cleaned[i-1] != "\\"):
                in_str = not in_str
            elif not in_str:
                if ch == "{":
                    brace_depth += 1
                elif ch == "}":
                    brace_depth -= 1
                    if brace_depth == 0:
                        json_end = i + 1
                        break
        if json_end == -1:
            continue

        raw = cleaned[start:json_end]
        escaped = []
        in_s = False
        for i, ch in enumerate(raw):
            if ch == '"' and (i == 0 or raw[i-1] != "\\"):
                in_s = not in_s
                escaped.append(ch)
            elif in_s and ch == "\n":
                escaped.append("\\n")
            else:
                escaped.append(ch)
        fixed = "".join(escaped)
        try:
            return json.loads(fixed)
        except json.JSONDecodeError:
            try:
                import ast
                return ast.literal_eval(fixed)
            except (ValueError, SyntaxError):
                continue

    raise ValueError(f"No valid JSON found in LLM response:\n{text[:500]}")
