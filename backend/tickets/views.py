import json
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.db.models import Case, F, Q, Value, When
from django.db.models.functions import Concat
from django.http import QueryDict
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from rest_framework.exceptions import ValidationError
from rest_framework.generics import ListAPIView, ListCreateAPIView, RetrieveUpdateAPIView
from rest_framework.pagination import PageNumberPagination
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.permissions import IsAdminRoleOrReadOnly
from core.exports import csv_response, text_cell

from .models import Customer, Site, Ticket, WorkDoneCode
from .serializers import (
    CustomerSerializer,
    SiteSerializer,
    TicketDetailSerializer,
    TicketListSerializer,
    TicketWriteSerializer,
    WorkDoneCodeSerializer,
)

# Ticket endpoints only need authentication (the project default): any
# signed-in staff member or admin may list, create and edit any ticket. A
# deliberate, revisitable decision; role rules can be layered on later.
# Reference data is the exception: the form's site/customer quick-add follows
# the Lookups rule (anyone reads, only admins create).

TYPEAHEAD_LIMIT = 20
# Largest id the database integer column can hold.
MAX_ID = 2**63 - 1


class TicketPagination(PageNumberPagination):
    page_size = 50
    page_size_query_param = "page_size"
    max_page_size = 200


def person_name(prefix: str):
    """A user's "First Last" as a query expression, so full names are searchable."""
    return Concat(f"{prefix}__first_name", Value(" "), f"{prefix}__last_name")


def person_ordering(prefix: str) -> list[str]:
    return [f"{prefix}__first_name", f"{prefix}__last_name", f"{prefix}__username"]


# `ordering` keys (the table's column ids, snake_case) -> database orderings.
# `status` is not a column: it's derived from cms_closed_on, so it's
# annotated as "open"/"closed" and sorted by that label (same order the UI
# shows: Closed before Open ascending).
ORDERINGS = {
    "site_name": ["site__name"],
    "site_ocn": ["site__ocn"],
    "cms_next_ticket_no": ["cms_next_ticket_no"],
    "received_at": ["received_at"],
    "status": ["status_label"],
    "cms_closed_by": person_ordering("cms_closed_by"),
    "created_by": person_ordering("created_by"),
    "total_duration_hours": ["total_duration_hours"],
    "cms_closed_on": ["cms_closed_on"],
    "service_closed_date": ["service_closed_date"],
}
DEFAULT_ORDERING = "-received_at"


def parse_ordering(raw: str) -> list:
    """Turns e.g. "-received_at" into DB orderings. Empty values always sort last."""
    key = raw.lstrip("-")
    if key not in ORDERINGS:
        raise ValidationError({"ordering": f"Unknown ordering “{raw}”."})
    descending = raw.startswith("-")
    return [
        F(field).desc(nulls_last=True) if descending else F(field).asc(nulls_last=True)
        for field in ORDERINGS[key]
    ] + [F("id").desc()]  # stable tiebreaker, so pages never overlap


def parse_instant(params, name: str):
    raw = params.get(name)
    if not raw:
        return None
    try:
        value = parse_datetime(raw)
    except ValueError:  # well-formed but impossible, e.g. 30 February
        value = None
    if value is None or value.tzinfo is None:
        raise ValidationError({name: "Use an ISO 8601 date-time with a UTC offset."})
    return value


def filtered_tickets(params):
    """
    The tickets table's rows for a set of query params (filters, search,
    ordering; no paging), shared by the list and its CSV export so the two
    can never disagree.
    """
    qs = Ticket.objects.select_related("site", "cms_closed_by", "created_by").annotate(
        status_label=Case(
            When(cms_closed_on__isnull=False, then=Value("closed")), default=Value("open")
        )
    )

    status = params.get("status")
    if status:
        if status not in ("open", "closed"):
            raise ValidationError({"status": "Use “open” or “closed”."})
        qs = qs.filter(status_label=status)

    site = params.get("site")
    if site:
        # Range-checked too: ids past the database integer size are a 400, not a 500.
        if not (site.isascii() and site.isdigit()) or not 0 < int(site) <= MAX_ID:
            raise ValidationError({"site": "Must be a site id."})
        qs = qs.filter(site_id=int(site))

    after = parse_instant(params, "received_after")
    before = parse_instant(params, "received_before")
    if after:
        qs = qs.filter(received_at__gte=after)
    if before:
        qs = qs.filter(received_at__lte=before)

    term = params.get("search", "").strip()
    if term:
        qs = qs.annotate(
            assigned_name=person_name("assigned_to"),
            creator_name=person_name("created_by"),
            closer_name=person_name("cms_closed_by"),
        ).filter(
            Q(site__name__icontains=term)
            | Q(site__ocn__icontains=term)
            | Q(cms_next_ticket_no__icontains=term)
            | Q(status_label__icontains=term)
            | Q(assigned_name__icontains=term)
            | Q(assigned_to__username__icontains=term)
            | Q(creator_name__icontains=term)
            | Q(created_by__username__icontains=term)
            | Q(closer_name__icontains=term)
            | Q(cms_closed_by__username__icontains=term)
        )

    return qs.order_by(*parse_ordering(params.get("ordering") or DEFAULT_ORDERING))


class TicketWriteMixin:
    """Shared by create and update: JSON or multipart bodies, one normalised payload."""

    parser_classes = [JSONParser, MultiPartParser, FormParser]

    def write_payload(self, request):
        if not isinstance(request.data, QueryDict):
            return request.data
        # Multipart has no null: an empty string means "clear this" for
        # fields that can be empty (so an edit can reopen a ticket or remove
        # a recipient), and "not provided" for the rest, which then report
        # "required" as usual.
        fields = TicketWriteSerializer().fields
        data = {}
        for key in request.data:
            value = request.data.get(key)
            if value == "":
                field = fields.get(key)
                if field is None:
                    continue
                if getattr(field, "allow_null", False):
                    value = None
                elif not getattr(field, "allow_blank", False):
                    continue
            data[key] = value
        raw = data.get("activities")
        if isinstance(raw, str):
            try:
                data["activities"] = json.loads(raw)
            except json.JSONDecodeError:
                raise ValidationError({"activities": "Must be a JSON-encoded array."})
        return data


class TicketListCreateView(TicketWriteMixin, ListCreateAPIView):
    """
    GET: the AMS Tickets table, server-side.
      page, page_size (≤200)        pagination (response: count, results, total)
      search                        site name/OCN, CMS no., status, assignee /
                                    creator / closer names (case-insensitive)
      status=open|closed            advanced filter
      site=<id>                     advanced filter
      received_after/received_before  ISO date-times, inclusive
      ordering=<key> or -<key>      see ORDERINGS; default -received_at
    POST: create a ticket (JSON or multipart with an optional `pdf_attachment`;
      in multipart, `activities` is a JSON-encoded array).
    """

    pagination_class = TicketPagination

    def get_serializer_class(self):
        return TicketWriteSerializer if self.request.method == "POST" else TicketListSerializer

    def get_queryset(self):
        return filtered_tickets(self.request.query_params)

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        # Unfiltered total: lets the UI tell "no tickets yet" from "no matches".
        response.data["total"] = Ticket.objects.count()
        return response

    def create(self, request, *args, **kwargs):
        serializer = self.get_serializer(data=self.write_payload(request))
        serializer.is_valid(raise_exception=True)
        ticket = serializer.save(created_by=request.user)
        return Response(serializer.to_representation(ticket), status=201)


class TicketExportView(APIView):
    """
    GET: the tickets table as CSV. Same query params as the list (search,
    status, site, received_after / received_before, ordering; paging is
    ignored), and every matching row, not one page. Open to anyone signed in,
    like the list itself.

    The 11 columns are the table's, in its order. Date-times are written as
    "YYYY-MM-DD HH:MM" (spreadsheets read them as dates) in the zone named in
    their column headings: `tz` (an IANA name) when given, so the file shows
    the same clock times as the table on screen, which renders in the
    browser's zone; otherwise the requester's profile zone.
    """

    def get(self, request):
        requested = request.query_params.get("tz")
        if requested:
            try:
                tz = ZoneInfo(requested)
            except (ZoneInfoNotFoundError, ValueError):
                raise ValidationError({"tz": "Use an IANA time zone name, e.g. Asia/Kuala_Lumpur."})
        else:
            tz = request.user.tzinfo  # falls back safely if the profile's zone is bad
        zone = tz.key

        def when(value):
            return value.astimezone(tz).strftime("%Y-%m-%d %H:%M") if value else ""

        rows = (
            [
                text_cell(t.site.name),
                text_cell(t.site.ocn),
                text_cell(t.cms_next_ticket_no),
                when(t.received_at),
                t.status_label.title(),
                "Yes" if t.is_pre else "No",
                text_cell(t.cms_closed_by.display_name) if t.cms_closed_by else "",
                text_cell(t.created_by.display_name),
                f"{t.total_duration_hours:.2f}",
                when(t.cms_closed_on),
                when(t.service_closed_date),
            ]
            for t in filtered_tickets(request.query_params).iterator(chunk_size=500)
        )
        header = [
            "Site Name",
            "Site OCN",
            "CMS Next Ticket No",
            f"Ticket Received Date Time ({zone})",
            "Status",
            "Pre",
            "Ticket Closed By",
            "Created By",
            "Total Duration (Hours)",
            f"CMS Ticket Closed On ({zone})",
            f"Service Closed Date ({zone})",
        ]
        today = timezone.localdate(timezone=tz)
        return csv_response(f"tickets-{today.isoformat()}.csv", header, rows)


class TicketDetailView(TicketWriteMixin, RetrieveUpdateAPIView):
    """
    GET: one ticket with its activities (pre-fills the edit dialog).
    PATCH / PUT: edit it, under the same validation as creation. Sending
      `activities` replaces the whole set and recomputes the total; clearing
      all five verification fields reopens a closed ticket. `created_by`
      never changes.
    """

    queryset = Ticket.objects.select_related(
        "site",
        "customer",
        "assigned_to",
        "forwarded_to",
        "cms_added_by",
        "resolution_verified_by",
        "cms_closed_by",
        "created_by",
    ).prefetch_related("activities__resolved_by")

    def get_serializer_class(self):
        return TicketDetailSerializer if self.request.method == "GET" else TicketWriteSerializer

    def update(self, request, *args, **kwargs):
        ticket = self.get_object()
        serializer = self.get_serializer(
            ticket, data=self.write_payload(request), partial=kwargs.get("partial", False)
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        # Re-read so the response reflects the replaced activities.
        return Response(TicketDetailSerializer(self.get_object()).data)


class SiteListCreateView(ListCreateAPIView):
    """
    The ticket form's site field. GET ?q= typeahead over *active* sites (name
    or OCN, max 20), for anyone signed in; POST {name, ocn} quick-adds one
    without leaving the form, admin role only (as on the Sites lookup page).
    Full management (country, address, deactivation) is /api/lookups/sites/.
    """

    permission_classes = [IsAuthenticated, IsAdminRoleOrReadOnly]
    serializer_class = SiteSerializer
    pagination_class = None

    def get_queryset(self):
        term = self.request.query_params.get("q", "").strip()
        qs = Site.objects.filter(is_active=True)
        if term:
            qs = qs.filter(Q(name__icontains=term) | Q(ocn__icontains=term))
        return qs[:TYPEAHEAD_LIMIT]


class CustomerListCreateView(ListCreateAPIView):
    """
    The ticket form's customer field. GET ?q= typeahead by name (max 20), for
    anyone signed in; POST {name} quick-adds one, admin role only. Full
    management is /api/lookups/customers/.
    """

    permission_classes = [IsAuthenticated, IsAdminRoleOrReadOnly]
    serializer_class = CustomerSerializer
    pagination_class = None

    def get_queryset(self):
        term = self.request.query_params.get("q", "").strip()
        qs = Customer.objects.all()
        if term:
            qs = qs.filter(name__icontains=term)
        return qs[:TYPEAHEAD_LIMIT]


class WorkDoneCodeListView(ListAPIView):
    """
    Every work-done code, with `is_active`: the ticket form offers only active
    codes for new choices but still needs inactive ones to label activities
    that already use them.
    """

    serializer_class = WorkDoneCodeSerializer
    pagination_class = None
    queryset = WorkDoneCode.objects.all()
