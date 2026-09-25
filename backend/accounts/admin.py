from django.contrib import admin
from django.contrib.auth.admin import UserAdmin as BaseUserAdmin

from .models import User


@admin.register(User)
class UserAdmin(BaseUserAdmin):
    list_display = (
        "username", "first_name", "last_name", "role", "timezone", "is_staff", "is_active"
    )
    list_filter = ("role", *BaseUserAdmin.list_filter)
    fieldsets = (*BaseUserAdmin.fieldsets, ("Role & locale", {"fields": ("role", "timezone")}))
    add_fieldsets = (*BaseUserAdmin.add_fieldsets, ("Role & locale", {"fields": ("role", "timezone")}))
