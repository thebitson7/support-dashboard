"""
Deploy check: every migration is applied.

`runserver` only prints a console warning about unapplied migrations, and a
production WSGI server says nothing, so a missing table (e.g. the audit log
before `migrate`) shows up as a 500 on first use. `check --deploy` fails on
it instead, so a release can't go out ahead of its migrations.
"""

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
