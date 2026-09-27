from django.contrib.auth import password_validation
from django.contrib.auth.validators import UnicodeUsernameValidator
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers

from .models import User
from .sessions import revoke_sessions


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


class AdminUserSerializer(serializers.ModelSerializer):
    """
    A user as Administration manages them (admin role only).

    Passwords are write-only and never returned. They're chosen (or generated
    in the browser) by the admin and checked with the project's password
    validators, so weak ones get a clear message. `password` is required when
    creating; to change one later send `new_password`. Setting a new password
    or deactivating someone also signs them out everywhere (their refresh
    tokens are revoked).

    Usernames are unique case-insensitively ("Syed" vs "syed") and fixed once
    created. An admin can't remove their own admin role or deactivate
    themselves here, so an account can't lock itself out.
    """

    username = serializers.CharField(max_length=150, validators=[UnicodeUsernameValidator()])
    password = serializers.CharField(
        write_only=True,
        required=False,
        trim_whitespace=False,
        style={"input_type": "password"},
        error_messages={"blank": "Set a password for the new user."},
    )
    new_password = serializers.CharField(
        write_only=True,
        required=False,
        trim_whitespace=False,
        style={"input_type": "password"},
        error_messages={"blank": "The new password can't be empty."},
    )

    class Meta:
        model = User
        fields = [
            "id",
            "username",
            "first_name",
            "last_name",
            "role",
            "timezone",
            "is_active",
            "last_login",
            "date_joined",
            "password",
            "new_password",
        ]
        read_only_fields = ["id", "last_login", "date_joined"]

    def validate_username(self, value):
        value = value.strip()
        if self.instance is not None:
            if value != self.instance.username:
                raise serializers.ValidationError("Usernames can't be changed once created.")
            return value
        if User.objects.filter(username__iexact=value).exists():
            raise serializers.ValidationError("A user with this username already exists.")
        return value

    def validate_first_name(self, value):
        return value.strip()

    def validate_last_name(self, value):
        return value.strip()

    @staticmethod
    def _check_password(field, password, user):
        try:
            password_validation.validate_password(password, user=user)
        except DjangoValidationError as error:
            raise serializers.ValidationError({field: list(error.messages)})

    def validate(self, attrs):
        instance = self.instance
        if instance is None:
            if not attrs.get("password"):
                raise serializers.ValidationError({"password": "Set a password for the new user."})
            if "new_password" in attrs:
                raise serializers.ValidationError({"new_password": "Use `password` when creating a user."})
            candidate = User(**{k: v for k, v in attrs.items() if k != "password"})
            self._check_password("password", attrs["password"], candidate)
            return attrs

        if "password" in attrs:
            raise serializers.ValidationError({"password": "To change a password, send `new_password`."})
        if attrs.get("new_password"):
            self._check_password("new_password", attrs["new_password"], instance)

        # Self-lockout guard.
        if instance.pk == self.context["request"].user.pk:
            if attrs.get("role", instance.role) != User.Role.ADMIN:
                raise serializers.ValidationError(
                    {"role": "You can't remove your own admin access. Ask another admin to change your role."}
                )
            if attrs.get("is_active", instance.is_active) is False:
                raise serializers.ValidationError(
                    {"is_active": "You can't deactivate your own account. Ask another admin to do it."}
                )
        return attrs

    def create(self, validated_data):
        password = validated_data.pop("password")
        user = User(**validated_data)
        user.set_password(password)
        user.save()
        return user

    def update(self, instance, validated_data):
        new_password = validated_data.pop("new_password", None)
        was_active = instance.is_active
        for field, value in validated_data.items():
            setattr(instance, field, value)
        if new_password:
            instance.set_password(new_password)
        instance.save()
        if new_password or (was_active and not instance.is_active):
            revoke_sessions(instance)
        return instance
