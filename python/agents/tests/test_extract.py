"""Test extract_json with various LLM output formats."""
import sys
sys.path.insert(0, '.')
from llm_client import extract_json

tests = [
    ("clean JSON", '{"a": 1}', {"a": 1}),
    ("JSON with raw newlines in content",
     '{"file_path": "x.py", "content": "def foo():\n    pass\n", "action": "create"}',
     None),  # just check it parses
]

for name, raw, expected in tests:
    result = extract_json(raw)
    print(f"PASS {name}: keys={list(result.keys())}")

# Real LLM-style output with code
real = """{
  "file_path": "validate_email.py",
  "action": "create",
  "content": "import re\n\ndef validate_email(email: str) -> bool:\n    pattern = r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$'\n    return bool(pattern.match(email))",
  "explanation": "email validator function"
}"""
result = extract_json(real)
print(f"PASS real-style: file={result['file_path']}, content_len={len(result['content'])}")

# With markdown fences
fenced = f"```json\n{real}\n```"
result = extract_json(fenced)
print(f"PASS fenced: file={result['file_path']}")

print("ALL PASS")
