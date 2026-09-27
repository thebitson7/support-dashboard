from django.conf import settings
from django.db import models


class AuditLogEntry(models.Model):
    """
    One thing someone did, written once and never edited.

    Everything shown is snapshotted when the entry is written: the actor's
    username, a label for the target, and the full sentence describing it. So
    the log still reads correctly after people or records are renamed, and
    even after a record is deleted. `actor` is kept as a link for filtering
    only; it's nullable for system events and future-proofing (people are
    deactivated, never deleted).

    Nothing sensitive is ever stored: no passwords, no tokens.
    """

    class Action(models.TextChoices):
        LOGIN = "login", "Signed in"
        LOGIN_FAILED = "login_failed", "Sign-in failed"
        LOGOUT = "logout", "Signed out"
        TICKET_CREATED = "ticket_created", "Ticket created"
        TICKET_UPDATED = "ticket_updated", "Ticket updated"
        TICKET_CLOSED = "ticket_closed", "Ticket closed"
        TICKET_REOPENED = "ticket_reopened", "Ticket reopened"
        TICKET_ACTIVITY_ADDED = "ticket_activity_added", "Activity added"
        TICKET_ACTIVITY_REMOVED = "ticket_activity_removed", "Activity removed"
        WORK_LOG_CREATED = "work_log_created", "Hours logged"
        WORK_LOG_UPDATED = "work_log_updated", "Hours edited"
        WORK_LOG_DELETED = "work_log_deleted", "Hours deleted"
        LOOKUP_CREATED = "lookup_created", "Lookup added"
        LOOKUP_UPDATED = "lookup_updated", "Lookup edited"
        LOOKUP_DELETED = "lookup_deleted", "Lookup deleted"
        USER_CREATED = "user_created", "User created"
        USER_UPDATED = "user_updated", "User edited"
        USER_DEACTIVATED = "user_deactivated", "User deactivated"
        USER_REACTIVATED = "user_reactivated", "User reactivated"
        USER_ROLE_CHANGED = "user_role_changed", "Role changed"
        USER_PASSWORD_RESET = "user_password_reset", "Password reset"

    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="audit_entries",
    )
    # What's displayed: the username at the time, not a live join.
    actor_username = models.CharField(max_length=150, blank=True)
    action = models.CharField(max_length=40, choices=Action.choices)
    # A plain label ("ticket", "site", "user"), not a ContentType: stable
    # across model changes and readable in exports.
    target_type = models.CharField(max_length=40, blank=True)
    target_id = models.CharField(max_length=64, blank=True)
    target_label = models.CharField(max_length=255, blank=True)
    description = models.CharField(max_length=500)
    metadata = models.JSONField(default=dict, blank=True)
    ip_address = models.CharField(max_length=45, blank=True)  # fits IPv6
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at", "-id"]
        verbose_name = "audit log entry"
        verbose_name_plural = "audit log entries"
        indexes = [
            models.Index(fields=["action"], name="audit_action_idx"),
            models.Index(fields=["target_type", "target_id"], name="audit_target_idx"),
        ]
        # `actor` (a foreign key) and `created_at` (db_index) are indexed too.

    def __str__(self):
        return f"{self.created_at:%Y-%m-%d %H:%M} · {self.description}"


# How the filter groups the actions (the /actions/ endpoint serves this, so the
# frontend never keeps its own copy of the list).
ACTION_GROUPS = {
    "Sign-in": ["login", "login_failed", "logout"],
    "Tickets": [
        "ticket_created",
        "ticket_updated",
        "ticket_closed",
        "ticket_reopened",
        "ticket_activity_added",
        "ticket_activity_removed",
    ],
    "Work logs": ["work_log_created", "work_log_updated", "work_log_deleted"],
    "Lookups": ["lookup_created", "lookup_updated", "lookup_deleted"],
    "Users": [
        "user_created",
        "user_updated",
        "user_deactivated",
        "user_reactivated",
        "user_role_changed",
        "user_password_reset",
    ],
}
