from django.contrib import admin

from .models import WorkLogEntry


@admin.register(WorkLogEntry)
class WorkLogEntryAdmin(admin.ModelAdmin):
    list_display = (
        "date", "user", "start_time", "end_time", "category", "hours", "is_auto", "created_at"
    )
    list_filter = ("user", "category", "date")
    date_hierarchy = "date"
    list_select_related = ("user",)

    @admin.display(boolean=True, description="From ticket")
    def is_auto(self, obj):
        return obj.is_auto

    # Auto entries mirror a ticket activity; they change only with it.
    def has_change_permission(self, request, obj=None):
        return super().has_change_permission(request, obj) and not (obj and obj.is_auto)

    def has_delete_permission(self, request, obj=None):
        return super().has_delete_permission(request, obj) and not (obj and obj.is_auto)
