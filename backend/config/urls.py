"""Root URL configuration."""

from django.contrib import admin
from django.urls import include, path

from accounts.views import AdminUserDetailView, AdminUserListCreateView, UserSearchView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("core.urls")),
    path("api/auth/", include("accounts.urls")),
    path("api/accounts/users/", UserSearchView.as_view(), name="user-search"),
    # Administration: user management, admin role only.
    path("api/accounts/admin/users/", AdminUserListCreateView.as_view(), name="admin-users"),
    path("api/accounts/admin/users/<int:pk>/", AdminUserDetailView.as_view(), name="admin-user"),
    path("api/working-hours/", include("working_hours.urls")),
    path("api/tickets/", include("tickets.urls")),
    path("api/lookups/", include("lookups.urls")),
    path("api/reports/", include("reports.urls")),
    path("api/audit/", include("audit.urls")),
]

# Uploaded files (ticket PDFs) are never served by URL, in development either:
# only through the authenticated /api/tickets/<id>/attachment/ view.
