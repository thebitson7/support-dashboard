from django.urls import path

from .views import (
    CustomerListCreateView,
    SiteListCreateView,
    TicketDetailView,
    TicketExportView,
    TicketListCreateView,
    WorkDoneCodeListView,
)

urlpatterns = [
    path("", TicketListCreateView.as_view(), name="ticket-list"),
    path("export/", TicketExportView.as_view(), name="ticket-export"),
    path("<int:pk>/", TicketDetailView.as_view(), name="ticket-detail"),
    path("sites/", SiteListCreateView.as_view(), name="ticket-sites"),
    path("customers/", CustomerListCreateView.as_view(), name="ticket-customers"),
    path("work-done-codes/", WorkDoneCodeListView.as_view(), name="ticket-work-done-codes"),
]
