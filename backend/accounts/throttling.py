"""Login rate limiting (DRF throttling; no extra dependency)."""

import hashlib
import re
from collections.abc import Mapping

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle

_UNIT_SECONDS = {"s": 1, "m": 60, "h": 3600, "d": 86400}


def client_ip(request) -> str:
    """
    The browser's IP. Behind the Next.js proxy REMOTE_ADDR is the proxy, so
    the right-most X-Forwarded-For entry (the one the proxy added) is used,
    but only when the request really comes from a trusted proxy.
    """
    remote = request.META.get("REMOTE_ADDR", "")
    forwarded = request.META.get("HTTP_X_FORWARDED_FOR", "")
    if forwarded and remote in settings.TRUSTED_PROXY_IPS:
        return forwarded.split(",")[-1].strip() or remote
    return remote


class LoginRateThrottle(SimpleRateThrottle):
    """
    N attempts per (username, client IP) per window. Keying on both means one
    attacker can't lock a user out from everywhere, and one IP can't spray
    guesses at a single account. Successful attempts count too, which keeps
    the rule simple and predictable.
    """

    scope = "login"

    def parse_rate(self, rate):
        """DRF only understands "5/m"; this also accepts a window size, e.g. "5/5m"."""
        if rate is None:
            return (None, None)
        count, period = rate.split("/")
        match = re.fullmatch(r"(\d*)([smhd])\w*", period.strip())
        if not match:
            raise ValueError(f"Invalid throttle rate: {rate!r}")
        return int(count), int(match[1] or 1) * _UNIT_SECONDS[match[2]]

    def get_cache_key(self, request, view):
        data = request.data if isinstance(request.data, Mapping) else {}
        username = str(data.get("username", "")).strip().lower()
        ident = hashlib.sha256(f"{username}\0{client_ip(request)}".encode()).hexdigest()
        return self.cache_format % {"scope": self.scope, "ident": ident}
