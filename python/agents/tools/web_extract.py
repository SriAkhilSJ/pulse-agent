"""Extract text content from web pages.

Uses requests + BeautifulSoup for HTML parsing, or direct text extraction
for plain-text/markdown URLs. Mirrors Hermes tools/web_tools.py / read_extract.py.
"""
from __future__ import annotations

import json
import re
from typing import Optional

name = "webExtract"
description = "Extract readable content from web page URLs. Returns clean page content in markdown/text format. Also works with PDF URLs. Use instead of browser tools for simple information retrieval from plain-text endpoints."
parameters = {
    "type": "object",
    "properties": {
        "urls": {
            "type": "array",
            "items": {"type": "string"},
            "description": "List of URLs to extract content from (max 5 per call)",
        },
        "char_limit": {
            "type": "integer",
            "description": "Maximum characters to return per page (default: 15000)",
            "default": 15000,
        },
    },
    "required": ["urls"],
}


def run(urls: list, char_limit: int = 15000) -> str:
    """Extract text content from web pages."""
    import time

    if not urls:
        return json.dumps({"error": "No URLs provided", "results": []})

    if len(urls) > 5:
        urls = urls[:5]

    char_limit = max(char_limit, 2000)
    results = []

    for url in urls:
        result = _extract_single(url, char_limit)
        results.append(result)

    return json.dumps({"results": results}, indent=2, default=str)


def _extract_single(url: str, char_limit: int) -> dict:
    """Extract content from a single URL."""
    import requests

    url = str(url).strip()
    if not url.startswith(("http://", "https://")):
        # Try to prepend https://
        url = "https://" + url

    try:
        resp = requests.get(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; PulseAgent/1.0)",
                "Accept": "text/html,application/xhtml+xml,application/xml,text/plain,*/*",
            },
            timeout=15,
            allow_redirects=True,
        )
        resp.raise_for_status()

        content_type = resp.headers.get("content-type", "").lower()
        text = resp.text

        # Determine if this is HTML or plain text
        if "text/plain" in content_type or "text/markdown" in content_type:
            # Plain text / markdown — return as-is
            content = text[:char_limit] if len(text) > char_limit else text
            return {
                "url": url,
                "title": url.split("/")[-1] or url,
                "content": content,
                "content_type": "text",
            }

        # HTML — parse with BeautifulSoup
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(text, "html.parser")
        except ImportError:
            # Fallback: basic regex-based extraction
            return _extract_text_fallback(url, text, char_limit)

        # Extract title
        title = ""
        if soup.title and soup.title.string:
            title = soup.title.string.strip()

        # Remove script, style, nav, footer, header elements
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript"]):
            tag.decompose()

        # Try to find main content
        main = soup.find("main") or soup.find("article") or soup.find("body") or soup

        # Get text with paragraph breaks
        lines = []
        for element in main.descendants:
            if element.name in ("p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "pre", "blockquote"):
                text_content = element.get_text(strip=True)
                if text_content:
                    if element.name.startswith("h"):
                        prefix = "# " * int(element.name[1])
                        lines.append(f"\n{prefix} {text_content}\n")
                    elif element.name == "li":
                        lines.append(f"  - {text_content}")
                    elif element.name in ("td", "th"):
                        lines.append(f"  {text_content}")
                    elif element.name == "pre":
                        lines.append(f"\n```\n{text_content}\n```\n")
                    elif element.name == "blockquote":
                        lines.append(f"> {text_content}")
                    else:
                        lines.append(text_content)
            elif element.name == "br":
                lines.append("")
            elif element.name == "hr":
                lines.append("\n---\n")

        content = "\n".join(lines)
        # Collapse multiple blank lines
        content = re.sub(r"\n{3,}", "\n\n", content)

        if not content.strip():
            # Fallback to body text
            content = main.get_text(separator="\n", strip=True)

        # Truncate if needed
        if len(content) > char_limit:
            content = content[:char_limit] + "\n\n[Content truncated...]"

        # Collect images
        images = []
        for img in soup.find_all("img"):
            src = img.get("src", "")
            alt = img.get("alt", "")
            if src and not src.startswith("data:"):
                images.append({"src": src, "alt": alt})

        result = {
            "url": url,
            "title": title or url.split("/")[-1] or url,
            "content": content.strip(),
        }
        if images:
            result["images"] = images[:20]

        return result

    except requests.exceptions.Timeout:
        return {"url": url, "error": "Timeout after 15s"}
    except requests.exceptions.HTTPError as e:
        return {"url": url, "error": f"HTTP {e.response.status_code}"}
    except requests.exceptions.ConnectionError:
        return {"url": url, "error": "Connection failed"}
    except Exception as e:
        return {"url": url, "error": f"{type(e).__name__}: {e}"}


def _extract_text_fallback(url: str, html: str, char_limit: int) -> dict:
    """Basic regex-based text extraction when BeautifulSoup is not available."""
    # Remove scripts and styles
    text = re.sub(r"<script[^>]*>.*?</script>", "", html, flags=re.DOTALL)
    text = re.sub(r"<style[^>]*>.*?</style>", "", text, flags=re.DOTALL)
    # Replace tags with newlines
    text = re.sub(r"<br\s*/?>", "\n", text)
    text = re.sub(r"</p>", "\n\n", text)
    text = re.sub(r"</?[^>]+>", "", text)
    # Decode HTML entities
    text = text.replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&nbsp;", " ")
    # Collapse whitespace
    text = re.sub(r"\n\s*\n", "\n\n", text)
    text = text.strip()

    if len(text) > char_limit:
        text = text[:char_limit] + "\n\n[Content truncated...]"

    title_match = re.search(r"<title[^>]*>(.*?)</title>", html, re.DOTALL)
    title = title_match.group(1).strip() if title_match else url.split("/")[-1] or url

    return {"url": url, "title": title, "content": text, "extraction": "fallback"}
