#!/opt/bin/python3
"""Read-only configuration and Firebase connectivity check; never sends notifications."""

import json

from rethavo_worker import config, firebase

gate = firebase.get_document("app_settings", "app_gate")
pending = firebase.run_collection_query(
    config.JOB_COLLECTION,
    filters=[firebase.status_in_filter("PENDING", "RETRY", "PROCESSING")],
    limit=200,
)
print(
    json.dumps(
        {
            "firebase": "OK",
            "mailConfigured": config.EMAIL_ENABLED,
            "webPushConfigured": config.WEB_PUSH_ENABLED,
            "fcmEnabled": config.ENABLE_FCM_PUSH,
            "maintenance": bool((gate or {}).get("maintenanceEnabled")),
            "technicalFailure": bool((gate or {}).get("errorEnabled")),
            "unfinishedJobsUpTo200": len(pending),
        }
    )
)
