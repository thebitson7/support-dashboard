"""
Ticket activities -> AMS work-log entries ("auto" entries).

A ticket activity with `resolved_by` set is that person's AMS time, so it is
mirrored as one WorkLogEntry (linked by `ticket_activity`, one entry per
activity at most). This module is the only place that writes auto entries.
It is reached from:

* the ticket write serializer, after it saves a ticket and its activities
  (activities are written with bulk_create, which fires no signals);
* a post_save signal on TicketActivity (apps.py), for single saves such as
  the Django admin's inline editor;
* `manage.py sync_ticket_work_logs`, the backfill / repair command.

Deleting an activity deletes its entry by CASCADE. Django applies that in
the ORM for queryset deletes too (`ticket.activities.all().delete()`), so it
needs no signal.

Time rules:

* The entry lies on the activity's start date *in the resolver's own time
  zone* (User.timezone), with start/end times in that zone: the calendar the
  person logs their own hours in. It is cut when the entry is synced; later
  zone changes apply at the next sync of that activity.
* Entries never cross midnight (the same rule as manual ones). An activity
  that runs past midnight in the resolver's zone is clipped to end at 23:59
  on its start date. Its full length still counts on the ticket's own total;
  only the work log is clipped. Splitting it would need two entries for one
  activity.
* An activity shorter than a whole minute (in those times) has no entry.
"""

from datetime import datetime, time

from .models import WorkLogEntry

DAY_END = time(23, 59)


def ticket_label(ticket) -> str:
    """"Ticket #152172RA2778834" (the CMS number people know it by)."""
    return f"Ticket #{ticket.cms_next_ticket_no}"


def ticket_reference(activity) -> str:
    """"Ticket #152172RA2778834 — Troubleshooting"."""
    return f"{ticket_label(activity.ticket)} — {activity.get_activity_type_display()}"


def _minute(moment: datetime) -> time:
    return moment.time().replace(second=0, microsecond=0)


def local_span(activity, tzinfo):
    """(date, start_time, end_time) of the activity in `tzinfo`, clipped to one day."""
    start = activity.start_at.astimezone(tzinfo)
    end = activity.end_at.astimezone(tzinfo)
    end_time = _minute(end) if end.date() == start.date() else DAY_END
    return start.date(), _minute(start), end_time


def sync_activity(activity) -> str:
    """
    Make the activity's auto entry match it: create, update (including moving
    it to a new resolver) or remove it. Returns "created", "updated" or
    "removed", or "none" when there was nothing to do.
    """
    user = activity.resolved_by
    if user is not None:
        day, start_time, end_time = local_span(activity, user.tzinfo)
        if end_time > start_time:
            _, created = WorkLogEntry.objects.update_or_create(
                ticket_activity=activity,
                defaults={
                    "user": user,
                    "date": day,
                    "start_time": start_time,
                    "end_time": end_time,
                    "category": WorkLogEntry.Category.AMS,
                    "note": ticket_reference(activity)[:200],
                },
            )
            return "created" if created else "updated"
    # No resolver (cleared), or no measurable time: no auto entry.
    deleted, _ = WorkLogEntry.objects.filter(ticket_activity=activity).delete()
    return "removed" if deleted else "none"


def sync_ticket(ticket) -> None:
    """Sync every activity of a ticket (after it's saved, or its number changed)."""
    for activity in ticket.activities.select_related("ticket", "resolved_by"):
        sync_activity(activity)
