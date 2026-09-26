"""Create (or reset) the local development users. Never run this against real data."""

from django.db import transaction

from core.management import DevOnlyCommand
from accounts.models import User

DEV_PASSWORD = "password123"

# Staff names are the support team's. The time zones differ on purpose so
# "today" boundaries can be seen to differ.
DEV_USERS = [
    {"username": "admin", "first_name": "Admin", "last_name": "User", "role": User.Role.ADMIN,
     "is_staff": True, "is_superuser": True},
    {"username": "syed", "first_name": "Syed", "last_name": "Hussain", "role": User.Role.STAFF,
     "timezone": "Asia/Kuala_Lumpur"},
    {"username": "naleefa", "first_name": "Naleefa", "last_name": "Kareem", "role": User.Role.STAFF,
     "timezone": "Asia/Manila"},
    {"username": "wahida", "first_name": "Wahida", "last_name": "Begum", "role": User.Role.STAFF,
     "timezone": "Indian/Maldives"},
]


class Command(DevOnlyCommand):
    help = f"Create/update local dev users (all with password '{DEV_PASSWORD}')."

    @transaction.atomic
    def handle(self, *args, **options):
        rows = []
        for spec in DEV_USERS:
            fields = {k: v for k, v in spec.items() if k != "username"}
            user, created = User.objects.update_or_create(
                username=spec["username"], defaults=fields
            )
            user.set_password(DEV_PASSWORD)
            user.save(update_fields=["password"])
            rows.append((user.username, user.role, user.timezone, "created" if created else "updated"))

        self.stdout.write(self.style.SUCCESS("Dev users ready:"))
        for username, role, tz, state in rows:
            self.stdout.write(
                f"  {username:<10} {role:<6} {tz:<18} password={DEV_PASSWORD}  ({state})"
            )
