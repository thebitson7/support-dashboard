from drf_spectacular.utils import extend_schema, inline_serializer
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


@extend_schema(
    summary="Health check",
    auth=[],
    responses=inline_serializer(
        "Ping", {"status": serializers.CharField(), "message": serializers.CharField()}
    ),
)
class PingView(APIView):
    """
    Liveness probe for load balancers and uptime checks: no authentication,
    no database access, so it answers whenever Django is serving requests.
    """

    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"status": "ok", "message": "pong"})
