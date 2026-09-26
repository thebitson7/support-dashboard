from django.contrib import admin

from .models import WorkLogEntry


@admin.register(WorkLogEntry)
class WorkLogEntryAdmin(admin.ModelAdmin):
    list_display = ("date", "user", "start_time", "end_time", "category", "hours", "created_at")
    list_filter = ("user", "category", "date")
    date_hierarchy = "date"
    list_select_related = ("user",)
