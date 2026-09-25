from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.generics import ListAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.permissions import IsAdminRole, IsAdminRoleOrSelf
from accounts.serializers import UserSummarySerializer

from .periods import local_today, summarize

# Ids beyond this overflow the database integer type (a 500, not a 400).
MAX_ID = 2**63 - 1


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
        if request.user.is_admin_role:
            target = self._requested_user(request)
        else:
            target = request.user

        viewer = request.user
        return Response(
            {
                "user": UserSummarySerializer(target).data,
                # The zone the periods were computed in: the viewer's own.
                "timezone": viewer.timezone,
                "periods": summarize(target, local_today(viewer)),
            }
        )

    def _requested_user(self, request) -> User:
        param = self.target_user_param
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
