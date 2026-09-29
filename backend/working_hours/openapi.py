"""
Response shapes for the API documentation only (drf-spectacular).

The summary and report views build these dicts directly (see periods.py,
totals.Totals.as_dict and reports/views.py); these serializers exist so the
OpenAPI schema describes them. Nothing uses them at runtime, so keep them in
step with those dicts when either changes.
"""

from rest_framework import serializers

from accounts.serializers import UserSummarySerializer
from working_hours.serializers import WorkLogEntrySerializer


class TotalsFigures(serializers.Serializer):
    """Exact minutes (add and display these) and the same in hours to 2 decimals."""

    total_minutes = serializers.IntegerField()
    ams_minutes = serializers.IntegerField()
    non_ams_minutes = serializers.IntegerField()
    total_hours = serializers.FloatField()
    ams_hours = serializers.FloatField()
    non_ams_hours = serializers.FloatField()


class Totals(TotalsFigures):
    entry_count = serializers.IntegerField()


class Period(TotalsFigures):
    key = serializers.ChoiceField(
        choices=["today", "yesterday", "currentWeek", "lastWeek", "currentMonth", "previousMonth"]
    )
    # A field named `label` shadows Field.label in the stubs; DRF's metaclass
    # moves declared fields off the class, so at runtime there's no clash.
    label = serializers.CharField()  # type: ignore[assignment]
    start_date = serializers.DateField(help_text="Inclusive.")
    end_date = serializers.DateField(help_text="Inclusive.")
    goal_minutes = serializers.IntegerField()
    goal_hours = serializers.FloatField()
    percent_complete = serializers.IntegerField(help_text="Can exceed 100 when the goal is beaten.")


class WorkingHoursSummary(serializers.Serializer):
    user = UserSummarySerializer()
    timezone = serializers.CharField(help_text="The viewer's zone, in which the periods were cut.")
    periods = Period(many=True)


# --- Reports: team activity ---------------------------------------------------------


class TeamMember(Totals):
    user = UserSummarySerializer()
    is_active = serializers.BooleanField()


class TeamTotals(Totals):
    member_count = serializers.IntegerField()


class _ReportRange(serializers.Serializer):
    start_date = serializers.DateField()
    end_date = serializers.DateField()
    timezone = serializers.CharField(help_text="The requesting admin's zone (cuts the default range).")


class TeamActivity(_ReportRange):
    """Without `user_id`: every active staff member, plus the team's totals."""

    members = TeamMember(many=True)
    totals = TeamTotals()


class MemberActivity(_ReportRange):
    """With `user_id`: that person's totals and every entry in the range."""

    member = TeamMember()
    entries = WorkLogEntrySerializer(many=True)
