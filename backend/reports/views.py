"""
Reports: read-only, report-shaped views over data other apps own (work logs
here; the tickets report reuses the tickets list and its export). Nothing in
this app writes.
"""

from datetime import date, timedelta

from django.db.models import Q
from django.utils.dateparse import parse_date
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import IsAdminRole
from accounts.serializers import UserSummarySerializer
from core.exports import csv_response, text_cell
from working_hours.models import WorkLogEntry
from working_hours.periods import local_today
from working_hours.serializers import WorkLogEntrySerializer
from working_hours.sync import ticket_reference
from working_hours.totals import Totals, entry_minutes, total_expressions

# A year (plus a leap day) at most per request: plenty for any report, and
# it keeps one response (entries included) a reasonable size.
MAX_RANGE_DAYS = 366
# Ids beyond this overflow the database integer type (a 500, not a 400).
MAX_ID = 2**63 - 1

def _parse_day(params, name: str) -> date | None:
    raw = params.get(name)
    if not raw:
        return None
    try:
        value = parse_date(raw)
    except ValueError:  # well-formed but impossible, e.g. 2026-02-30
        value = None
    if value is None:
        raise ValidationError({name: "Use a YYYY-MM-DD date."})
    return value


def report_range(request) -> tuple[date, date]:
    """
    start_date / end_date (inclusive). Each defaults to the current month's
    first / last day in the *requesting admin's* time zone, the same
    viewer-zone rule as the period summaries.
    """
    today = local_today(request.user)
    month_start = today.replace(day=1)
    month_end = (month_start + timedelta(days=32)).replace(day=1) - timedelta(days=1)
    start = _parse_day(request.query_params, "start_date") or month_start
    end = _parse_day(request.query_params, "end_date") or month_end
    if start > end:
        raise ValidationError({"end_date": "The end date must be on or after the start date."})
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise ValidationError({"end_date": f"Choose a range of at most {MAX_RANGE_DAYS} days."})
    return start, end


def report_user(request) -> User | None:
    """
    The optional `user_id` drill-down. Unlike the working-hours endpoints, a
    deactivated user is still found here: their logged history is kept, and
    a report is where it's looked up.
    """
    raw = request.query_params.get("user_id")
    if raw is None:
        return None
    raw = raw.strip()
    # isascii() matters: str.isdigit() accepts "²", which int() rejects.
    if not (raw.isascii() and raw.isdigit()) or not 0 < int(raw) <= MAX_ID:
        raise ValidationError({"user_id": "Must be a positive integer user id."})
    user = User.objects.filter(pk=int(raw)).first()
    if user is None:
        raise NotFound("User not found.")
    return user


def _member(user, totals: Totals) -> dict:
    return {"user": UserSummarySerializer(user).data, "is_active": user.is_active, **totals.as_dict()}


class TeamActivityView(APIView):
    """
    GET ?start_date=&end_date=&user_id=  (admin role only)

    Without user_id: every active staff member's totals for the range (people
    who logged nothing included, with zeros), plus the team's totals. One
    grouped query, however many people.

    With user_id: that person's totals and every entry in the range (the Job
    Sheet's entry shape: auto entries carry is_auto / ticket_reference), in
    date and time order. Works for deactivated users too.

    Entry dates are the logger's own calendar dates, as stored; only the
    default range is cut in the admin's zone (see `timezone`).
    """

    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        start, end = report_range(request)
        target = report_user(request)
        base = {
            "start_date": start.isoformat(),
            "end_date": end.isoformat(),
            "timezone": request.user.timezone,
        }
        if target is not None:
            return Response({**base, **self._one(target, start, end)})
        return Response({**base, **self._everyone(start, end)})

    @staticmethod
    def _everyone(start, end) -> dict:
        people = (
            User.objects.filter(role=User.Role.STAFF, is_active=True)
            .annotate(**total_expressions("work_logs__", Q(work_logs__date__range=(start, end))))
            .order_by("first_name", "last_name", "username")
        )
        members, team = [], Totals()
        for person in people:
            totals = Totals.of(person)
            members.append(_member(person, totals))
            team += totals  # the totals row is exactly the rows above it
        return {"members": members, "totals": {"member_count": len(members), **team.as_dict()}}

    @staticmethod
    def _one(user, start, end) -> dict:
        entries = WorkLogEntry.objects.filter(user=user, date__range=(start, end))
        rows = entries.select_related("ticket_activity__ticket").order_by("date", "start_time", "id")
        return {
            "member": _member(user, Totals.of(entries.aggregate(**total_expressions()))),
            "entries": WorkLogEntrySerializer(rows, many=True).data,
        }


class TeamActivityExportView(APIView):
    """
    GET ?start_date=&end_date=&user_id=  (admin role only): the same range
    and person rules as TeamActivityView, as a CSV of entries, one per row,
    ordered by person, date and start time.

    Minutes is each entry's exact length and adds up to the report's totals.
    Hours is the same length to 2 decimal places, for reading; a column of
    rounded hours can be a minute or two off when summed.
    """

    permission_classes = [IsAuthenticated, IsAdminRole]
    HEADER = ["User", "Date", "Start Time", "End Time", "Category", "Hours", "Minutes", "Source", "Note"]

    def get(self, request):
        start, end = report_range(request)
        target = report_user(request)
        if target is not None:
            entries = WorkLogEntry.objects.filter(user=target)
            name = f"team-activity_{target.username}_{start}_{end}.csv"
        else:
            entries = WorkLogEntry.objects.filter(user__role=User.Role.STAFF, user__is_active=True)
            name = f"team-activity_{start}_{end}.csv"
        entries = (
            entries.filter(date__range=(start, end))
            .select_related("user", "ticket_activity__ticket")
            .order_by("user__first_name", "user__last_name", "user__username", "date", "start_time", "id")
        )
        rows = (self._row(e) for e in entries.iterator(chunk_size=500))
        return csv_response(name, self.HEADER, rows)

    @staticmethod
    def _row(entry) -> list:
        minutes = entry_minutes(entry)
        return [
            text_cell(entry.user.display_name),
            entry.date.isoformat(),
            entry.start_time.strftime("%H:%M"),
            entry.end_time.strftime("%H:%M"),
            entry.get_category_display(),
            f"{minutes / 60:.2f}",
            str(minutes),
            text_cell(ticket_reference(entry.ticket_activity)) if entry.is_auto else "Manual",
            # Auto entries' note is only a copy of the ticket reference (Source).
            "" if entry.is_auto else text_cell(entry.note),
        ]
