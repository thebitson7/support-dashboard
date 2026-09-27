"""Server-side session control on top of SimpleJWT's token blacklist."""

from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken


def revoke_sessions(user) -> int:
    """
    Sign `user` out everywhere: blacklist every unexpired refresh token issued
    to them, so no browser can renew its session. An access token already in
    hand still works until it expires (at most ACCESS_TOKEN_LIFETIME, 5 min).
    Returns how many tokens were revoked.
    """
    live = OutstandingToken.objects.filter(user=user, expires_at__gt=timezone.now()).exclude(
        blacklistedtoken__isnull=False
    )
    revoked = 0
    for token in live:
        _, created = BlacklistedToken.objects.get_or_create(token=token)
        revoked += created
    return revoked
