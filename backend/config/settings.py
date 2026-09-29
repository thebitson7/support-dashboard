"""
Django settings for the support-dashboard API.

Configuration comes from environment variables (loaded from `backend/.env` for
local development; see `.env.example`). Nothing secret is stored in this file.
"""

import os
from datetime import timedelta
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def env_list(name: str, default: str = "") -> list[str]:
    """Read a comma-separated environment variable into a clean list."""
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


def env_bool(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() == "true"


def database_from_url(url: str) -> dict:
    """
    DATABASES["default"] from a URL, e.g.
    postgres://user:password@host:5432/dbname?sslmode=require. Query
    parameters become connection OPTIONS. (Hand-written instead of adding a
    dependency: only PostgreSQL URLs are needed.)
    """
    parts = urlsplit(url)
    if parts.scheme not in ("postgres", "postgresql"):
        raise ImproperlyConfigured(
            f"DATABASE_URL must be a postgres:// URL (got scheme {parts.scheme!r}). "
            "Leave it unset to use the local SQLite file."
        )
    name = unquote(parts.path.lstrip("/"))
    if not name:
        raise ImproperlyConfigured("DATABASE_URL has no database name, e.g. .../support_dashboard.")
    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": name,
        "USER": unquote(parts.username or ""),
        "PASSWORD": unquote(parts.password or ""),
        "HOST": parts.hostname or "",
        "PORT": str(parts.port or ""),
        # Reuse connections for a minute instead of reconnecting per request,
        # and check one is still alive before reusing it.
        "CONN_MAX_AGE": 60,
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": dict(parse_qsl(parts.query)),
    }


# --- Core / security ---------------------------------------------------------

# Required: failing loudly beats Django's less helpful "must not be empty" error.
SECRET_KEY = os.environ.get("SECRET_KEY")
if not SECRET_KEY:
    raise ImproperlyConfigured(
        "SECRET_KEY is not set. Copy backend/.env.example to backend/.env and set a "
        "long random value."
    )

# Off unless explicitly enabled.
DEBUG = os.environ.get("DEBUG", "False").lower() == "true"

ALLOWED_HOSTS = env_list("ALLOWED_HOSTS", "localhost,127.0.0.1")

# Always on. These are Django's defaults, stated here so they're visible and
# can't silently change: no MIME sniffing, no framing, no cross-site referrers.
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"
SECURE_REFERRER_POLICY = "same-origin"
SECURE_CROSS_ORIGIN_OPENER_POLICY = "same-origin"
SESSION_COOKIE_HTTPONLY = True

# HTTPS hardening applies whenever DEBUG is off (i.e. anything but local dev).
if not DEBUG:
    # Off when Django is reached only over a private hop (e.g. the Next.js
    # server calling http://127.0.0.1:8000): a redirect there would break it.
    SECURE_SSL_REDIRECT = env_bool("SECURE_SSL_REDIRECT", True)
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # HSTS is opt-in: browsers remember it, so it is hard to undo. Set it only
    # once HTTPS is confirmed working on every host that serves this site.
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "0"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = env_bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", False)
    SECURE_HSTS_PRELOAD = env_bool("SECURE_HSTS_PRELOAD", False)

# Behind a TLS-terminating proxy that sets X-Forwarded-Proto (and strips any
# client-sent one), so Django knows the original request was HTTPS.
if env_bool("TRUST_X_FORWARDED_PROTO", False):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Origins allowed to POST to Django's own forms, i.e. the /admin/ site when
# it's served over HTTPS on a public host, e.g. https://admin.example.com.
CSRF_TRUSTED_ORIGINS = env_list("CSRF_TRUSTED_ORIGINS")


# --- Applications ------------------------------------------------------------

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "rest_framework",
    "rest_framework_simplejwt.token_blacklist",
    "drf_spectacular",
    "core",
    "accounts",
    "working_hours",
    "tickets",
    "lookups",
    "reports",
    "audit",
]

AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

if not DEBUG:
    # Serves Django's own static files (the admin's CSS/JS) in production,
    # from STATIC_ROOT after `collectstatic`. In development `runserver`
    # serves them itself. Right after SecurityMiddleware, as whitenoise asks.
    MIDDLEWARE.insert(1, "whitenoise.middleware.WhiteNoiseMiddleware")

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"


# No CORS: browsers never call this API directly. They talk to the Next.js
# server (same origin), which calls Django server-to-server with a Bearer
# token taken from its httpOnly cookie.


# --- Django REST framework ---------------------------------------------------

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],
    # Secure by default: an endpoint is private unless it opts out explicitly
    # (as PingView and the JWT token views do).
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    # OpenAPI 3 schema generation (drf-spectacular), served at /api/schema/.
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    # Scoped rates for throttles that opt in (see accounts/throttling.py).
    "DEFAULT_THROTTLE_RATES": {
        # Sign-in attempts per username + client IP.
        "login": os.environ.get("LOGIN_THROTTLE_RATE", "5/5m"),
        # CSV exports per user: each one reads every matching row.
        "exports": os.environ.get("EXPORT_THROTTLE_RATE", "30/h"),
        # Administration writes (create / edit users) per admin.
        "admin_writes": os.environ.get("ADMIN_WRITE_THROTTLE_RATE", "60/h"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=5),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    # Rotation is off: the browser refreshes from several places (tabs, the
    # Next proxy), and rotation + blacklisting would log out whichever lost
    # the race. Logout still blacklists the refresh token explicitly.
    "ROTATE_REFRESH_TOKENS": False,
    # Record each sign-in on the user (Administration's "Last sign-in" column);
    # without this, only Django-admin logins set it.
    "UPDATE_LAST_LOGIN": True,
}

# --- API documentation (drf-spectacular) --------------------------------------
# /api/schema/ (OpenAPI 3, YAML or ?format=json) and /api/docs/ (Swagger UI).
# Open to anyone in local development; admin role only everywhere else. In
# production an admin reaches them through the frontend's own origin
# (https://<frontend>/api/docs), whose gateway adds their Bearer token.

SPECTACULAR_SETTINGS = {
    "TITLE": "Support Dashboard API",
    "DESCRIPTION": (
        "Internal API behind the Support Ticket & Work Stats Dashboard: AMS support "
        "tickets and their activities, staff working hours (manual Non-AMS entries and "
        "AMS time mirrored from ticket activities), the reference data tickets use "
        "(countries, sites, customers, work-done codes, holidays), team reports, user "
        "administration and the audit log.\n\n"
        "Every endpoint needs a JWT access token (`Authorization: Bearer <token>`, from "
        "`POST /api/auth/token/`) unless marked otherwise. Endpoints described as "
        "*admin only* also need the `admin` application role. Browsers never call this "
        "API directly: the Next.js frontend proxies it and keeps the tokens in httpOnly "
        "cookies."
    ),
    "VERSION": "1.0.0",
    # The schema endpoint itself isn't part of the API.
    "SERVE_INCLUDE_SCHEMA": False,
    "SERVE_PERMISSIONS": (
        ["rest_framework.permissions.AllowAny"] if DEBUG else ["accounts.permissions.IsAdminRole"]
    ),
    # Request and response shapes as separate components where they differ
    # (e.g. read-only fields), so the documented request bodies are accurate.
    "COMPONENT_SPLIT_REQUEST": True,
    # One named enum for the audit actions wherever they appear (entries, the
    # `action` filter, the actions list).
    "ENUM_NAME_OVERRIDES": {"AuditActionEnum": "audit.models.AuditLogEntry.Action"},
    # A fixed Swagger UI release from the CDN (the default is "@latest").
    "SWAGGER_UI_DIST": "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.0",
    "SWAGGER_UI_FAVICON_HREF": "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.33.0/favicon-32x32.png",
    # Swagger UI keeps a pasted token across page reloads.
    "SWAGGER_UI_SETTINGS": {"persistAuthorization": True},
}

# The Next.js server calls this API on the browser's behalf, so REMOTE_ADDR is
# the proxy's address. X-Forwarded-For is trusted only when the request comes
# from one of these addresses; anyone else could forge it.
TRUSTED_PROXY_IPS = env_list("TRUSTED_PROXY_IPS", "127.0.0.1,::1")


# --- Cache -------------------------------------------------------------------
# Backs the rate limits. Per-process memory is fine for one dev server, but
# with several API processes each would count separately, so production sets
# REDIS_URL for one shared cache.

REDIS_URL = os.environ.get("REDIS_URL")
CACHES = {
    "default": (
        {
            "BACKEND": "django.core.cache.backends.redis.RedisCache",
            "LOCATION": REDIS_URL,
            "KEY_PREFIX": "support-dashboard",
            # Fail fast if Redis is unreachable (the rate limits then answer
            # 503, see accounts/throttling.py) instead of hanging requests.
            "OPTIONS": {"socket_connect_timeout": 2, "socket_timeout": 2},
        }
        if REDIS_URL
        else {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}
    ),
}


# --- Database ----------------------------------------------------------------

# PostgreSQL when DATABASE_URL is set (production); otherwise the local
# SQLite file, so development needs no database server.
DATABASE_URL = os.environ.get("DATABASE_URL")
DATABASES = {
    "default": (
        database_from_url(DATABASE_URL)
        if DATABASE_URL
        else {"ENGINE": "django.db.backends.sqlite3", "NAME": BASE_DIR / "db.sqlite3"}
    )
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# --- Auth --------------------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    # Applied to every password set through the API (Administration). The
    # dev seed sets its fixed password directly and isn't subject to these.
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 10},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]


# --- Internationalisation ----------------------------------------------------

LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True


# --- Static files ------------------------------------------------------------

STATIC_URL = "static/"
# `manage.py collectstatic` gathers them here; whitenoise serves them.
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
    "staticfiles": {
        # Production: compressed files with content-hashed names (cached
        # forever). Development: plain files, no collectstatic needed.
        "BACKEND": (
            "django.contrib.staticfiles.storage.StaticFilesStorage"
            if DEBUG
            else "whitenoise.storage.CompressedManifestStaticFilesStorage"
        ),
    },
}
# A missing manifest entry falls back to the plain file name instead of
# erroring (e.g. tests run without collectstatic).
WHITENOISE_MANIFEST_STRICT = False


# --- Uploaded files ----------------------------------------------------------
# Stored under MEDIA_ROOT but never served from it: ticket PDFs are only
# downloadable through the authenticated /api/tickets/<id>/attachment/ view.
# MEDIA_URL just has to exist for FileField; nothing is mounted there.

MEDIA_URL = "media/"
MEDIA_ROOT = BASE_DIR / "media"


# --- Email -------------------------------------------------------------------
# The app sends no email yet. Local dev prints to the console; anywhere else
# defaults to SMTP (configure EMAIL_HOST etc. when email is first needed).

MAILERS = {
    "default": {
        "BACKEND": os.environ.get(
            "EMAIL_BACKEND",
            "django.core.mail.backends.console.EmailBackend"
            if DEBUG
            else "django.core.mail.backends.smtp.EmailBackend",
        ),
    },
}
