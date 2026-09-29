"""
The audit log API, admin role only: the list (filters, search, paging,
ordering), its CSV export (same filters, every matching row) and the action
choices the filter offers.
"""

import json
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import F, Q
from django.utils.dateparse import parse_date
from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import (
    OpenApiParameter,
    OpenApiResponse,
    extend_schema,
    extend_schema_view,
    inline_serializer,
)
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminRole
from accounts.throttling import ExportRateThrottle
from core.exports import csv_response, text_cell
from working_hours.periods import local_today

from .models import ACTION_GROUPS, AuditLogEntry

DEFAULT_DAYS = 30
# Ids beyond this overflow the database integer type (a 500, not a 400).
MAX_ID = 2**63 - 1
ORDERINGS = {
    "created_at": "created_at",
    "actor": "actor_username",
    "action": "action",
    "target": "target_type",
}


class AuditPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200

    def get_paginated_response_schema(self, schema):
        # Documents the range AuditLogListView.list() adds to each page.
        response = super().get_paginated_response_schema(schema)
        for name in ("start_date", "end_date"):
            response["properties"][name] = {
                "type": "string",
                "format": "date",
                "description": "The date range actually applied (defaults filled in).",
            }
        return response


class AuditLogEntrySerializer(serializers.ModelSerializer):
    action_label = serializers.CharField(source="get_action_display")

    class Meta:
        model = AuditLogEntry
        fields = [
            "id",
            "created_at",
            "actor",
            "actor_username",
            "action",
            "action_label",
            "target_type",
            "target_id",
            "target_label",
            "description",
            "metadata",
            "ip_address",
        ]
        read_only_fields = fields


def _day(params, name):
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


def date_range(request):
    """start_date / end_date (inclusive days in the admin's own zone); default: the last 30 days."""
    today = local_today(request.user)
    end = _day(request.query_params, "end_date") or today
    start = _day(request.query_params, "start_date") or end - timedelta(days=DEFAULT_DAYS - 1)
    if start > end:
        raise ValidationError({"end_date": "The end date must be on or after the start date."})
    return start, end


def filtered_entries(request):
    """
    The log for a set of query params, shared by the list and its CSV export
    so the two can never disagree: actor, action (comma-separated for
    several), target_type + target_id, a date range, free-text search and an
    ordering.
    """
    params = request.query_params
    tz = request.user.tzinfo
    start, end = date_range(request)
    # Whole days in the admin's zone, as instants.
    since = datetime.combine(start, time.min, tzinfo=tz)
    until = datetime.combine(end + timedelta(days=1), time.min, tzinfo=tz)
    qs = AuditLogEntry.objects.filter(created_at__gte=since, created_at__lt=until)

    actor = params.get("actor")
    if actor:
        if not (actor.isascii() and actor.isdigit()) or not 0 < int(actor) <= MAX_ID:
            raise ValidationError({"actor": "Must be a user id."})
        qs = qs.filter(actor_id=int(actor))

    actions = [a.strip() for a in params.get("action", "").split(",") if a.strip()]
    if actions:
        unknown = sorted(set(actions) - set(AuditLogEntry.Action.values))
        if unknown:
            raise ValidationError({"action": f"Unknown action(s): {', '.join(unknown)}."})
        qs = qs.filter(action__in=actions)

    if params.get("target_type"):
        qs = qs.filter(target_type=params["target_type"])
    if params.get("target_id"):
        qs = qs.filter(target_id=params["target_id"])

    term = params.get("search", "").strip()
    if term:
        qs = qs.filter(
            Q(description__icontains=term) | Q(actor_username__icontains=term) | Q(target_label__icontains=term)
        )

    raw = params.get("ordering") or "-created_at"
    key = raw.lstrip("-")
    if key not in ORDERINGS:
        raise ValidationError({"ordering": f"Unknown ordering “{raw}”."})
    descending = raw.startswith("-")
    field = F(ORDERINGS[key])
    order = field.desc() if descending else field.asc()
    # Ties: newest first, except when sorting by time itself (then the same direction).
    tiebreak: tuple[str, ...] = ("-id",) if key != "created_at" or descending else ("id",)
    if key != "created_at":
        tiebreak = ("-created_at", *tiebreak)
    return qs.order_by(order, *tiebreak), start, end


# --- API documentation (drf-spectacular) ------------------------------------------

AUDIT_FILTERS = [
    OpenApiParameter(
        "start_date",
        OpenApiTypes.DATE,
        description=f"Inclusive, in the admin's own zone. Default: {DEFAULT_DAYS - 1} days before `end_date`.",
    ),
    OpenApiParameter(
        "end_date", OpenApiTypes.DATE, description="Inclusive, in the admin's own zone. Default: today."
    ),
    OpenApiParameter("actor", int, description="Only entries by this user id."),
    OpenApiParameter(
        "action",
        str,
        many=True,
        explode=False,
        enum=AuditLogEntry.Action.values,
        description="One or more actions, comma-separated (e.g. `login,logout`). Labels and groups: `/api/audit/logs/actions/`.",
    ),
    OpenApiParameter("target_type", str, description="e.g. `ticket`, `work_log`, `site`, `user`."),
    OpenApiParameter("target_id", str, description="With `target_type`: one record's history."),
    OpenApiParameter("search", str, description="Case-insensitive match on description, username or target."),
    OpenApiParameter(
        "ordering",
        str,
        enum=[f"{sign}{key}" for key in ORDERINGS for sign in ("", "-")],
        description="`-` prefix for descending. Default `-created_at` (newest first).",
    ),
]


@extend_schema_view(get=extend_schema(summary="List audit log entries (admin only)", parameters=AUDIT_FILTERS))
class AuditLogListView(ListAPIView):
    """GET: the audit log, newest first by default (see filtered_entries)."""

    permission_classes = [IsAuthenticated, IsAdminRole]
    serializer_class = AuditLogEntrySerializer
    pagination_class = AuditPagination

    def get_queryset(self):
        qs, *self.dates = filtered_entries(self.request)
        return qs

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        # The range actually applied (defaults filled in), for the page's header.
        start, end = self.dates
        response.data["start_date"], response.data["end_date"] = start.isoformat(), end.isoformat()
        return response


@extend_schema(
    summary="Export the audit log as CSV (admin only)",
    parameters=[
        *AUDIT_FILTERS,
        OpenApiParameter(
            "tz", str, description="IANA zone for the timestamps. Default: the admin's profile zone."
        ),
    ],
    request=None,
    responses={
        (200, "text/csv"): OpenApiResponse(OpenApiTypes.BINARY, description="A UTF-8 CSV file (attachment)."),
        400: OpenApiResponse(description="An invalid filter, named in the body."),
        429: OpenApiResponse(description="Export rate limit reached; see `Retry-After`."),
    },
)
class AuditLogExportView(APIView):
    """
    GET: the same filtered log as CSV, every matching row, rate limited like
    the other exports. Timestamps in `tz` (the browser's zone, as on screen)
    or the admin's profile zone, named in the header.
    """

    permission_classes = [IsAuthenticated, IsAdminRole]
    throttle_classes = [ExportRateThrottle]

    def get(self, request):
        requested = request.query_params.get("tz")
        if requested:
            try:
                tz = ZoneInfo(requested)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValidationError({"tz": "Use an IANA time zone name, e.g. Asia/Kuala_Lumpur."})
        else:
            tz = request.user.tzinfo
        entries, start, end = filtered_entries(request)
        header = [
            f"Timestamp ({tz.key})",
            "User",
            "Action",
            "Description",
            "Target",
            "Target type",
            "Target ID",
            "IP address",
            "Details",
        ]
        rows = (
            [
                e.created_at.astimezone(tz).strftime("%Y-%m-%d %H:%M:%S"),
                text_cell(e.actor_username),
                e.get_action_display(),
                text_cell(e.description),
                text_cell(e.target_label),
                e.target_type,
                text_cell(e.target_id),
                text_cell(e.ip_address),
                text_cell(json.dumps(e.metadata, ensure_ascii=False, default=str)) if e.metadata else "",
            ]
            for e in entries.iterator(chunk_size=500)
        )
        return csv_response(f"audit-log_{start}_{end}.csv", header, rows)


@extend_schema(
    summary="List audit actions (admin only)",
    request=None,
    responses=inline_serializer(
        "AuditAction",
        {
            "value": serializers.ChoiceField(choices=AuditLogEntry.Action.choices),
            "label": serializers.CharField(),
            "group": serializers.ChoiceField(choices=list(ACTION_GROUPS)),
        },
        many=True,
    ),
)
class AuditActionListView(APIView):
    """GET: every action the log records, with its label and group, for the filter."""

    permission_classes = [IsAuthenticated, IsAdminRole]

    def get(self, request):
        labels = dict(AuditLogEntry.Action.choices)
        return Response(
            [
                {"value": value, "label": labels[value], "group": group}
                for group, values in ACTION_GROUPS.items()
                for value in values
            ]
        )
