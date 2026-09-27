from django.urls import path

from .views import AuditActionListView, AuditLogExportView, AuditLogListView

urlpatterns = [
    path("logs/", AuditLogListView.as_view(), name="audit-logs"),
    path("logs/export/", AuditLogExportView.as_view(), name="audit-logs-export"),
    path("logs/actions/", AuditActionListView.as_view(), name="audit-actions"),
]
