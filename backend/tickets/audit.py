"""
Audit wording for tickets: created, edited (naming the fields), closed /
reopened, and activities added / removed. Called from the ticket write
serializer; the entries themselves go through audit.log.log_action.
"""

from collections import Counter

from django.db.models import Field

from audit import text
from audit.log import log_action, person
from audit.models import AuditLogEntry

from .models import Ticket, TicketActivity

A = AuditLogEntry.Action


def _field(name: str) -> Field:
    """A tracked Ticket field (always a concrete field, never a reverse relation)."""
    field = Ticket._meta.get_field(name)
    if not isinstance(field, Field):
        raise TypeError(f"Ticket.{name} is not a concrete field and can't be tracked.")
    return field

VERIFICATION_FIELDS = (
    "resolution_verified_by",
    "resolution_verified_on",
    "cms_closed_by",
    "cms_closed_on",
    "service_closed_date",
)
# Compared on edit. Foreign keys by id; the attachment by file name.
TRACKED_FIELDS = (
    "received_at",
    "cms_next_ticket_no",
    "site",
    "customer",
    "assigned_to",
    "ticket_type",
    "incoming_channel",
    "is_forwarded",
    "forwarded_to",
    "cms_added_by",
    "cms_added_on",
    "issue_description",
    "possible_root_cause",
    "notes",
    "total_duration_hours",
    "is_pre",
    *VERIFICATION_FIELDS,
    "pdf_attachment",
)
ACTIVITY_KEYS = (
    "activity_type",
    "start_at",
    "end_at",
    "duration_minutes",
    "work_done_code_id",
    "is_likely_cause",
    "resolved_by_id",
)


def ticket_label(ticket: Ticket) -> str:
    return f"Ticket #{ticket.cms_next_ticket_no}"


def snapshot(ticket: Ticket) -> dict:
    """The tracked fields' current values (ids for relations), to diff an edit."""
    values = {}
    for name in TRACKED_FIELDS:
        field = _field(name)
        if name == "pdf_attachment":
            values[name] = ticket.pdf_attachment.name or ""
        elif field.is_relation:
            values[name] = getattr(ticket, field.attname)
        else:
            values[name] = getattr(ticket, name)
    values["status"] = ticket.status
    return values


def _label(name: str) -> str:
    return str(_field(name).verbose_name).replace("cms", "CMS").replace("pdf", "PDF")


# --- Activities -----------------------------------------------------------------


def stored_activities(ticket: Ticket) -> list[tuple]:
    return [tuple(row) for row in ticket.activities.values_list(*ACTIVITY_KEYS)]


def sent_activities(activities: list[dict]) -> list[tuple]:
    """The serializer's validated activities, in the same shape as stored ones."""

    def pk(value):
        return getattr(value, "pk", value)

    return [
        (
            a["activity_type"],
            a["start_at"],
            a["end_at"],
            a["duration_minutes"],
            pk(a["work_done_code"]),
            bool(a.get("is_likely_cause", False)),
            pk(a.get("resolved_by")),
        )
        for a in activities
    ]


def _activity_phrase(signature: tuple, tzinfo) -> str:
    kind, start, end, minutes = signature[0], signature[1], signature[2], signature[3]
    label = TicketActivity.Type(kind).label if kind in TicketActivity.Type.values else kind
    end_clock = text.clock(end.astimezone(tzinfo).time())
    return f"a {label} activity ({text.moment(start, tzinfo)} – {end_clock}, {text.duration(minutes)})"


# --- Entries --------------------------------------------------------------------------


def log_created(ticket: Ticket, request, activity_count: int) -> None:
    actor = request.user
    extra = f" with {activity_count} {'activity' if activity_count == 1 else 'activities'}" if activity_count else ""
    log_action(
        actor,
        A.TICKET_CREATED,
        target=ticket,
        target_label=ticket_label(ticket),
        description=f"{person(actor)} created ticket #{ticket.cms_next_ticket_no} for {ticket.site.name}{extra}",
        metadata={"site": ticket.site.name, "status": ticket.status, "activities": activity_count},
        request=request,
    )


def log_updated(ticket: Ticket, request, before: dict, old_activities: list[tuple] | None, new_activities: list[tuple] | None) -> None:
    """
    One entry per kind of change: the status transition (closed / reopened),
    other field edits (named), then each activity genuinely added or removed.
    Activities are replaced as a set on every edit, so they're compared as a
    multiset: unchanged ones produce nothing.
    """
    actor = request.user
    label = ticket_label(ticket)
    number = ticket.cms_next_ticket_no
    after = snapshot(ticket)

    if before["status"] != after["status"]:
        closed = after["status"] == "closed"
        log_action(
            actor,
            A.TICKET_CLOSED if closed else A.TICKET_REOPENED,
            target=ticket,
            target_label=label,
            description=f"{person(actor)} {'closed' if closed else 'reopened'} ticket #{number}",
            metadata={"from": before["status"], "to": after["status"]},
            request=request,
        )

    changed = [name for name in TRACKED_FIELDS if before[name] != after[name]]
    if before["status"] != after["status"]:
        changed = [name for name in changed if name not in VERIFICATION_FIELDS]  # said by closed / reopened
    if new_activities is not None:
        changed = [name for name in changed if name != "total_duration_hours"]  # follows the activities
    if changed:
        names = [_label(name) for name in changed]
        log_action(
            actor,
            A.TICKET_UPDATED,
            target=ticket,
            target_label=label,
            description=f"{person(actor)} updated ticket #{number}: {text.listing(names)}",
            metadata={"fields": changed},
            request=request,
        )

    if new_activities is not None and old_activities is not None:
        tzinfo = actor.tzinfo
        old, new = Counter(old_activities), Counter(new_activities)
        for signature in (new - old).elements():
            log_action(
                actor,
                A.TICKET_ACTIVITY_ADDED,
                target=ticket,
                target_label=label,
                description=f"{person(actor)} added {_activity_phrase(signature, tzinfo)} to ticket #{number}",
                metadata={"activity_type": signature[0], "minutes": signature[3]},
                request=request,
            )
        for signature in (old - new).elements():
            log_action(
                actor,
                A.TICKET_ACTIVITY_REMOVED,
                target=ticket,
                target_label=label,
                description=f"{person(actor)} removed {_activity_phrase(signature, tzinfo)} from ticket #{number}",
                metadata={"activity_type": signature[0], "minutes": signature[3]},
                request=request,
            )
