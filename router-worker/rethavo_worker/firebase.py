from __future__ import annotations

import logging
import threading
import time
from typing import Any
from urllib.parse import quote

from google.auth.transport.requests import Request as GoogleAuthRequest

from . import transport as requests
from .config import (
    FIRESTORE_BASE_URL,
    IDENTITY_TOOLKIT_DELETE_URL,
    JOB_COLLECTION,
    RTDB_URL,
    USER_COLLECTION,
    USER_DEVICES_COLLECTION,
    WEB_PUSH_SUBSCRIPTIONS_COLLECTION,
    credentials,
)

document_cache: dict[str, dict[str, Any]] = {}

collection_cache: dict[str, dict[str, Any]] = {}


def now_ms() -> int:
    return int(time.time() * 1000)


_token_lock = threading.Lock()


def ensure_token() -> str:
    scoped_credentials = credentials
    with _token_lock:
        if not scoped_credentials.valid:
            scoped_credentials.refresh(GoogleAuthRequest())
    return str(scoped_credentials.token)


def firestore_headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {ensure_token()}",
        "Content-Type": "application/json",
    }


def rtdb_headers(*, stream: bool = False) -> dict[str, str]:
    headers = {"Authorization": f"Bearer {ensure_token()}"}
    if stream:
        headers["Accept"] = "text/event-stream"
    else:
        headers["Content-Type"] = "application/json"
    return headers


def rtdb_url(path: str) -> str:
    clean = path.strip("/")
    if clean:
        return f"{RTDB_URL}/{quote(clean, safe='/')}.json"
    return f"{RTDB_URL}/.json"


def decode_firestore_value(value: dict[str, Any]) -> Any:
    if "stringValue" in value:
        return value["stringValue"]
    if "integerValue" in value:
        return int(value["integerValue"])
    if "doubleValue" in value:
        return float(value["doubleValue"])
    if "booleanValue" in value:
        return bool(value["booleanValue"])
    if "timestampValue" in value:
        return value["timestampValue"]
    if "nullValue" in value:
        return None
    if "arrayValue" in value:
        return [
            decode_firestore_value(item)
            for item in value.get("arrayValue", {}).get("values", [])
        ]
    if "mapValue" in value:
        return {
            key: decode_firestore_value(item)
            for key, item in value.get("mapValue", {}).get("fields", {}).items()
        }
    return value


def encode_firestore_value(value: Any) -> dict[str, Any]:
    if value is None:
        return {"nullValue": None}
    if isinstance(value, bool):
        return {"booleanValue": value}
    if isinstance(value, int):
        return {"integerValue": str(value)}
    if isinstance(value, float):
        return {"doubleValue": value}
    if isinstance(value, str):
        return {"stringValue": value}
    if isinstance(value, list):
        return {
            "arrayValue": {"values": [encode_firestore_value(item) for item in value]}
        }
    if isinstance(value, dict):
        return {
            "mapValue": {
                "fields": {
                    key: encode_firestore_value(item) for key, item in value.items()
                }
            }
        }
    raise TypeError(f"Unsupported Firestore value type: {type(value)!r}")


def firestore_document_to_dict(document: dict[str, Any]) -> dict[str, Any]:
    data = {
        key: decode_firestore_value(value)
        for key, value in document.get("fields", {}).items()
    }
    data["id"] = document["name"].split("/")[-1]
    data["_document_name"] = document["name"]
    return data


def get_document(collection_id: str, document_id: str) -> dict[str, Any] | None:
    response = requests.get(
        f"{FIRESTORE_BASE_URL}/{collection_id}/{quote(document_id, safe='')}",
        headers=firestore_headers(),
        timeout=30,
    )
    if response.status_code == 404:
        return None
    response.raise_for_status()
    return firestore_document_to_dict(response.json())


def get_cached_document(
    collection_id: str, document_id: str, ttl_seconds: int
) -> dict[str, Any] | None:
    cache_key = f"{collection_id}/{document_id}"
    current_time = now_ms()
    cached = document_cache.get(cache_key)
    if cached and current_time - int(cached.get("timestamp", 0)) < ttl_seconds * 1000:
        return cached.get("document")

    document = get_document(collection_id, document_id)
    document_cache[cache_key] = {
        "timestamp": current_time,
        "document": document,
    }
    return document


def list_collection_documents(collection_id: str) -> list[dict[str, Any]]:
    documents: list[dict[str, Any]] = []
    page_token = ""
    while True:
        params: dict[str, Any] = {"pageSize": 1000}
        if page_token:
            params["pageToken"] = page_token
        response = requests.get(
            f"{FIRESTORE_BASE_URL}/{collection_id}",
            headers=firestore_headers(),
            params=params,
            timeout=30,
        )
        if response.status_code == 404:
            return []
        response.raise_for_status()
        payload = response.json()
        for document in payload.get("documents", []):
            documents.append(firestore_document_to_dict(document))
        page_token = payload.get("nextPageToken", "")
        if not page_token:
            return documents


def run_collection_query(
    collection_id: str,
    *,
    filters: list[dict[str, Any]] | None = None,
    limit: int | None = None,
) -> list[dict[str, Any]]:
    structured_query: dict[str, Any] = {
        "from": [{"collectionId": collection_id}],
    }
    if filters:
        if len(filters) == 1:
            structured_query["where"] = filters[0]
        else:
            structured_query["where"] = {
                "compositeFilter": {
                    "op": "AND",
                    "filters": filters,
                }
            }
    if limit is not None:
        structured_query["limit"] = limit

    response = requests.post(
        f"{FIRESTORE_BASE_URL}:runQuery",
        headers=firestore_headers(),
        json={"structuredQuery": structured_query},
        timeout=30,
    )
    if response.status_code == 404:
        return []
    response.raise_for_status()

    documents: list[dict[str, Any]] = []
    for item in response.json():
        document = item.get("document")
        if document:
            documents.append(firestore_document_to_dict(document))
    return documents


def status_in_filter(*statuses: str) -> dict[str, Any]:
    return {
        "fieldFilter": {
            "field": {"fieldPath": "status"},
            "op": "IN",
            "value": {
                "arrayValue": {
                    "values": [{"stringValue": status} for status in statuses],
                }
            },
        }
    }


def invalidate_collection_cache(collection_id: str) -> None:
    collection_cache.pop(collection_id, None)


def invalidate_document_cache(collection_id: str, document_id: str) -> None:
    document_cache.pop(f"{collection_id}/{document_id}", None)


def get_cached_collection_documents(
    collection_id: str, ttl_seconds: int
) -> list[dict[str, Any]]:
    current_time = now_ms()
    cached = collection_cache.get(collection_id)
    if cached and current_time - int(cached.get("timestamp", 0)) < ttl_seconds * 1000:
        return list(cached.get("documents", []))

    documents = list_collection_documents(collection_id)
    collection_cache[collection_id] = {
        "timestamp": current_time,
        "documents": documents,
    }
    return list(documents)


def patch_document(document_name: str, fields: dict[str, Any]) -> None:
    params = [("updateMask.fieldPaths", key) for key in fields.keys()]
    payload = {
        "fields": {key: encode_firestore_value(value) for key, value in fields.items()}
    }
    response = requests.patch(
        f"https://firestore.googleapis.com/v1/{quote(document_name, safe='/')}",
        headers=firestore_headers(),
        params=params,
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
    if document_name.endswith("/app_settings/app_gate"):
        invalidate_document_cache("app_settings", "app_gate")


def delete_document(document_name: str) -> None:
    response = requests.delete(
        f"https://firestore.googleapis.com/v1/{quote(document_name, safe='/')}",
        headers=firestore_headers(),
        timeout=30,
    )
    if response.status_code not in {200, 204, 404}:
        response.raise_for_status()

    if f"/{JOB_COLLECTION}/" in document_name:
        invalidate_collection_cache(JOB_COLLECTION)
    elif f"/{USER_DEVICES_COLLECTION}/" in document_name:
        invalidate_collection_cache(USER_DEVICES_COLLECTION)
    elif f"/{USER_COLLECTION}/" in document_name:
        invalidate_collection_cache(USER_COLLECTION)
    elif "/app_settings/" in document_name:
        if document_name.endswith("/app_gate"):
            invalidate_document_cache("app_settings", "app_gate")
    elif f"/{WEB_PUSH_SUBSCRIPTIONS_COLLECTION}/" in document_name:
        invalidate_collection_cache(WEB_PUSH_SUBSCRIPTIONS_COLLECTION)


def delete_auth_user(local_id: str) -> dict[str, bool]:
    response = requests.post(
        IDENTITY_TOOLKIT_DELETE_URL,
        headers=firestore_headers(),
        json={"localId": local_id},
        timeout=30,
    )
    if response.ok:
        return {"deleted": True, "alreadyMissing": False}

    payload = (
        response.json()
        if response.headers.get("Content-Type", "").startswith("application/json")
        else {}
    )
    message = str(payload.get("error", {}).get("message") or response.text)
    if response.status_code in {400, 404} and (
        "USER_NOT_FOUND" in message or "INVALID_LOCAL_ID" in message
    ):
        logging.info("Auth user already missing: %s", local_id)
        return {"deleted": False, "alreadyMissing": True}

    response.raise_for_status()
    return {"deleted": False, "alreadyMissing": False}


def delete_web_push_subscriptions_for_user(user_id: str) -> int:
    removed = 0
    for subscription in run_collection_query(
        WEB_PUSH_SUBSCRIPTIONS_COLLECTION,
        filters=[
            {
                "fieldFilter": {
                    "field": {"fieldPath": "userId"},
                    "op": "EQUAL",
                    "value": {"stringValue": user_id},
                }
            }
        ],
    ):
        if str(subscription.get("userId") or "").strip() != user_id:
            continue
        document_name = str(subscription.get("_document_name") or "").strip()
        if not document_name:
            continue
        delete_document(document_name)
        removed += 1
    return removed


def rtdb_delete(path: str) -> None:
    response = requests.delete(
        rtdb_url(path),
        headers=rtdb_headers(),
        timeout=30,
    )
    if response.status_code not in {200, 204, 404}:
        response.raise_for_status()


def rtdb_patch(path: str, payload: dict[str, Any]) -> None:
    response = requests.patch(
        rtdb_url(path),
        headers=rtdb_headers(),
        json=payload,
        timeout=30,
    )
    response.raise_for_status()
