"""Shared base for management commands that must never touch a real deployment."""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class DevOnlyCommand(BaseCommand):
    """
    Refuses to run unless DEBUG is on. The seed commands reset passwords and
    delete/replace data, which is fine on a developer's SQLite file and
    destructive anywhere else. They are also never reachable from the API.
    """

    def execute(self, *args, **options):
        if not settings.DEBUG:
            raise CommandError(
                f"`{self.__module__.rsplit('.', 1)[-1]}` is for local development only "
                "(it resets or replaces data) and refuses to run with DEBUG off."
            )
        return super().execute(*args, **options)
