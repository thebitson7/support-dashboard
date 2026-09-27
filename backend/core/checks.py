"""
Deploy checks: every migration is applied, and the configured cache (Redis,
when REDIS_URL is set) answers.

`runserver` only prints a console warning about unapplied migrations, and a
production WSGI server says nothing, so a missing table (e.g. the audit log
before `migrate`) shows up as a 500 on first use. `check --deploy` fails on
it instead, so a release can't go out ahead of its migrations.
"""

from django.conf import settings
from django.core.cache import cache
from django.core.checks import Error, register
from django.db import DEFAULT_DB_ALIAS, connections
from django.db.migrations.executor import MigrationExecutor


@register(deploy=True)
def unapplied_migrations(app_configs=None, **kwargs):
    try:
        executor = MigrationExecutor(connections[DEFAULT_DB_ALIAS])
        plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
    except Exception as error:  # no database to inspect: report it, don't crash the check run
        return [Error(f"Couldn't read the migration state: {error}", id="core.E002")]
    if not plan:
        return []
    names = ", ".join(f"{m.app_label}.{m.name}" for m, _ in plan)
    return [
        Error(
            f"{len(plan)} unapplied migration(s): {names}.",
            hint="Run `python manage.py migrate` before starting the server.",
            id="core.E001",
        )
    ]


@register(deploy=True)
def cache_reachable(app_configs=None, **kwargs):
    """REDIS_URL set but Redis unreachable would make sign-in answer 503: catch it before release."""
    if not getattr(settings, "REDIS_URL", None):
        return []
    try:
        cache.set("deploy-check", "ok", 10)
        if cache.get("deploy-check") != "ok":
            raise RuntimeError("wrote a key but couldn't read it back")
    except Exception as error:  # any failure means the rate limits can't work
        return [
            Error(
                f"REDIS_URL is set but the cache can't be used: {error}",
                hint="Start Redis or fix REDIS_URL; until then sign-in and CSV exports answer 503.",
                id="core.E003",
            )
        ]
    return []
