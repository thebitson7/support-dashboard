"""
Rate limits (DRF throttling; no extra dependency). Counters live in the
default cache: per process locally, shared Redis in production (REDIS_URL).
"""

import hashlib
import ipaddress
import re
from collections.abc import Mapping

from django.conf import settings
from rest_framework.permissions import SAFE_METHODS
from rest_framework.throttling import SimpleRateThrottle, UserRateThrottle

_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def _valid_ip(value: str) -> str | None:
    try:
        return str(ipaddress.ip_address(value.strip()))
    except ValueError:
        return None


def client_ip(request) -> str:
    """
    The browser's IP. Behind the Next.js proxy REMOTE_ADDR is the proxy, so
    the right-most X-Forwarded-For entry (the one the proxy added) is used,
    but only when the request really comes from a trusted proxy, and only if
    it is a well-formed IP address. Anything else (garbage, a spreadsheet
    formula, an over-long string) falls back to REMOTE_ADDR, so it can't end
    up in the audit log or be used to mint fresh sign-in throttle keys.
    """
    remote = request.META.get("REMOTE_ADDR", "")
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded and remote in settings.TRUSTED_PROXY_IPS:
        return _valid_ip(forwarded.split(",")[-1]) or remote
    return remote


class WindowRateMixin:
    """Rates as DRF's "5/m", or with a window size, e.g. "5/5m", "30/2h"."""

    def parse_rate(self, rate):
        if rate is None:
            return (None, None)
        count, period = rate.split("/")
        match = re.fullmatch(r"(\d*)([smhd])\w*", period.strip())
        if not match:
            raise ValueError(f"Invalid throttle rate: {rate!r}")
        return int(count), int(match[1] or 1) * _UNIT_SECONDS[match[2]]


class LoginRateThrottle(WindowRateMixin, SimpleRateThrottle):
    """
    N attempts per (username, client IP) per window. Keying on both means one
    attacker can't lock a user out from everywhere, and one IP can't spray
    guesses at a single account. Successful attempts count too, which keeps
    the rule simple and predictable.
    """

    scope = "login"

    def get_cache_key(self, request, view):
        data = request.data if isinstance(request.data, Mapping) else {}
        username = str(data.get("username", "")).strip().lower()
        ident = hashlib.sha256(f"{username}\0{client_ip(request)}".encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}


class ExportRateThrottle(WindowRateMixin, UserRateThrottle):
    """
    CSV exports per signed-in user (EXPORT_THROTTLE_RATE, default 30/h). Each
    export reads every matching row, so repeating it is the cheapest way to
    load the database; ordinary use is a handful an hour.
    """

    scope = "exports"


class AdminWriteRateThrottle(WindowRateMixin, UserRateThrottle):
    """
    Administration writes (creating or editing users) per admin
    (ADMIN_WRITE_THROTTLE_RATE, default 60/h). Reads aren't limited.
    """

    scope = "admin_writes"

    def allow_request(self, request, view):
        if request.method in SAFE_METHODS:
            return True
        return super().allow_request(request, view)
