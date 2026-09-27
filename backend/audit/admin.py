from django.contrib import admin

from .models import AuditLogEntry


@admin.register(AuditLogEntry)
class AuditLogEntryAdmin(admin.ModelAdmin):
    """Read-only: an audit trail that could be edited wouldn't be one."""

    list_display = ("created_at", "actor_username", "action", "description", "ip_address")
    list_filter = ("action", "target_type")
    search_fields = ("description", "actor_username", "target_label")
    date_hierarchy = "created_at"

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False
