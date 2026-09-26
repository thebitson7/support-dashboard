from django.contrib import admin

from .models import Country, Customer, Holiday, Site, Ticket, TicketActivity, WorkDoneCode


@admin.register(Country)
class CountryAdmin(admin.ModelAdmin):
    list_display = ("name", "code")
    search_fields = ("name", "code")


@admin.register(Site)
class SiteAdmin(admin.ModelAdmin):
    list_display = ("name", "ocn", "country", "is_active")
    list_filter = ("is_active", "country")
    search_fields = ("name", "ocn", "address")
    list_select_related = ("country",)


@admin.register(Holiday)
class HolidayAdmin(admin.ModelAdmin):
    list_display = ("name", "date", "country", "is_recurring_annually")
    list_filter = ("is_recurring_annually", "country")
    search_fields = ("name",)
    list_select_related = ("country",)


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ("name",)
    search_fields = ("name",)


@admin.register(WorkDoneCode)
class WorkDoneCodeAdmin(admin.ModelAdmin):
    list_display = ("code", "description", "is_active")
    list_filter = ("is_active",)
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
