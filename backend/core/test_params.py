"""
The shared query-parameter parsers (core/params.py). Errors keep the API's
existing shape: `{"<param>": "<message>"}`, a string, not a list.
"""

from datetime import date, datetime, timedelta, timezone as dt_timezone
from zoneinfo import ZoneInfo

from django.http import QueryDict
from django.test import SimpleTestCase
from rest_framework.exceptions import ValidationError

from core.params import (
    MAX_ID,
    is_positive_id,
    positive_id,
    query_day,
    query_instant,
    query_timezone,
)

KL = ZoneInfo("Asia/Kuala_Lumpur")


def params(query: str) -> QueryDict:
    return QueryDict(query)


class PositiveIdTests(SimpleTestCase):
    def test_accepts_plain_positive_integers_up_to_the_column_size(self):
        for raw in ("1", "17", "007", str(MAX_ID)):
            with self.subTest(raw=raw):
                self.assertTrue(is_positive_id(raw))

    def test_rejects_everything_else(self):
        # "²" is a digit to str.isdigit() but not to int(); the overflow one would be a 500.
        for raw in ("", "0", "-3", "+3", "1.5", "1e3", " 7", "7 ", "abc", "²", "٣", str(MAX_ID + 1)):
            with self.subTest(raw=raw):
                self.assertFalse(is_positive_id(raw))

    def test_positive_id_returns_the_int_or_names_the_parameter(self):
        self.assertEqual(positive_id("42", "site", "Must be a site id."), 42)
        with self.assertRaises(ValidationError) as caught:
            positive_id("x", "site", "Must be a site id.")
        self.assertEqual(caught.exception.detail, {"site": "Must be a site id."})


class QueryDayTests(SimpleTestCase):
    def test_absent_or_empty_is_none(self):
        self.assertIsNone(query_day(params(""), "date"))
        self.assertIsNone(query_day(params("date="), "date"))

    def test_parses_iso_dates(self):
        self.assertEqual(query_day(params("date=2026-03-04"), "date"), date(2026, 3, 4))

    def test_malformed_and_impossible_dates_are_a_400(self):
        for raw in ("04/03/2026", "2026-3-4x", "2026-02-30", "2026-13-01"):
            with self.subTest(raw=raw), self.assertRaises(ValidationError) as caught:
                query_day(params(f"start_date={raw}"), "start_date")
            self.assertEqual(caught.exception.detail, {"start_date": "Use a YYYY-MM-DD date."})


class QueryInstantTests(SimpleTestCase):
    def test_absent_is_none(self):
        self.assertIsNone(query_instant(params(""), "received_after"))

    def test_needs_an_offset(self):
        value = query_instant(params("t=2026-03-04T09:00:00%2B08:00"), "t")
        assert value is not None
        self.assertEqual(value, datetime(2026, 3, 4, 1, 0, tzinfo=dt_timezone.utc))
        self.assertEqual(value.utcoffset(), timedelta(hours=8))
        for raw in ("2026-03-04T09:00:00", "2026-02-30T09:00:00Z", "yesterday"):
            with self.subTest(raw=raw), self.assertRaises(ValidationError) as caught:
                query_instant(params(f"t={raw}"), "t")
            self.assertEqual(caught.exception.detail, {"t": "Use an ISO 8601 date-time with a UTC offset."})


class QueryTimezoneTests(SimpleTestCase):
    def test_default_when_absent_or_empty(self):
        self.assertIs(query_timezone(params(""), default=KL), KL)
        self.assertIs(query_timezone(params("tz="), default=KL), KL)

    def test_a_known_zone(self):
        self.assertEqual(query_timezone(params("tz=Asia/Manila"), default=KL).key, "Asia/Manila")

    def test_unknown_or_malicious_zones_are_a_400(self):
        for raw in ("Mars/Olympus", "../../etc/passwd", "Asia/Kuala_Lumpur\x00"):
            with self.subTest(raw=raw), self.assertRaises(ValidationError) as caught:
                query_timezone({"tz": raw}, default=KL)
            self.assertEqual(caught.exception.detail, {"tz": "Use an IANA time zone name, e.g. Asia/Kuala_Lumpur."})
