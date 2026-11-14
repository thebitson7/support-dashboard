"""
Overlapping work time: when one person's logged time ranges intersect.

Two ranges of the *same person* overlap when their open intervals intersect
on the same date: 09:00-10:00 and 10:00-11:00 only touch, which is not an
overlap. A person's time is their work-log entries, manual and auto (auto
entries mirror the ticket activities they resolved, see sync.py), so one rule
covers both: everything is compared as entries (a date plus start and end
times in that person's own zone). Two different people working at the same
time is never an overlap; callers only ever compare one person's ranges.

Overlap is advisory, not a cap: a save that overlaps needs an explicit
confirmation (the API answers 409 until it gets one), and once confirmed the
time is counted twice in every total, exactly as before. Read-time flags
(`covered_minutes`, `double_counted_minutes`) keep confirmed overlaps
visible afterwards.

The first half of this module is pure (no database). The service functions
at the end load a person's existing entries in one query.
"""

from collections import defaultdict
from collections.abc import Hashable, Iterable, Sequence
from dataclasses import dataclass, field
from datetime import date, time
from typing import TYPE_CHECKING, Any

from rest_framework import status
from rest_framework.exceptions import APIException

from tickets.models import ticket_label

from .models import WorkLogEntry, minutes_of_day

if TYPE_CHECKING:
    from accounts.models import User


# --- Pure ----------------------------------------------------------------------


@dataclass(frozen=True)
class TimeRange:
    """
    One block of time on one date: start < end, both on `day`. `ref` is an
    opaque label for the caller (an entry, an activity's index...) and takes
    no part in comparisons.
    """

    day: date
    start: time
    end: time
    ref: Any = field(default=None, compare=False, hash=False)

    def __post_init__(self):
        if minutes_of_day(self.end) <= minutes_of_day(self.start):
            raise ValueError(f"A time range must end after it starts ({self.start}-{self.end}).")

    @property
    def minutes(self) -> int:
        return minutes_of_day(self.end) - minutes_of_day(self.start)


def _clock(minutes: int) -> time:
    return time(minutes // 60, minutes % 60)


def overlap_window(a: TimeRange, b: TimeRange) -> tuple[int, int] | None:
    """The shared (start, end) minutes of the day, or None (other date, apart, or only touching)."""
    if a.day != b.day:
        return None
    start = max(minutes_of_day(a.start), minutes_of_day(b.start))
    end = min(minutes_of_day(a.end), minutes_of_day(b.end))
    return (start, end) if end > start else None


def overlap_minutes(a: TimeRange, b: TimeRange) -> int:
    """Minutes two ranges share: 0 when they're on different dates or only touch. Symmetric."""
    window = overlap_window(a, b)
    return window[1] - window[0] if window else 0


class Kind:
    """What the conflicting range is (the API's `kind`)."""

    MANUAL_ENTRY = "manual_entry"
    TICKET_ACTIVITY = "ticket_activity"
    SAME_REQUEST = "same_request"


@dataclass(frozen=True)
class Overlap:
    """`candidate` (being saved) overlaps `other` from `start` to `end`."""

    candidate: TimeRange
    other: TimeRange
    start: time
    end: time
    minutes: int
    # True when `other` is part of the same request (a sibling activity).
    same_request: bool = False


def _overlap(candidate: TimeRange, other: TimeRange, *, same_request: bool) -> Overlap | None:
    window = overlap_window(candidate, other)
    if window is None:
        return None
    return Overlap(candidate, other, _clock(window[0]), _clock(window[1]), window[1] - window[0], same_request)


def find_overlaps(
    candidates: Sequence[TimeRange],
    existing: Iterable[TimeRange],
    peers: Iterable[TimeRange] = (),
) -> list[Overlap]:
    """
    Every overlap involving one person's `candidates` (new or changed ranges):

    * each candidate against each of the person's `existing` ranges;
    * candidates against each other (the same request), each pair once;
    * candidates against `peers`: unchanged ranges sent in the same request,
      which aren't checked themselves (a pair of two peers is never reported).

    Ordered by candidate, then by when the conflicting range starts.
    """
    existing, peers = list(existing), list(peers)
    found: list[Overlap] = []
    for index, candidate in enumerate(candidates):
        mine: list[Overlap] = []
        for other in existing:
            if hit := _overlap(candidate, other, same_request=False):
                mine.append(hit)
        # Later candidates only: the pair (i, j) is reported once, under i.
        for other in [*candidates[index + 1 :], *peers]:
            if hit := _overlap(candidate, other, same_request=True):
                mine.append(hit)
        mine.sort(key=lambda o: (minutes_of_day(o.other.start), minutes_of_day(o.other.end)))
        found.extend(mine)
    return found


def _union_minutes(spans: Iterable[tuple[int, int]]) -> int:
    total, current_start, current_end = 0, None, None
    for start, end in sorted(spans):
        if current_end is None or start > current_end:
            if current_end is not None and current_start is not None:
                total += current_end - current_start
            current_start, current_end = start, end
        else:
            current_end = max(current_end, end)
    if current_end is not None and current_start is not None:
        total += current_end - current_start
    return total


def covered_minutes(ranges: Sequence[TimeRange]) -> list[int]:
    """
    For each range (same order), how many of its minutes some *other* range
    also covers (the union of its overlaps, so a minute covered twice counts
    once). Ranges on different dates never interact. 0 = no overlap.
    """
    result = []
    for index, own in enumerate(ranges):
        windows = [w for i, other in enumerate(ranges) if i != index and (w := overlap_window(own, other))]
        result.append(_union_minutes(windows))
    return result


def double_counted_minutes(ranges: Sequence[TimeRange]) -> int:
    """
    Minutes counted more than once when the ranges' lengths are summed (as
    every total does): the sum of the lengths minus the time they cover. For
    09:00-10:00 plus 09:30-10:30 that's 30. Dates are kept apart.
    """
    by_day: dict[date, list[TimeRange]] = defaultdict(list)
    for r in ranges:
        by_day[r.day].append(r)
    total = 0
    for day_ranges in by_day.values():
        spans = [(minutes_of_day(r.start), minutes_of_day(r.end)) for r in day_ranges]
        total += sum(r.minutes for r in day_ranges) - _union_minutes(spans)
    return total


# --- Service (database) ----------------------------------------------------------


def entry_range(entry, ref: Hashable | None = None) -> TimeRange | None:
    """A work-log entry as a range (None for a zero-length one, which can't overlap)."""
    if minutes_of_day(entry.end_time) <= minutes_of_day(entry.start_time):
        return None
    return TimeRange(entry.date, entry.start_time, entry.end_time, ref=entry if ref is None else ref)


@dataclass(frozen=True)
class PersonCandidate:
    """A range of `user`'s time in a request (being saved, or sent unchanged as a peer)."""

    user: "User"
    range: TimeRange


def person_overlaps(
    candidates: Sequence[PersonCandidate],
    *,
    peers: Sequence[PersonCandidate] = (),
    exclude_entry_ids: Iterable[int] | Any = (),
    exclude_activity_ids: Iterable[int] | Any | None = None,
) -> list[tuple["User", Overlap]]:
    """
    Overlaps of the candidates with their own person's existing entries on the
    same dates (manual and auto), and with each other / their `peers` for the
    same person. Existing entries with an id in `exclude_entry_ids`, or mirrored
    from an activity in `exclude_activity_ids` (the record being replaced), are
    left out, so a record never overlaps itself. Either may be a queryset of
    ids (used as a subquery).

    One query, however many candidates and people: every (person, date) pair
    is fetched at once through the (user, date) index.
    """
    if not candidates:
        return []
    user_ids = {c.user.pk for c in candidates}
    days = {c.range.day for c in candidates}
    rows = (
        WorkLogEntry.objects.filter(user_id__in=user_ids, date__in=days)
        .exclude(pk__in=exclude_entry_ids)
        .select_related("ticket_activity__ticket")
        .order_by("date", "start_time", "id")
    )
    if exclude_activity_ids is not None:
        rows = rows.exclude(ticket_activity_id__in=exclude_activity_ids)

    existing: dict[int, list[TimeRange]] = defaultdict(list)
    for entry in rows:
        if (r := entry_range(entry)) is not None:
            existing[entry.user_id].append(r)

    people = {c.user.pk: c.user for c in candidates}
    found: list[tuple[User, Overlap]] = []
    for user_id, user in people.items():
        mine = [c.range for c in candidates if c.user.pk == user_id]
        siblings = [p.range for p in peers if p.user.pk == user_id]
        found.extend((user, o) for o in find_overlaps(mine, existing[user_id], siblings))
    return found


def covered_minutes_by_entry(entries: Sequence) -> dict[int, int]:
    """
    Each entry's overlapping minutes (see covered_minutes) against *all* of
    its owner's entries on its date, listed or not. One query for the whole
    list: the listed entries' (owner, date) pairs are loaded at once.
    """
    entries = [e for e in entries if e.pk is not None]
    if not entries:
        return {}
    users = {e.user_id for e in entries}
    days = {e.date for e in entries}
    wanted = {(e.user_id, e.date) for e in entries}
    groups: dict[tuple[int, date], list[TimeRange]] = defaultdict(list)
    rows = WorkLogEntry.objects.filter(user_id__in=users, date__in=days).values_list(
        "pk", "user_id", "date", "start_time", "end_time"
    )
    for pk, user_id, day, start, end in rows:
        if (user_id, day) in wanted and minutes_of_day(end) > minutes_of_day(start):
            groups[(user_id, day)].append(TimeRange(day, start, end, ref=pk))

    result: dict[int, int] = {}
    for ranges in groups.values():
        for r, minutes in zip(ranges, covered_minutes(ranges), strict=True):
            result[r.ref] = minutes
    return result


# --- The API's 409 ---------------------------------------------------------------

CONFIRM_FIELD_HELP = (
    "Set to true to save even though the time overlaps other work the same person logged "
    "(otherwise such a save is refused with 409). Never stored."
)


def _hhmm(value: time) -> str:
    return value.strftime("%H:%M")


def _label(overlap: Overlap) -> str:
    if overlap.same_request:
        return f"Activity {overlap.other.ref}"
    entry = overlap.other.ref
    if entry.ticket_activity_id:
        activity = entry.ticket_activity
        return f"{ticket_label(activity.ticket)} ({activity.get_activity_type_display()})"
    return f"Manual entry ({entry.note})" if entry.note else "Manual entry"


def _kind(overlap: Overlap) -> str:
    if overlap.same_request:
        return Kind.SAME_REQUEST
    return Kind.TICKET_ACTIVITY if overlap.other.ref.ticket_activity_id else Kind.MANUAL_ENTRY


def overlap_item(user: "User", overlap: Overlap) -> dict:
    """One overlap as the 409 body lists it."""
    candidate, other = overlap.candidate, overlap.other
    kind = _kind(overlap)
    return {
        "kind": kind,
        "person": {"id": user.pk, "name": user.display_name},
        "date": candidate.day.isoformat(),
        "start": _hhmm(candidate.start),
        "end": _hhmm(candidate.end),
        "conflicting_start": _hhmm(other.start),
        "conflicting_end": _hhmm(other.end),
        "overlap_start": _hhmm(overlap.start),
        "overlap_end": _hhmm(overlap.end),
        "overlap_minutes": overlap.minutes,
        "label": _label(overlap),
        # 1-based positions in the request's `activities` (ticket saves only).
        "activity": candidate.ref if isinstance(candidate.ref, int) else None,
        "conflicting_activity": other.ref if overlap.same_request else None,
        "conflicting_ticket": other.ref.ticket_activity.ticket_id if kind == Kind.TICKET_ACTIVITY else None,
    }


class OverlapConfirmationRequired(APIException):
    """
    409: the save overlaps the person's other logged time and wasn't
    confirmed. The body is {code, detail, overlaps: [...]}; resending the same
    request with `confirm_overlaps: true` saves it.
    """

    status_code = status.HTTP_409_CONFLICT
    default_code = "overlap_confirmation_required"
    default_detail = (
        "This time overlaps other work logged by the same person. "
        "Check the overlaps, then resend with confirm_overlaps set to true to save anyway."
    )

    def __init__(self, found: Sequence[tuple["User", Overlap]]):
        super().__init__()
        # Set after APIException.__init__, which would turn every value
        # (overlap_minutes included) into a string.
        body: dict[str, Any] = {
            "code": self.default_code,
            "detail": str(self.default_detail),
            "overlaps": [overlap_item(user, o) for user, o in found],
        }
        self.detail = body


def require_confirmation(found: Sequence[tuple["User", Overlap]], confirmed: bool) -> int:
    """Raise the 409 for unconfirmed overlaps; otherwise return how many were confirmed."""
    if found and not confirmed:
        raise OverlapConfirmationRequired(found)
    return len(found)
