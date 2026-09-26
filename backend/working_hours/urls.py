from django.urls import path

from .views import EntryDetailView, EntryListCreateView, StaffUserListView, SummaryView

urlpatterns = [
    path("users/", StaffUserListView.as_view(), name="working-hours-users"),
    path("summary/", SummaryView.as_view(), name="working-hours-summary"),
    path("entries/", EntryListCreateView.as_view(), name="working-hours-entries"),
    path("entries/<int:pk>/", EntryDetailView.as_view(), name="working-hours-entry"),
]
