from django.contrib import admin

from .models import Customer, Site, Ticket, TicketActivity, WorkDoneCode


@admin.register(Site)
class SiteAdmin(admin.ModelAdmin):
    list_display = ("name", "ocn")
    search_fields = ("name", "ocn")


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("name",)
    search_fields = ("name",)


@admin.register(WorkDoneCode)
class WorkDoneCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "description")
    search_fields = ("code", "description")


class TicketActivityInline(admin.TabularInline):
    model = TicketActivity
    extra = 0
    autocomplete_fields = ("work_done_code",)
    raw_id_fields = ("resolved_by",)


@admin.register(Ticket)
class TicketAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "cms_next_ticket_no",
        "site",
        "received_at",
        "status",
        "assigned_to",
        "total_duration_hours",
        "is_pre",
        "created_by",
    )
    list_filter = ("ticket_type", "incoming_channel", "is_pre", "is_forwarded", "received_at")
    search_fields = ("cms_next_ticket_no", "site__name", "site__ocn", "customer__name")
    date_hierarchy = "received_at"
    list_select_related = ("site", "assigned_to", "created_by")
    autocomplete_fields = ("site", "customer")
    raw_id_fields = (
        "assigned_to",
        "forwarded_to",
        "cms_added_by",
        "resolution_verified_by",
        "cms_closed_by",
        "created_by",
    )
    readonly_fields = ("created_at", "updated_at")
    inlines = [TicketActivityInline]

    @admin.display(description="Status")
    def status(self, obj):
        return obj.status.title()
