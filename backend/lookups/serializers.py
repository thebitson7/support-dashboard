"""
Serializers for the Lookups management API.

Uniqueness is checked here explicitly (after normalising, and
case-insensitively) instead of by DRF's automatic validators, which would
compare the raw input ("my" vs "MY") and let a duplicate through to a
database error.
"""

import re

from rest_framework import serializers

from tickets.models import Country, Customer, Holiday, Site, WorkDoneCode

COUNTRY_CODE = re.compile(r"^[A-Z]{2}$")


def ensure_unique(model, instance, message, **lookup):
    qs = model.objects.filter(**lookup)
    if instance is not None:
        qs = qs.exclude(pk=instance.pk)
    if qs.exists():
        raise serializers.ValidationError(message)


class CountrySerializer(serializers.ModelSerializer):
    name = serializers.CharField(max_length=100)
    code = serializers.CharField(max_length=10)  # normalised to 2 letters below

    class Meta:
        model = Country
        fields = ["id", "name", "code"]

    def validate_name(self, value):
        value = value.strip()
        ensure_unique(Country, self.instance, "A country with this name already exists.", name__iexact=value)
        return value

    def validate_code(self, value):
        value = value.strip().upper()
        if not COUNTRY_CODE.match(value):
            raise serializers.ValidationError("Use exactly 2 letters (ISO 3166-1), e.g. MY.")
        ensure_unique(Country, self.instance, "Another country already uses this code.", code=value)
        return value


class CustomerSerializer(serializers.ModelSerializer):
    name = serializers.CharField(max_length=200)

    class Meta:
        model = Customer
        fields = ["id", "name"]

    def validate_name(self, value):
        value = value.strip()
        ensure_unique(Customer, self.instance, "A customer with this name already exists.", name__iexact=value)
        return value


class SiteSerializer(serializers.ModelSerializer):
    country = serializers.PrimaryKeyRelatedField(
        queryset=Country.objects.all(), allow_null=True, required=False
    )
    country_name = serializers.CharField(source="country.name", read_only=True, default=None)
    country_code = serializers.CharField(source="country.code", read_only=True, default=None)

    class Meta:
        model = Site
        fields = ["id", "name", "ocn", "country", "country_name", "country_code", "address", "is_active"]
        validators = []  # the (name, ocn) pair is checked in validate() with a clearer message

    def validate_name(self, value):
        return value.strip()

    def validate_ocn(self, value):
        return value.strip().upper()

    def validate(self, attrs):
        name = attrs.get("name", getattr(self.instance, "name", None))
        ocn = attrs.get("ocn", getattr(self.instance, "ocn", None))
        ensure_unique(
            Site,
            self.instance,
            {"ocn": "This site already has this OCN."},
            name__iexact=name,
            ocn__iexact=ocn,
        )
        return attrs


class WorkDoneCodeSerializer(serializers.ModelSerializer):
    code = serializers.CharField(max_length=20)

    class Meta:
        model = WorkDoneCode
        fields = ["id", "code", "description", "is_active"]

    def validate_code(self, value):
        value = value.strip().upper()
        ensure_unique(WorkDoneCode, self.instance, "This code already exists.", code__iexact=value)
        return value

    def validate_description(self, value):
        return value.strip()


class HolidaySerializer(serializers.ModelSerializer):
    country = serializers.PrimaryKeyRelatedField(
        queryset=Country.objects.all(), allow_null=True, required=False
    )
    country_name = serializers.CharField(source="country.name", read_only=True, default=None)
    country_code = serializers.CharField(source="country.code", read_only=True, default=None)

    class Meta:
        model = Holiday
        fields = [
            "id",
            "name",
            "date",
            "is_recurring_annually",
            "country",
            "country_name",
            "country_code",
        ]

    def validate_name(self, value):
        return value.strip()

    def validate(self, attrs):
        def final(field):
            return attrs[field] if field in attrs else getattr(self.instance, field, None)

        # The same holiday twice in the same scope is almost certainly a mistake.
        ensure_unique(
            Holiday,
            self.instance,
            {"date": "This holiday already exists on this date for this country."},
            name__iexact=final("name"),
            date=final("date"),
            country=final("country"),
        )
        return attrs
