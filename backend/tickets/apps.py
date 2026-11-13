from django.apps import AppConfig


class TicketsConfig(AppConfig):
    name = "tickets"

    def ready(self):
        # Validate the attention thresholds at startup: a bad TICKET_*_HOURS
        # value raises ImproperlyConfigured here instead of mis-classifying.
        from .attention import get_thresholds

        get_thresholds()
