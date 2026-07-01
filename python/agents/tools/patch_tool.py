"""
Pulse Agent — patch tool.

Targeted find-and-replace edits in files. Supports fuzzy matching
(whitespace-insensitive) so minor indentation differences don't break edits.

Design:
- Fuzzy match: normalizes whitespace before comparison
- Unique match required (unless replace_all=True)
- Returns unified diff for feedback
- Safe: validates old_string exists before replacing
"""

from __future__ import annotations

import difflib
import json
import logging
import os
import re
from pathlib import Path

logger = logging.getLogger(__name__)

name = "patch"
description = "Targeted find-and-replace edit in a file. Uses fuzzy matching so minor whitespace/indentation differences won't break it. Returns a unified diff showing what changed. Use this instead of completely rewriting a file when you only need to change a few lines."
category = "code_write"
danger_level = "medium"
requires_approval = False
keywords = ("edit", "replace", "find", "modify", "diff", "sed")

parameters = {
    "type": "object",
    "properties": {
        "path": {
            "type": "string",
            "description": "Absolute path to the file to edit.",
        },
        "old_string": {
            "type": "string",
            "description": "The exact text to find and replace. Should be unique in the file unless replace_all is true. Include surrounding context lines to ensure uniqueness.",
        },
        "new_string": {
            "type": "string",
            "description": "The replacement text. Use empty string to delete the matched text.",
        },
        "replace_all": {
            "type": "boolean",
            "description": "If true, replace ALL occurrences of old_string instead of requiring a unique match. Default: false.",
            "default": False,
        },
    },
    "required": ["path", "old_string", "new_string"],
}


def run(path: str, old_string: str, new_string: str, replace_all: bool = False) -> str:
    """Execute a find-and-replace edit on a file."""
    file_path = Path(path)

    if not file_path.exists():
        return json.dumps({"error": f"File not found: {path}"})
    if not file_path.is_file():
        return json.dumps({"error": f"Not a file: {path}"})

    try:
        content = file_path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        return json.dumps({"error": f"Cannot read file: {e}"})

    # Check encoding
    try:
        content.encode("utf-8")
    except UnicodeEncodeError:
        return json.dumps({"error": "File is not valid UTF-8 text"})

    # Try exact match first
    if old_string in content:
        return _apply_patch(file_path, content, old_string, new_string, replace_all)

    # Try fuzzy match (normalize whitespace)
    fuzzy_result = _fuzzy_find(content, old_string)
    if fuzzy_result is not None:
        matched_text, count = fuzzy_result
        if count == 1 or replace_all:
            return _apply_patch(
                file_path, content, matched_text, new_string,
                replace_all=replace_all, was_fuzzy=True,
            )
        return json.dumps({
            "error": f"Fuzzy match found {count} occurrences. Use replace_all=True to replace all, or provide more context for a unique match.",
            "matches": count,
        })

    return json.dumps({
        "error": "Could not find the specified text in the file. The text may have different whitespace or been modified.",
        "hint": "Try reading the file first to see its exact current content, then provide a precise match.",
    })


def _apply_patch(
    file_path: Path,
    content: str,
    old_text: str,
    new_text: str,
    replace_all: bool = False,
    was_fuzzy: bool = False,
) -> str:
    """Apply the patch and return a diff."""
    if replace_all:
        new_content = content.replace(old_text, new_text)
    else:
        # Single replacement
        idx = content.index(old_text)
        new_content = content[:idx] + new_text + content[idx + len(old_text):]

    # Generate unified diff
    old_lines = content.splitlines(keepends=True)
    new_lines = new_content.splitlines(keepends=True)
    diff = list(difflib.unified_diff(
        old_lines, new_lines,
        fromfile=str(file_path),
        tofile=str(file_path),
        lineterm="",
    ))
    diff_str = "\n".join(diff)

    # Count changes
    old_count = content.count(old_text)
    new_count = new_content.count(new_text)

    try:
        file_path.write_text(new_content, encoding="utf-8")
    except OSError as e:
        return json.dumps({"error": f"Cannot write file: {e}"})

    return json.dumps({
        "success": True,
        "path": str(file_path),
        "diff": diff_str,
        "was_fuzzy": was_fuzzy,
        "replacements": old_count if replace_all else 1,
        "chars_changed": len(new_content) - len(content),
    }, indent=2)


def _fuzzy_find(content: str, search: str) -> tuple[str, int] | None:
    """Find text with whitespace-insensitive matching.

    Normalizes all whitespace runs to single spaces for comparison.
    Returns the matched text (with original whitespace) and the count of matches.
    """
    # Normalize both to single spaces
    def normalize(s: str) -> str:
        return re.sub(r'\s+', ' ', s).strip()

    norm_search = normalize(search)
    norm_content = normalize(content)

    if norm_search not in norm_content:
        return None

    # Count occurrences
    count = norm_content.count(norm_search)

    # Find the first occurrence in normalized form and map back to original
    # Build a position mapping
    pos_map = _build_position_map(content)
    norm_pos = norm_content.index(norm_search)

    # Map normalized position back to original position
    if norm_pos in pos_map:
        orig_start = pos_map[norm_pos]
    else:
        # Fallback: approximate
        orig_start = content.find(search[:20])
        if orig_start < 0:
            orig_start = content.find(search[:10])
        if orig_start < 0:
            return None

    # Get the original text (matched + same length as search)
    # TODO: handle whitespace difference in length properly
    end_pos = orig_start + len(search)
    matched_text = content[orig_start:end_pos]

    # Verify match by normalizing
    if normalize(matched_text) == norm_search:
        return matched_text, count

    # Try expanding the match boundary
    for expand in range(1, 50):
        end_pos = orig_start + len(search) + expand
        if end_pos > len(content):
            break
        matched_text = content[orig_start:end_pos]
        if normalize(matched_text) == norm_search:
            return matched_text, count

    return None


def _build_position_map(text: str) -> dict[int, int]:
    """Build a mapping from normalized position to original position.

    Returns dict where key = position in normalized text, value = position in original.
    """
    norm_pos = 0
    orig_pos = 0
    pos_map = {}

    while orig_pos < len(text):
        pos_map[norm_pos] = orig_pos
        if text[orig_pos].isspace():
            # Skip all consecutive whitespace
            ws_count = 0
            while orig_pos < len(text) and text[orig_pos].isspace():
                orig_pos += 1
                ws_count += 1
            norm_pos += 1  # one space in normalized form
        else:
            orig_pos += 1
            norm_pos += 1

    return pos_map
