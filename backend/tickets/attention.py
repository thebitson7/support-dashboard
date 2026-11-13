"""
"Tickets waiting to be closed": which open tickets have sat too long since
the work on them finished, and who should close them.

Rules (one place for all of them):

* Only open tickets (`cms_closed_on` is null) are considered.
* The clock starts at the END of the ticket's last activity (the latest
  `end_at` over all its activities, whoever resolved them). A ticket with no
  activities starts at `received_at`, and every threshold then shifts later by
  a grace period. Plain calendar hours: weekends and holidays are NOT excluded.
  A clock start in the future (an activity ending later) counts as age 0.
* Levels by age, boundaries inclusive: due_soon at TICKET_DUE_SOON_HOURS,
  overdue at TICKET_OVERDUE_HOURS (the management target: close within 2
  days), critical at TICKET_CRITICAL_HOURS.
* People involved, all weighted equally: the creator, the assignee, the
  forward recipient (only while `is_forwarded`), whoever added it to CMS, and
  every distinct resolver of its activities. Only active users are listed.
* Staff see only the tickets they are involved in; admins see every ticket
  plus a per-person grouping (a ticket counts for everyone named on it).

The thresholds come from the environment (see backend/.env.example) and are
validated when Django starts (TicketsConfig.ready), so a bad value stops the
server instead of silently mis-classifying tickets.
"""

from __future__ import annotations

import os
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Any

from django.core.exceptions import ImproperlyConfigured
from django.db import models
from django.db.models import Exists, Max, OuterRef, Q, QuerySet, Subquery

from accounts.models import User

from .models import Ticket, TicketActivity

# --- Thresholds -------------------------------------------------------------------

DEFAULTS = {
    "TICKET_DUE_SOON_HOURS": 24,
    "TICKET_OVERDUE_HOURS": 48,
    "TICKET_CRITICAL_HOURS": 72,
    "TICKET_NO_ACTIVITY_GRACE_HOURS": 24,
}

# The most tickets one response lists (most severe, then oldest, first). The
# counts and `total` always cover every ticket.
RESULT_CAP = 200


@dataclass(frozen=True)
class Thresholds:
    due_soon_hours: int
    overdue_hours: int
    critical_hours: int
    no_activity_grace_hours: int


def parse_thresholds(environ: Mapping[str, str]) -> Thresholds:
    """
    The four settings from an environment mapping (defaults for unset or empty
    ones). Each must be a positive whole number of hours, and due_soon <
    overdue < critical; anything else raises ImproperlyConfigured.
    """
    values: dict[str, int] = {}
    for name, default in DEFAULTS.items():
        raw = (environ.get(name) or "").strip()
        if not raw:
            values[name] = default
            continue
        try:
            value = int(raw)
        except ValueError:
            raise ImproperlyConfigured(f"{name} must be a whole number of hours (got {raw!r}).")
        if value <= 0:
            raise ImproperlyConfigured(f"{name} must be a positive number of hours (got {value}).")
        values[name] = value

    due_soon = values["TICKET_DUE_SOON_HOURS"]
    overdue = values["TICKET_OVERDUE_HOURS"]
    critical = values["TICKET_CRITICAL_HOURS"]
    if not due_soon < overdue < critical:
        raise ImproperlyConfigured(
            "Ticket attention thresholds must increase: TICKET_DUE_SOON_HOURS "
            f"({due_soon}) < TICKET_OVERDUE_HOURS ({overdue}) < TICKET_CRITICAL_HOURS ({critical})."
        )
    return Thresholds(
        due_soon_hours=due_soon,
        overdue_hours=overdue,
        critical_hours=critical,
        no_activity_grace_hours=values["TICKET_NO_ACTIVITY_GRACE_HOURS"],
    )


@lru_cache(maxsize=1)
def get_thresholds() -> Thresholds:
    """The process's thresholds, read from the environment once."""
    return parse_thresholds(os.environ)


# --- Classification (pure: no database, no clock) ------------------------------------


class Level(models.TextChoices):
    DUE_SOON = "due_soon", "Due soon"
    OVERDUE = "overdue", "Overdue"
    CRITICAL = "critical", "Critical"


# Higher is more severe.
SEVERITY = {Level.DUE_SOON: 1, Level.OVERDUE: 2, Level.CRITICAL: 3}


def classify(age_hours: float, has_activity: bool, thresholds: Thresholds | None = None) -> Level | None:
    """
    The level for a ticket whose clock has run `age_hours`, or None while it
    is below every threshold. Boundaries are inclusive. Without activities the
    whole ladder shifts later by the grace period. A negative age (a clock
    start in the future) is treated as 0.
    """
    t = thresholds or get_thresholds()
    age = max(0.0, age_hours)
    shift = 0 if has_activity else t.no_activity_grace_hours
    if age >= t.critical_hours + shift:
        return Level.CRITICAL
    if age >= t.overdue_hours + shift:
        return Level.OVERDUE
    if age >= t.due_soon_hours + shift:
        return Level.DUE_SOON
    return None


def age_hours(clock_start: datetime, now: datetime) -> float:
    """Calendar hours from the clock start to now, never negative."""
    return max(0.0, (now - clock_start).total_seconds() / 3600)


def clock_start(ticket: Ticket) -> tuple[datetime, bool]:
    """
    (When the ticket's clock started, whether it has activities), read from
    the database: the latest activity end by anyone, else when it was received.
    """
    last_end = ticket.activities.aggregate(last=Max("end_at"))["last"]
    return (last_end, True) if last_end is not None else (ticket.received_at, False)


def closure_lag_minutes(ticket: Ticket, now: datetime) -> int:
    """Whole minutes from the ticket's clock start to `now`, clamped at 0."""
    start, _ = clock_start(ticket)
    return max(0, int((now - start).total_seconds() // 60))


# --- The attention list ---------------------------------------------------------------

ROLE_ORDER = ("creator", "assignee", "forwarded", "cms_added", "resolver")


def _last_activity_end() -> Subquery:
    """
    The latest activity end of the outer ticket, by ANYONE. A correlated
    subquery, deliberately not a join: joining activities for the involvement
    filter (e.g. activities__resolved_by=user) and taking Max over that join
    would cover only the viewer's own activities and start the clock too early.
    """
    return Subquery(TicketActivity.objects.filter(ticket=OuterRef("pk")).order_by("-end_at").values("end_at")[:1])


def involving(user: User) -> Q:
    """Tickets `user` is named on. Exists() for resolvers, so nothing is joined."""
    resolved = TicketActivity.objects.filter(ticket=OuterRef("pk"), resolved_by=user)
    return (
        Q(created_by=user)
        | Q(assigned_to=user)
        | Q(is_forwarded=True, forwarded_to=user)
        | Q(cms_added_by=user)
        | Q(Exists(resolved))
    )


def candidate_tickets(now: datetime, user: User | None = None) -> QuerySet[Any]:
    """
    Open tickets old enough to reach at least due_soon (allowing for the
    no-activity shift), annotated with `last_activity_end`. Restricted to the
    ones `user` is involved in when a user is given.
    """
    t = get_thresholds()
    qs = Ticket.objects.filter(cms_closed_on__isnull=True).annotate(last_activity_end=_last_activity_end())
    qs = qs.filter(
        Q(last_activity_end__lte=now - timedelta(hours=t.due_soon_hours))
        | Q(
            last_activity_end__isnull=True,
            received_at__lte=now - timedelta(hours=t.due_soon_hours + t.no_activity_grace_hours),
        )
    )
    if user is not None:
        qs = qs.filter(involving(user))
    return qs


@dataclass
class Item:
    id: int
    level: Level
    age_hours: float
    has_activity: bool
    clock_started_at: datetime
    # user id -> their roles on this ticket, in ROLE_ORDER.
    roles: dict[int, list[str]] = field(default_factory=dict)


def _add_role(roles: dict[int, list[str]], user_id: int | None, role: str) -> None:
    if user_id is None:
        return
    held = roles.setdefault(user_id, [])
    if role not in held:
        held.append(role)


def _empty_counts() -> dict[str, int]:
    return {level.value: 0 for level in Level}


def attention_tickets(user: User, now: datetime) -> dict[str, Any]:
    """
    The viewer's attention list: every open ticket waiting to be closed in
    their scope (their own tickets for staff, every ticket for admins). The
    number of queries is fixed (four), however many tickets match.
    """
    t = get_thresholds()
    is_admin = user.is_admin_role
    candidates = candidate_tickets(now, None if is_admin else user)

    # 1. Every candidate's clock and named people (no relations loaded).
    rows = candidates.values(
        "id",
        "received_at",
        "last_activity_end",
        "created_by_id",
        "assigned_to_id",
        "is_forwarded",
        "forwarded_to_id",
        "cms_added_by_id",
    )
    items: dict[int, Item] = {}
    for row in rows:
        has_activity = row["last_activity_end"] is not None
        start = row["last_activity_end"] if has_activity else row["received_at"]
        age = age_hours(start, now)
        level = classify(age, has_activity, t)
        if level is None:
            continue  # defensive: the database prefilter already uses the same edges
        item = Item(row["id"], level, age, has_activity, start)
        _add_role(item.roles, row["created_by_id"], "creator")
        _add_role(item.roles, row["assigned_to_id"], "assignee")
        if row["is_forwarded"]:
            _add_role(item.roles, row["forwarded_to_id"], "forwarded")
        _add_role(item.roles, row["cms_added_by_id"], "cms_added")
        items[item.id] = item

    # 2. Distinct resolvers of those tickets (one query, a subquery of the candidates).
    resolvers = (
        TicketActivity.objects.filter(ticket__in=candidates.values("pk"), resolved_by__isnull=False)
        .values_list("ticket_id", "resolved_by_id")
        .distinct()
    )
    for ticket_id, resolver_id in resolvers:
        if ticket_id in items:
            _add_role(items[ticket_id].roles, resolver_id, "resolver")
    for item in items.values():
        for held in item.roles.values():
            held.sort(key=ROLE_ORDER.index)

    # 3. Names of the active people involved; deactivated people are left out everywhere.
    people_ids = {uid for item in items.values() for uid in item.roles}
    users = {u.pk: u for u in User.objects.filter(pk__in=people_ids, is_active=True)}

    ordered = sorted(items.values(), key=lambda i: (-SEVERITY[i.level], -i.age_hours, i.id))
    counts = _empty_counts()
    for item in ordered:
        counts[item.level.value] += 1
    shown = ordered[:RESULT_CAP]

    # 4. Site and customer for the listed tickets only.
    details = {
        ticket.pk: ticket
        for ticket in Ticket.objects.select_related("site", "customer").filter(pk__in=[i.id for i in shown])
    }

    def involved(item: Item) -> list[dict[str, Any]]:
        named = [(users[uid], roles) for uid, roles in item.roles.items() if uid in users]
        named.sort(key=lambda pair: (ROLE_ORDER.index(pair[1][0]), pair[0].display_name.lower()))
        return [{"id": u.pk, "name": u.display_name, "roles": roles} for u, roles in named]

    results = []
    for item in shown:
        ticket = details.get(item.id)
        if ticket is None:  # closed or deleted between the queries
            continue
        results.append(
            {
                "id": item.id,
                "cms_next_ticket_no": ticket.cms_next_ticket_no,
                "site_name": ticket.site.name,
                "site_ocn": ticket.site.ocn,
                "customer_name": ticket.customer.name,
                "level": item.level.value,
                "age_hours": round(item.age_hours, 1),
                "basis": "last_activity" if item.has_activity else "received",
                "clock_started_at": item.clock_started_at,
                "involved": involved(item),
                "your_roles": item.roles.get(user.pk, []),
            }
        )

    data: dict[str, Any] = {
        "generated_at": now,
        "thresholds": {
            "due_soon_hours": t.due_soon_hours,
            "overdue_hours": t.overdue_hours,
            "critical_hours": t.critical_hours,
            "no_activity_grace_hours": t.no_activity_grace_hours,
        },
        "scope": "all" if is_admin else "mine",
        "counts": counts,
        "total": len(ordered),
        "truncated": len(ordered) > len(shown),
        "results": results,
    }
    if is_admin:
        data["people"] = _people(ordered, users)
    return data


def _people(items: Iterable[Item], users: Mapping[int, User]) -> list[dict[str, Any]]:
    """One row per active person named on any listed ticket (all of them, not only the capped page)."""
    per_person: dict[int, dict[str, Any]] = {}
    for item in items:
        for uid in item.roles:
            if uid not in users:
                continue
            row = per_person.setdefault(
                uid,
                {
                    "user": {"id": uid, "name": users[uid].display_name},
                    "counts": _empty_counts(),
                    "ticket_ids": [],
                },
            )
            row["counts"][item.level.value] += 1
            row["ticket_ids"].append(item.id)
    return sorted(
        per_person.values(),
        key=lambda r: (-r["counts"]["critical"], -r["counts"]["overdue"], r["user"]["name"].lower()),
    )
