from django.urls import path

from .views import StaffUserListView, SummaryView

urlpatterns = [
    path("users/", StaffUserListView.as_view(), name="working-hours-users"),
    path("summary/", SummaryView.as_view(), name="working-hours-summary"),
]
