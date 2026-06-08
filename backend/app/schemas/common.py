from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def serialize_doc(doc: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if doc is None:
        return None

    new_doc = {}
    for key, value in doc.items():
        if key == "_id":
            new_doc["id"] = str(value)
        elif isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            else:
                value = value.astimezone(timezone.utc)
            new_doc[key] = value.isoformat().replace("+00:00", "Z")
        elif isinstance(value, dict):
            new_doc[key] = serialize_doc(value)
        elif isinstance(value, list):
            new_doc[key] = [
                serialize_doc(item)
                if isinstance(item, dict)
                else str(item)
                if key.endswith("_id") or key == "ids"
                else item
                for item in value
            ]
        elif key.endswith("_id") or key == "user_id":
            new_doc[key] = str(value)
        else:
            new_doc[key] = value

    return new_doc


def serialize_docs(docs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [serialize_doc(doc) for doc in docs]
