"""Root URL configuration."""

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.urls import include, path

from accounts.views import UserSearchView

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/", include("core.urls")),
    path("api/auth/", include("accounts.urls")),
    path("api/accounts/users/", UserSearchView.as_view(), name="user-search"),
    path("api/working-hours/", include("working_hours.urls")),
    path("api/tickets/", include("tickets.urls")),
]

if settings.DEBUG:
    # Dev only. Uploaded ticket PDFs are then readable by URL without auth;
    # production must serve them through an authenticated view instead.
    urlpatterns += static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
