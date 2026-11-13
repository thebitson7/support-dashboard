"""
Query-parameter parsing shared by the API views: ids, dates, instants and
time zones. Each turns a bad value into a 400 naming the parameter (DRF's
usual `{"<param>": "<message>"}` shape) instead of a 500 or a silently
ignored filter.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils.dateparse import parse_date, parse_datetime
from rest_framework.exceptions import ValidationError

# The largest id the database's 64-bit integer columns hold; a bigger one
# would overflow in the query (a 500), so it's refused as invalid instead.
MAX_ID = 2**63 - 1


def is_positive_id(raw: str) -> bool:
    """A plain positive integer that fits an id column: "17" yes; "0", "-3", "1.5", "²", "1e3" no."""
    # isascii() matters: str.isdigit() accepts "²", which int() rejects.
    return raw.isascii() and raw.isdigit() and 0 < int(raw) <= MAX_ID


def positive_id(raw: str, name: str, message: str) -> int:
    """`raw` as an id, or a 400 `{name: message}`. Callers strip whitespace first if they allow it."""
    if not is_positive_id(raw):
        raise ValidationError({name: message})
    return int(raw)


def parse_day(raw: str, name: str) -> date:
    """A YYYY-MM-DD date, or a 400 (impossible dates such as 2026-02-30 included)."""
    try:
        value = parse_date(raw)
    except ValueError:  # well-formed but impossible, e.g. 2026-02-30
        value = None
    if value is None:
        raise ValidationError({name: "Use a YYYY-MM-DD date."})
    return value


def query_day(params, name: str) -> date | None:
    """The `name` parameter as a date; None when it's absent or empty."""
    raw = params.get(name)
    return parse_day(raw, name) if raw else None


def query_instant(params, name: str) -> datetime | None:
    """The `name` parameter as an ISO 8601 date-time with a UTC offset; None when absent or empty."""
    raw = params.get(name)
    if not raw:
        return None
    try:
        value = parse_datetime(raw)
    except ValueError:  # well-formed but impossible, e.g. 30 February
        value = None
    if value is None or value.tzinfo is None:
        raise ValidationError({name: "Use an ISO 8601 date-time with a UTC offset."})
    return value


def query_timezone(params, default: ZoneInfo, name: str = "tz") -> ZoneInfo:
    """An IANA zone from the `tz` parameter (the browser's, so files match the screen), else `default`."""
    requested = params.get(name)
    if not requested:
        return default
    try:
        return ZoneInfo(requested)
    except (ZoneInfoNotFoundError, ValueError):
        raise ValidationError({name: "Use an IANA time zone name, e.g. Asia/Kuala_Lumpur."})
