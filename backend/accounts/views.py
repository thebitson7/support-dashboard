from django.db.models import Q, Value
from django.db.models.functions import Concat
from rest_framework.exceptions import Throttled
from rest_framework.generics import ListAPIView
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .models import User
from .serializers import UserSummarySerializer
from .throttling import LoginRateThrottle

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
    any signed-in user; it powers the "Search users..." fields app-wide.
    """

    serializer_class = UserSummarySerializer
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
