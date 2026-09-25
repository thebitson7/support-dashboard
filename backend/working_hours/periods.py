"""The reporting periods shown on the working-hours summary, and their totals."""

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal

from django.db.models import Q, Sum
from django.utils import timezone

from .models import WorkLogEntry

# Fixed goals (hours), matching the Home dashboard's pattern.
DAY_GOAL = Decimal(8)
WEEK_GOAL = Decimal(40)
MONTH_GOAL = Decimal(176)


@dataclass(frozen=True)
class Period:
    key: str
    label: str
    start: date
    end: date  # inclusive
    goal_hours: Decimal


def local_today(user, now: datetime | None = None) -> date:
    """Today's date in `user`'s time zone (not the server's UTC date)."""
    return (now or timezone.now()).astimezone(user.tzinfo).date()


def _month_bounds(day: date) -> tuple[date, date]:
    start = day.replace(day=1)
    next_month = (start + timedelta(days=32)).replace(day=1)
    return start, next_month - timedelta(days=1)


def build_periods(today: date) -> list[Period]:
    """Today, Yesterday, Current/Last Week (Mon–Sun), Current/Previous Month."""
    yesterday = today - timedelta(days=1)
    week_start = today - timedelta(days=today.weekday())
    month_start, month_end = _month_bounds(today)
    prev_month_start, prev_month_end = _month_bounds(month_start - timedelta(days=1))
    return [
        Period("today", "Today", today, today, DAY_GOAL),
        Period("yesterday", "Yesterday", yesterday, yesterday, DAY_GOAL),
        Period("currentWeek", "Current Week", week_start, week_start + timedelta(days=6), WEEK_GOAL),
        Period(
            "lastWeek",
            "Last Week",
            week_start - timedelta(days=7),
            week_start - timedelta(days=1),
            WEEK_GOAL,
        ),
        Period("currentMonth", "Current Month", month_start, month_end, MONTH_GOAL),
        Period("previousMonth", "Previous Month", prev_month_start, prev_month_end, MONTH_GOAL),
    ]


def _hours(value: Decimal | None) -> float:
    return float(round(value or Decimal(0), 2))


def summarize(user, today: date) -> list[dict]:
    """
    Aggregates every period's AMS / Non-AMS hours for `user` in a single query.
    `today` anchors the periods; callers pass it in the viewer's time zone.
    """
    periods = build_periods(today)
    aggregates = {}
    for p in periods:
        in_range = Q(date__range=(p.start, p.end))
        for category in WorkLogEntry.Category:
            aggregates[f"{p.key}__{category.value}"] = Sum(
                "hours", filter=in_range & Q(category=category)
            )

    totals = WorkLogEntry.objects.filter(
        user=user,
        date__gte=min(p.start for p in periods),
        date__lte=max(p.end for p in periods),
    ).aggregate(**aggregates)

    result = []
    for p in periods:
        ams = totals[f"{p.key}__{WorkLogEntry.Category.AMS}"] or Decimal(0)
        non_ams = totals[f"{p.key}__{WorkLogEntry.Category.NON_AMS}"] or Decimal(0)
        total = ams + non_ams
        result.append(
            {
                "key": p.key,
                "label": p.label,
                "start_date": p.start.isoformat(),
                "end_date": p.end.isoformat(),
                "total_hours": _hours(total),
                "goal_hours": _hours(p.goal_hours),
                "ams_hours": _hours(ams),
                "non_ams_hours": _hours(non_ams),
                # Can exceed 100 when the goal is beaten.
                "percent_complete": round(total / p.goal_hours * 100) if p.goal_hours else 0,
            }
        )
    return result
