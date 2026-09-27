from django.db.models import Q, Value
from django.db.models.functions import Concat
from rest_framework.exceptions import Throttled
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.generics import ListAPIView, ListCreateAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import User
from .permissions import IsAdminRole
from .serializers import AdminUserSerializer, UserRefSerializer, UserSummarySerializer
from .throttling import AdminWriteRateThrottle, LoginRateThrottle

USER_SEARCH_LIMIT = 20


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """JWT sign-in, rate limited per username + client IP (429 + Retry-After)."""

    throttle_classes = [LoginRateThrottle]

    def throttled(self, request, wait):
        raise Throttled(wait=wait, detail="Too many sign-in attempts.")


class MeView(APIView):
    """The identity behind the current access token."""

    def get(self, request):
        return Response(UserSummarySerializer(request.user).data)


class UserSearchView(ListAPIView):
    """
    GET ?q= : active users whose username or name matches (max 20). Open to
    any signed-in user; it powers the "Search users..." fields app-wide, so it
    returns only what's needed to pick someone (UserRefSerializer).
    """

    serializer_class = UserRefSerializer
    pagination_class = None

    def get_queryset(self):
        term = self.request.query_params.get("q", "").strip()
        qs = User.objects.filter(is_active=True).annotate(
            full_name=Concat("first_name", Value(" "), "last_name")
        )
        if term:
            qs = qs.filter(
                Q(username__icontains=term) | Q(full_name__icontains=term)
            )
        return qs.order_by("first_name", "last_name", "username")[:USER_SEARCH_LIMIT]


class AdminAccessMixin:
    """Administration: admin role only, writes rate limited (per admin)."""

    permission_classes = [IsAuthenticated, IsAdminRole]
    throttle_classes = [AdminWriteRateThrottle]
    serializer_class = AdminUserSerializer
    queryset = User.objects.all()


class AdminUserListCreateView(AdminAccessMixin, ListCreateAPIView):
    """
    GET: every user, active or not, staff or admin (?search= over username
    and name; ?ordering= by any column). POST: create one (see
    AdminUserSerializer for the password and uniqueness rules).
    """

    pagination_class = None
    filter_backends = [SearchFilter, OrderingFilter]
    search_fields = ["username", "first_name", "last_name"]
    ordering_fields = ["username", "first_name", "last_name", "role", "timezone", "is_active", "last_login"]
    ordering = ["first_name", "last_name", "username"]


class AdminUserDetailView(AdminAccessMixin, RetrieveUpdateAPIView):
    """
    GET one user; PATCH their name, role, time zone, active status, or a
    `new_password`. No PUT, and no DELETE: people are deactivated, never
    deleted, since their history references them.
    """

    http_method_names = ["get", "patch", "head", "options"]
