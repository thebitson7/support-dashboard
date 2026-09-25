from rest_framework.exceptions import Throttled
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from .serializers import UserSummarySerializer
from .throttling import LoginRateThrottle


class ThrottledTokenObtainPairView(TokenObtainPairView):
    """JWT sign-in, rate limited per username + client IP (429 + Retry-After)."""

    throttle_classes = [LoginRateThrottle]

    def throttled(self, request, wait):
        raise Throttled(wait=wait, detail="Too many sign-in attempts.")


class MeView(APIView):
    """The identity behind the current access token."""

    def get(self, request):
        return Response(UserSummarySerializer(request.user).data)
