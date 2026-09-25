"""
Django settings for the support-dashboard API.

Configuration comes from environment variables (loaded from `backend/.env` for
local development; see `.env.example`). Nothing secret is stored in this file.
"""

import os
from datetime import timedelta
from pathlib import Path

from django.core.exceptions import ImproperlyConfigured
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

load_dotenv(BASE_DIR / ".env")


def env_list(name: str, default: str = "") -> list[str]:
    """Read a comma-separated environment variable into a clean list."""
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


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

# HTTPS hardening applies whenever DEBUG is off (i.e. anything but local dev).
if not DEBUG:
    SECURE_SSL_REDIRECT = os.environ.get("SECURE_SSL_REDIRECT", "True").lower() == "true"
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    # HSTS is opt-in: it is hard to undo, so set a value only once HTTPS is confirmed.
    SECURE_HSTS_SECONDS = int(os.environ.get("SECURE_HSTS_SECONDS", "0"))


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
    "corsheaders",
    "core",
    "accounts",
    "working_hours",
]

AUTH_USER_MODEL = "accounts.User"

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

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


# --- CORS: only the frontend origin(s) may call the API from a browser --------

CORS_ALLOWED_ORIGINS = env_list("CORS_ALLOWED_ORIGINS", "http://localhost:3000")


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
    # Scoped rates for throttles that opt in (see accounts/throttling.py).
    "DEFAULT_THROTTLE_RATES": {
        # Sign-in attempts per username + client IP.
        "login": os.environ.get("LOGIN_THROTTLE_RATE", "5/5m"),
    },
}

SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=5),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=1),
    # Rotation is off: the browser refreshes from several places (tabs, the
    # Next proxy), and rotation + blacklisting would log out whichever lost
    # the race. Logout still blacklists the refresh token explicitly.
    "ROTATE_REFRESH_TOKENS": False,
}

# The Next.js server calls this API on the browser's behalf, so REMOTE_ADDR is
# the proxy's address. X-Forwarded-For is trusted only when the request comes
# from one of these addresses; anyone else could forge it.
TRUSTED_PROXY_IPS = env_list("TRUSTED_PROXY_IPS", "127.0.0.1,::1")


# --- Cache -------------------------------------------------------------------
# Backs the login throttle. Per-process memory is fine for one dev server; use
# a shared cache (Redis/Memcached) once there is more than one API process.

CACHES = {
    "default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"},
}


# --- Database ----------------------------------------------------------------

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
    }
}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"


# --- Auth --------------------------------------------------------------------

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
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


# --- Email -------------------------------------------------------------------
# Development-only: messages are printed to the console. Configure a real
# backend before sending email in production (`check --deploy` flags this).

MAILERS = {
    "default": {
        "BACKEND": "django.core.mail.backends.console.EmailBackend",
    },
}
