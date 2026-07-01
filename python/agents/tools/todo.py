"""ToDo management tool — create, list, update, complete, and delete tasks."""
import json
import time
from typing import Optional

name = "todo"
description = "Manage todos: add, list, update, complete, or delete task items"
parameters = {
    "type": "object",
    "properties": {
        "action": {
            "type": "string",
            "enum": ["add", "list", "update", "complete", "delete", "clear"],
            "description": "Operation to perform on todos",
        },
        "id": {
            "type": "string",
            "description": "Todo item ID (required for update/complete/delete)",
            "default": "",
        },
        "text": {
            "type": "string",
            "description": "Task description (required for add, optional for update)",
            "default": "",
        },
        "status": {
            "type": "string",
            "enum": ["pending", "in_progress", "completed", "cancelled"],
            "description": "Status to set (for update action)",
            "default": "",
        },
    },
    "required": ["action"],
}

# In-memory store — persists for the lifetime of the agent process
_store: dict[str, dict] = {}
_next_id = 1


def _next() -> str:
    global _next_id
    n = _next_id
    _next_id += 1
    return str(n)


def run(action: str, id: str = "", text: str = "", status: str = "") -> str:
    now = time.time()

    if action == "add":
        if not text:
            return "Error: 'text' is required for add action"
        tid = _next()
        _store[tid] = {
            "id": tid,
            "text": text,
            "status": "pending",
            "created": now,
            "updated": now,
        }
        return json.dumps({"action": "added", "todo": _store[tid]}, indent=2)

    elif action == "list":
        items = sorted(_store.values(), key=lambda x: x["created"])
        total = len(items)
        pending = sum(1 for i in items if i["status"] == "pending")
        completed = sum(1 for i in items if i["status"] == "completed")
        in_progress = sum(1 for i in items if i["status"] == "in_progress")
        return json.dumps(
            {
                "todos": items,
                "total": total,
                "pending": pending,
                "in_progress": in_progress,
                "completed": completed,
            },
            indent=2,
        )

    elif action == "complete":
        if not id:
            return "Error: 'id' is required for complete action"
        item = _store.get(id)
        if not item:
            return f"Error: todo '{id}' not found"
        item["status"] = "completed"
        item["updated"] = now
        return json.dumps({"action": "completed", "todo": item}, indent=2)

    elif action == "update":
        if not id:
            return "Error: 'id' is required for update action"
        item = _store.get(id)
        if not item:
            return f"Error: todo '{id}' not found"
        if text:
            item["text"] = text
        if status:
            item["status"] = status
        item["updated"] = now
        return json.dumps({"action": "updated", "todo": item}, indent=2)

    elif action == "delete":
        if not id:
            return "Error: 'id' is required for delete action"
        if id not in _store:
            return f"Error: todo '{id}' not found"
        removed = _store.pop(id)
        return json.dumps({"action": "deleted", "todo": removed}, indent=2)

    elif action == "clear":
        count = len(_store)
        _store.clear()
        return json.dumps({"action": "cleared", "removed": count}, indent=2)

    else:
        return f"Error: unknown action '{action}'"
