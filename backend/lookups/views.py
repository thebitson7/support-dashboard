"""
Lookups management API: one base viewset, five explicit subclasses.

Anyone signed in can read (the lists feed other screens, e.g. the ticket
form); only admin-role users can create, update or delete. Deleting a record
that other data still points at returns 409 with a plain-language count
instead of a server error.
"""

from collections import Counter

from django.db.models import ProtectedError
from django.db.models.functions import ExtractDay, ExtractMonth
from rest_framework import status
from rest_framework.filters import OrderingFilter, SearchFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.viewsets import ModelViewSet

from accounts.permissions import IsAdminRoleOrReadOnly
from tickets.models import Country, Customer, Holiday, Site, WorkDoneCode

from .serializers import (
    CountrySerializer,
    CustomerSerializer,
    HolidaySerializer,
    SiteSerializer,
    WorkDoneCodeSerializer,
)


def _plural(count: int, model) -> str:
    meta = model._meta
    return f"{count} {meta.verbose_name if count == 1 else meta.verbose_name_plural}"


class LookupViewSet(ModelViewSet):
    """
    GET list (?search=, ?ordering=) / retrieve: any authenticated user.
    POST / PATCH / DELETE: admin role only.
    Lists are small, so they're unpaginated.
    """

    permission_classes = [IsAuthenticated, IsAdminRoleOrReadOnly]
    pagination_class = None
    filter_backends = [SearchFilter, OrderingFilter]
    http_method_names = ["get", "post", "patch", "delete", "head", "options"]
    #: Singular noun for messages, e.g. "site".
    noun = "record"
    #: What to do instead of deleting, appended to the 409 message.
    in_use_hint = ""

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        try:
            instance.delete()
        except ProtectedError as error:
            counts = Counter(type(obj) for obj in error.protected_objects)
            usage = " and ".join(_plural(n, model) for model, n in counts.items())
            detail = f"This {self.noun} is used by {usage} and can't be deleted."
            return Response(
                {"detail": f"{detail} {self.in_use_hint}".strip(), "in_use": True},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(status=status.HTTP_204_NO_CONTENT)


class CountryViewSet(LookupViewSet):
    queryset = Country.objects.all()
    serializer_class = CountrySerializer
    search_fields = ["name", "code"]
    ordering_fields = ["name", "code"]
    ordering = ["name"]
    noun = "country"
    in_use_hint = "Reassign or delete them first."


class CustomerViewSet(LookupViewSet):
    queryset = Customer.objects.all()
    serializer_class = CustomerSerializer
    search_fields = ["name"]
    ordering_fields = ["name"]
    ordering = ["name"]
    noun = "customer"
    # Customers have no active flag, so the only way out is moving their tickets.
    in_use_hint = "Move those tickets to another customer first."


class SiteViewSet(LookupViewSet):
    queryset = Site.objects.select_related("country")
    serializer_class = SiteSerializer
    search_fields = ["name", "ocn", "address", "country__name", "country__code"]
    ordering_fields = ["name", "ocn", "country__name", "address", "is_active"]
    ordering = ["name", "ocn"]
    noun = "site"
    in_use_hint = "Deactivate it instead."


class WorkDoneCodeViewSet(LookupViewSet):
    queryset = WorkDoneCode.objects.all()
    serializer_class = WorkDoneCodeSerializer
    search_fields = ["code", "description"]
    ordering_fields = ["code", "description", "is_active"]
    ordering = ["code"]
    noun = "work done code"
    in_use_hint = "Deactivate it instead."


class HolidayViewSet(LookupViewSet):
    # `month`/`day` give calendar order across years, which is what matters
    # for recurring holidays (their stored year is ignored).
    queryset = Holiday.objects.select_related("country").annotate(
        month=ExtractMonth("date"), day=ExtractDay("date")
    )
    serializer_class = HolidaySerializer
    search_fields = ["name", "country__name", "country__code"]
    ordering_fields = ["name", "date", "month", "day", "country__name", "is_recurring_annually"]
    ordering = ["month", "day", "name"]
    noun = "holiday"
