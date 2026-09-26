from django.apps import AppConfig


class LookupsConfig(AppConfig):
    """API for managing reference data. No models: they live in `tickets`."""

    name = "lookups"
