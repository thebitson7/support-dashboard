from django.db.models import Q, Value
from django.db.models.functions import Concat
from rest_framework.exceptions import AuthenticationFailed, Throttled
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.generics import ListAPIView, ListCreateAPIView, RetrieveUpdateAPIView
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings as jwt_settings
from rest_framework_simplejwt.tokens import RefreshToken
from rest_framework_simplejwt.views import TokenBlacklistView, TokenObtainPairView

from audit.log import log_action, person
from audit.models import AuditLogEntry

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

    def post(self, request, *args, **kwargs):
        # Throttled attempts never get here (refused before the view runs),
        # so a flood of them can't flood the log either.
        username = str(request.data.get("username", "")).strip() if hasattr(request.data, "get") else ""
        try:
            response = super().post(request, *args, **kwargs)
        except AuthenticationFailed:
            # Only for real accounts: an unknown username is just noise.
            user = User.objects.filter(username__iexact=username).first() if username else None
            if user is not None:
                log_action(
                    user,
                    AuditLogEntry.Action.LOGIN_FAILED,
                    target=user,
                    target_label=f"User: {person(user)}",
                    description=f"Failed sign-in attempt for {person(user)}",
                    metadata={"reason": "wrong password" if user.is_active else "account deactivated"},
                    request=request,
                )
            raise
        user = User.objects.filter(username=username).first()
        if user is not None:
            log_action(
                user,
                AuditLogEntry.Action.LOGIN,
                target=user,
                target_label=f"User: {person(user)}",
                description=f"{person(user)} signed in",
                request=request,
            )
        return response


class LogoutView(TokenBlacklistView):
    """
    Sign-out: blacklists the refresh token (so it can never be used again)
    and records who signed out, read from the token before it's revoked.
    """

    def post(self, request, *args, **kwargs):
        user = None
        try:
            token = RefreshToken(request.data.get("refresh", ""))
            user = User.objects.filter(pk=token.payload.get(jwt_settings.USER_ID_CLAIM)).first()
        except (TokenError, AttributeError, TypeError):
            pass  # invalid or already revoked: the view below answers 401
        response = super().post(request, *args, **kwargs)
        if response.status_code == 200 and user is not None:
            log_action(
                user,
                AuditLogEntry.Action.LOGOUT,
                target=user,
                target_label=f"User: {person(user)}",
                description=f"{person(user)} signed out",
                request=request,
            )
        return response


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

    def perform_create(self, serializer):
        user = serializer.save()
        log_action(
            self.request.user,
            AuditLogEntry.Action.USER_CREATED,
            target=user,
            target_label=f"User: {person(user)}",
            description=(
                f"{person(self.request.user)} created an account for {person(user)} "
                f"({user.username}, {user.get_role_display()})"
            ),
            metadata={"username": user.username, "role": user.role, "timezone": user.timezone, "is_active": user.is_active},
            request=self.request,
        )


class AdminUserDetailView(AdminAccessMixin, RetrieveUpdateAPIView):
    """
    GET one user; PATCH their name, role, time zone, active status, or a
    `new_password`. No PUT, and no DELETE: people are deactivated, never
    deleted, since their history references them.
    """

    http_method_names = ["get", "patch", "head", "options"]

    def perform_update(self, serializer):
        # Read before saving: the serializer consumes new_password.
        resetting = bool(serializer.validated_data.get("new_password"))
        before = {f: getattr(serializer.instance, f) for f in ("first_name", "last_name", "timezone", "role", "is_active")}
        user = serializer.save()
        log_user_changes(self.request, user, before, resetting)


# --- Audit wording ---------------------------------------------------------------

EDITABLE_LABELS = {"first_name": "first name", "last_name": "last name", "timezone": "time zone"}


def log_user_changes(request, user, before: dict, password_reset: bool) -> None:
    """One entry per kind of change an admin made to an account."""
    actor, A = request.user, AuditLogEntry.Action
    whose, label = f"{person(user)}'s", f"User: {person(user)}"

    def entry(action, description, metadata=None):
        log_action(actor, action, target=user, target_label=label, description=description, metadata=metadata, request=request)

    if before["role"] != user.role:
        old, new = User.Role(before["role"]).label, user.get_role_display()
        entry(
            A.USER_ROLE_CHANGED,
            f"{person(actor)} changed {whose} role from {old} to {new}",
            {"from": before["role"], "to": user.role},
        )
    if before["is_active"] != user.is_active:
        entry(
            A.USER_REACTIVATED if user.is_active else A.USER_DEACTIVATED,
            f"{person(actor)} {'reactivated' if user.is_active else 'deactivated'} {whose} account",
        )
    if password_reset:
        # That it happened, never the password itself.
        entry(A.USER_PASSWORD_RESET, f"{person(actor)} reset {whose} password")
    edited = {f: {"from": before[f], "to": getattr(user, f)} for f in EDITABLE_LABELS if before[f] != getattr(user, f)}
    if edited:
        details = [f"{EDITABLE_LABELS[f]} {c['from'] or '(blank)'} → {c['to'] or '(blank)'}" for f, c in edited.items()]
        entry(A.USER_UPDATED, f"{person(actor)} edited {whose} account: {', '.join(details)}", {"changes": edited})
