from functools import cached_property

from django.utils.dateparse import parse_date
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListAPIView, ListCreateAPIView, RetrieveUpdateDestroyAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import IsAdminRole, IsAdminRoleOrOwner, IsAdminRoleOrSelf
from accounts.serializers import UserSummarySerializer

from .models import WorkLogEntry
from .periods import local_today, summarize
from .serializers import WorkLogEntrySerializer

# Ids beyond this overflow the database integer type (a 500, not a 400).
MAX_ID = 2**63 - 1


def target_user(request, param: str = "user_id") -> User:
    """
    Whose working hours a request is about.

    Staff: always themselves (IsAdminRoleOrSelf has already refused a request
    naming anyone else). Admin: `param` is required and may be any active
    user; deactivated accounts are a 404 like unknown ones.
    """
    if not request.user.is_admin_role:
        return request.user
    raw_id = request.query_params.get(param)
    if raw_id is None or not raw_id.strip():
        raise ValidationError({param: "This parameter is required."})
    raw_id = raw_id.strip()
    # isascii() matters: str.isdigit() accepts "²", which int() rejects.
    if not (raw_id.isascii() and raw_id.isdigit()) or not 0 < int(raw_id) <= MAX_ID:
        raise ValidationError({param: "Must be a positive integer user id."})
    # Deactivated accounts are treated as gone, for admins too.
    target = User.objects.filter(pk=int(raw_id), is_active=True).first()
    if target is None:
        raise NotFound("User not found.")
    return target


class StaffUserListView(ListAPIView):
    """Staff users an admin can pick from. Admin role only."""

    permission_classes = [IsAuthenticated, IsAdminRole]
    serializer_class = UserSummarySerializer
    pagination_class = None
    queryset = User.objects.filter(role=User.Role.STAFF, is_active=True).order_by(
        "first_name", "last_name", "username"
    )


class SummaryView(APIView):
    """
    Period totals for one user.

    Staff: always their own data; naming anyone else is a 403 (enforced by
    IsAdminRoleOrSelf). Admin: `user_id` is required and may be any
    active user; deactivated users are a 404 like unknown ones.

    Period boundaries ("today", "this week"...) are always cut in the
    *viewer's* time zone, i.e. the requester's, whoever's data is shown.
    """

    permission_classes = [IsAuthenticated, IsAdminRoleOrSelf]
    target_user_param = "user_id"

    def get(self, request):
        target = target_user(request, self.target_user_param)
        viewer = request.user
        return Response(
            {
                "user": UserSummarySerializer(target).data,
                # The zone the periods were computed in: the viewer's own.
                "timezone": viewer.timezone,
                "periods": summarize(target, local_today(viewer)),
            }
        )


class EntryListCreateView(ListCreateAPIView):
    """
    One user's entries for one day, and logging new ones.

    Whose: `?user_id=`, with exactly the summary endpoint's rules (staff may
    only name themselves, and omitting it means themselves; admins must name
    an active user). That applies to POST as well: the body never says whose
    entry it is.

    GET ?date=YYYY-MM-DD: that day's entries in time order; omitted = the
    viewer's today. POST {date?, start_time, end_time, category, note?}:
    `date` defaults to the viewer's today too; `hours` is computed from the
    times (see WorkLogEntrySerializer).
    """

    permission_classes = [IsAuthenticated, IsAdminRoleOrSelf]
    target_user_param = "user_id"
    serializer_class = WorkLogEntrySerializer
    pagination_class = None

    @cached_property
    def target(self) -> User:
        return target_user(self.request, self.target_user_param)

    def get_queryset(self):
        raw = self.request.query_params.get("date")
        if raw:
            try:
                day = parse_date(raw)
            except ValueError:  # well-formed but impossible, e.g. 2026-02-30
                day = None
            if day is None:
                raise ValidationError({"date": "Use a YYYY-MM-DD date."})
        else:
            day = local_today(self.request.user)
        return WorkLogEntry.objects.filter(user=self.target, date=day).order_by("start_time", "id")

    def get_serializer_context(self):
        context = super().get_serializer_context()
        if self.request.method == "POST":
            context["target"] = self.target
        return context

    def perform_create(self, serializer):
        serializer.save(user=self.target)


class EntryDetailView(RetrieveUpdateDestroyAPIView):
    """
    GET / PATCH {date, start_time, end_time, category, note} / DELETE one entry. Staff: only
    their own (someone else's is a 403). Admin: anyone's, except that entries
    of deactivated users are a 404, as on the summary. The owner never changes.
    """

    permission_classes = [IsAuthenticated, IsAdminRoleOrOwner]
    serializer_class = WorkLogEntrySerializer
    http_method_names = ["get", "patch", "delete", "head", "options"]
    queryset = WorkLogEntry.objects.filter(user__is_active=True).select_related("user")
