"""
Entries are now logged as a start and end time; `hours` becomes derived.

Existing rows only have `hours`, so they get times made up from it: each
user's entries on a day are laid out back to back from 09:00 (from 00:00 when
the day holds more than 15 hours, so it still fits), in the order they were
created. Their stored `hours` is left exactly as it was, so no historical
total changes. (A span is capped at 23:59, so a stored total that couldn't
fit in one day keeps its hours but not a matching span.)
"""

from datetime import time

from django.db import migrations, models

LAST_MINUTE = 23 * 60 + 59


def backfill_times(apps, schema_editor):
    WorkLogEntry = apps.get_model("working_hours", "WorkLogEntry")
    days = {}
    for entry in WorkLogEntry.objects.filter(start_time__isnull=True).order_by("created_at", "id"):
        days.setdefault((entry.user_id, entry.date), []).append(entry)

    updated = []
    for entries in days.values():
        total_minutes = sum(round(float(e.hours) * 60) for e in entries)
        cursor = 9 * 60 if total_minutes <= 15 * 60 else 0
        for entry in entries:
            start = min(cursor, LAST_MINUTE)
            end = min(start + round(float(entry.hours) * 60), LAST_MINUTE)
            entry.start_time = time(start // 60, start % 60)
            entry.end_time = time(end // 60, end % 60)
            cursor = end
            updated.append(entry)
    # bulk_update skips save(), so `hours` is untouched, as intended.
    WorkLogEntry.objects.bulk_update(updated, ["start_time", "end_time"], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ("working_hours", "0003_work_log_note"),
    ]

    operations = [
        migrations.AddField(
            model_name="worklogentry",
            name="start_time",
            field=models.TimeField(null=True),
        ),
        migrations.AddField(
            model_name="worklogentry",
            name="end_time",
            field=models.TimeField(null=True),
        ),
        migrations.RunPython(backfill_times, migrations.RunPython.noop),
        migrations.AlterField(
            model_name="worklogentry",
            name="start_time",
            field=models.TimeField(),
        ),
        migrations.AlterField(
            model_name="worklogentry",
            name="end_time",
            field=models.TimeField(),
        ),
        migrations.AlterField(
            model_name="worklogentry",
            name="hours",
            field=models.DecimalField(decimal_places=2, editable=False, max_digits=5),
        ),
        migrations.AlterModelOptions(
            name="worklogentry",
            options={
                "ordering": ["-date", "user", "start_time"],
                "verbose_name_plural": "work log entries",
            },
        ),
    ]
