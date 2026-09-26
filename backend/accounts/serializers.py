from rest_framework import serializers

from .models import User


class UserSummarySerializer(serializers.ModelSerializer):
    """A user as they see themselves (/me) or as admins see staff: includes role and zone."""

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "role", "timezone"]
        read_only_fields = fields


class UserRefSerializer(serializers.ModelSerializer):
    """
    A user as anyone may see them: enough to name and pick them, nothing else
    (no role, so the user search can't be used to list the admins).
    """

    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name"]
        read_only_fields = fields
