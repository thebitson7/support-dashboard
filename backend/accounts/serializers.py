from rest_framework import serializers

from .models import User


class UserSummarySerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "username", "first_name", "last_name", "role", "timezone"]
        read_only_fields = fields
