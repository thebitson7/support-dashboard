"""
The one place audit entries are written. Every audit-worthy action calls
log_action() explicitly, at the point where it knows what happened in plain
words, instead of relying on model signals: signals miss bulk writes, and
can't tell "closed the ticket" from "saved the ticket".

Best-effort and non-blocking by design: a failure to write the entry is
reported to Django's logger and swallowed, never raised, because the action
succeeding matters more than its log entry. The write runs in its own
savepoint, so a failed insert can't poison the caller's transaction either.
Inside a transaction, the entry commits or rolls back with the action it
describes, so the log never claims something that didn't happen.
"""

import logging

from django.db import transaction

from accounts.throttling import client_ip

from .models import AuditLogEntry

logger = logging.getLogger(__name__)

# Model name -> the plain target_type stored (stable, readable in exports).
TARGET_TYPES = {
    "ticket": "ticket",
    "ticketactivity": "ticket_activity",
    "worklogentry": "work_log",
    "site": "site",
    "customer": "customer",
    "country": "country",
    "workdonecode": "work_done_code",
    "holiday": "holiday",
    "user": "user",
}


def person(user) -> str:
    """How someone is named in a sentence: "Syed Hussain" (or their username)."""
    if user is None:
        return "Someone"
    return getattr(user, "display_name", None) or getattr(user, "username", "") or "Someone"


def log_action(
    actor,
    action: str,
    *,
    description: str,
    target=None,
    target_type: str = "",
    target_id="",
    target_label: str = "",
    metadata: dict | None = None,
    request=None,
) -> AuditLogEntry | None:
    """
    Record that `actor` did `action`. `target` may be a model instance (its
    type and id are derived) or omitted, with `target_type` / `target_id`
    given directly for events without a live object. `description` is the
    full sentence shown in the log. Returns the entry, or None if writing it
    failed (which is logged, never raised).

    Never pass secrets here: no passwords, no tokens.
    """
    try:
        if target is not None:
            target_type = target_type or TARGET_TYPES.get(target._meta.model_name, target._meta.model_name)
            target_id = target_id or target.pk
        is_user = actor is not None and getattr(actor, "is_authenticated", False)
        with transaction.atomic():
            return AuditLogEntry.objects.create(
                actor=actor if is_user else None,
                actor_username=getattr(actor, "username", "") if is_user else "",
                action=action,
                target_type=target_type or "",
                target_id="" if target_id in (None, "") else str(target_id),
                target_label=(target_label or "")[:255],
                description=description[:500],
                metadata=metadata or {},
                ip_address=(client_ip(request) if request is not None else "")[:45],
            )
    except Exception:  # noqa: BLE001 — logging must never break the action it describes
        logger.exception("Could not write audit log entry %r (%s)", action, description)
        return None
