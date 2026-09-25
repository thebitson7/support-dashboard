from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.contrib.auth.models import AbstractUser
from django.core.exceptions import ValidationError
from django.db import models

DEFAULT_TIMEZONE = "Asia/Kuala_Lumpur"


def validate_timezone(value: str) -> None:
    try:
        ZoneInfo(value)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValidationError(f"“{value}” is not a known IANA time zone (e.g. Asia/Manila).")


class User(AbstractUser):
    class Role(models.TextChoices):
        STAFF = "staff", "Staff"
        ADMIN = "admin", "Admin"

    # Application role, deliberately separate from Django's `is_staff` /
    # `is_superuser` flags (which only govern access to /admin/).
    role = models.CharField(max_length=20, choices=Role.choices, default=Role.STAFF)
    # Decides which calendar day "today" is when this user views period
    # summaries (their own, or, for admins, anyone's).
    timezone = models.CharField(
        max_length=64,
        default=DEFAULT_TIMEZONE,
        validators=[validate_timezone],
        help_text="IANA time zone name, e.g. Asia/Kuala_Lumpur, Asia/Manila, Indian/Maldives.",
    )

    @property
    def is_admin_role(self) -> bool:
        return self.role == self.Role.ADMIN

    @property
    def tzinfo(self) -> ZoneInfo:
        """The user's zone; falls back to the default if a bad value slipped past validation."""
        try:
            return ZoneInfo(self.timezone)
        except (ZoneInfoNotFoundError, ValueError):
            return ZoneInfo(DEFAULT_TIMEZONE)
