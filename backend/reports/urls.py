from django.urls import path

from .views import TeamActivityExportView, TeamActivityView

urlpatterns = [
    path("team-activity/", TeamActivityView.as_view(), name="report-team-activity"),
    path("team-activity/export/", TeamActivityExportView.as_view(), name="report-team-activity-export"),
]
