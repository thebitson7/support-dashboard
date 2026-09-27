"""
Audit wording for reference data (sites, customers, countries, work-done
codes, holidays), shared by the Lookups API and the ticket form's quick-add.
"""

from audit import text
from audit.log import log_action, person
from audit.models import AuditLogEntry
from tickets.models import Country, Customer, Holiday, Site, WorkDoneCode

A = AuditLogEntry.Action

# model -> (noun used in sentences, how one record is named)
NAMING = {
    Site: ("site", lambda s: f"{s.name} ({s.ocn})"),
    Customer: ("customer", lambda c: c.name),
    Country: ("country", lambda c: f"{c.name} ({c.code})"),
    WorkDoneCode: ("work done code", lambda w: f"{w.code} — {w.description}"),
    Holiday: ("holiday", lambda h: f"{h.name} ({text.day(h.date)})"),
}


def lookup_label(instance) -> str:
    """"Site: Tan Tock Seng Hospital (OCN05529-801-00)"."""
    noun, name = NAMING[type(instance)]
    return f"{noun[0].upper()}{noun[1:]}: {name(instance)}"


def field_values(instance, fields) -> dict:
    """Current values of `fields`, JSON-friendly (ids for relations, ISO dates)."""
    values = {}
    for field_name in fields:
        field = instance._meta.get_field(field_name)
        value = getattr(instance, field.attname if field.is_relation else field_name)
        values[field_name] = value.isoformat() if hasattr(value, "isoformat") else value
    return values


def log_lookup(action, instance, request, *, changes: dict | None = None, pk=None) -> None:
    """lookup_created / lookup_updated (with the changed fields) / lookup_deleted."""
    actor = request.user
    noun, name = NAMING[type(instance)]
    verb = {A.LOOKUP_CREATED: "added", A.LOOKUP_UPDATED: "edited", A.LOOKUP_DELETED: "deleted"}[action]
    detail = ""
    if changes:
        detail = ": " + text.listing(
            [str(type(instance)._meta.get_field(f).verbose_name) for f in changes]
        )
    log_action(
        actor,
        action,
        target=instance,
        target_id=pk or instance.pk,
        target_label=lookup_label(instance),
        description=f"{person(actor)} {verb} {noun} {name(instance)}{detail}",
        metadata={"changes": changes} if changes else {},
        request=request,
    )
