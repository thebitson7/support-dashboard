from django.apps import AppConfig
from django.db.models.signals import post_save


def _activity_saved(sender, instance, raw=False, **kwargs):
    # `raw`: fixture loading, where related rows may not exist yet.
    if not raw:
        from .sync import sync_activity

        sync_activity(instance)


class WorkingHoursConfig(AppConfig):
    name = "working_hours"

    def ready(self):
        from tickets.models import TicketActivity

        # Single-activity saves (e.g. the admin's inline editor). The ticket
        # API's bulk writes call working_hours.sync directly instead.
        post_save.connect(
            _activity_saved, sender=TicketActivity, dispatch_uid="work_log_from_ticket_activity"
        )
