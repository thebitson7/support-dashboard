"""
Work-time totals: the one place logged time is added up, for the period
summary (Working Hours) and the reports alike, so they can't disagree.

Totals are summed from each entry's start/end *times*, in exact minutes, by
the database. They are never summed from the stored `hours` column: that is
rounded per entry to 0.01 h, so adding it up drifts (six 20-minute entries
are 6 x 0.33 = 1.98 h, not 2 h), and the overview would disagree with the
drill-down, which is built from the same entries' times. Hours are derived
from the exact minutes only at the very end, for display.
"""

from dataclasses import dataclass
from datetime import timedelta

from django.db.models import Count, DurationField, ExpressionWrapper, F, Q, Sum

from .models import WorkLogEntry, minutes_of_day

AMS = WorkLogEntry.Category.AMS
NON_AMS = WorkLogEntry.Category.NON_AMS


def entry_minutes(entry: WorkLogEntry) -> int:
    """One entry's exact length, by the same rule the aggregates use."""
    return max(0, minutes_of_day(entry.end_time) - minutes_of_day(entry.start_time))


def total_expressions(prefix: str = "", within: Q | None = None) -> dict:
    """
    Aggregate expressions for .aggregate() / .annotate(): total, AMS and
    Non-AMS time (as durations) and the entry count. `prefix` reaches the
    entries through a relation (e.g. "work_logs__" from User); `within`
    restricts which entries count (e.g. a date range), applied to all four.
    """
    within = within or Q()
    span = ExpressionWrapper(
        F(f"{prefix}end_time") - F(f"{prefix}start_time"), output_field=DurationField()
    )
    category = f"{prefix}category"
    return {
        "total": Sum(span, filter=within),
        "ams": Sum(span, filter=within & Q(**{category: AMS})),
        "non_ams": Sum(span, filter=within & Q(**{category: NON_AMS})),
        "count": Count(f"{prefix}id", filter=within),
    }


def _minutes(value: timedelta | None) -> int:
    return round(value.total_seconds() / 60) if value else 0


def _hours(minutes: int) -> float:
    return round(minutes / 60, 2)


@dataclass(frozen=True)
class Totals:
    total_minutes: int = 0
    ams_minutes: int = 0
    non_ams_minutes: int = 0
    entry_count: int = 0

    @classmethod
    def of(cls, row) -> "Totals":
        """From an aggregate dict, or an object annotated with total_expressions()."""
        get = row.get if isinstance(row, dict) else lambda key: getattr(row, key)
        return cls(
            total_minutes=_minutes(get("total")),
            ams_minutes=_minutes(get("ams")),
            non_ams_minutes=_minutes(get("non_ams")),
            entry_count=get("count") or 0,
        )

    def __add__(self, other: "Totals") -> "Totals":
        return Totals(
            self.total_minutes + other.total_minutes,
            self.ams_minutes + other.ams_minutes,
            self.non_ams_minutes + other.non_ams_minutes,
            self.entry_count + other.entry_count,
        )

    def as_dict(self) -> dict:
        """Exact minutes (what the UI adds and shows) plus hours derived from them."""
        return {
            "total_minutes": self.total_minutes,
            "ams_minutes": self.ams_minutes,
            "non_ams_minutes": self.non_ams_minutes,
            "total_hours": _hours(self.total_minutes),
            "ams_hours": _hours(self.ams_minutes),
            "non_ams_hours": _hours(self.non_ams_minutes),
            "entry_count": self.entry_count,
        }
