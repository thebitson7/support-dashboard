"""
Overlap warnings with confirmation (working_hours/overlaps.py): the pure
range arithmetic, the 409 contract on both write paths (work-log entries and
tickets), what is and isn't checked on an edit, atomicity, time zones, the
audit trail, and the read-time flags with their constant query count.
"""

from datetime import date, datetime, time, timedelta, timezone as dt_timezone

from django.db import connection
from django.test import SimpleTestCase
from django.test.utils import CaptureQueriesContext

from audit.models import AuditLogEntry
from tickets.models import Ticket, TicketActivity
from working_hours.models import WorkLogEntry
from working_hours.overlaps import (
    TimeRange,
    covered_minutes,
    double_counted_minutes,
    find_overlaps,
    overlap_minutes,
)
from working_hours.test_auto_entries import MARCH_4, T0, TICKETS_URL, AutoEntryTestCase, iso

ENTRIES_URL = "/api/working-hours/entries/"
EXPORT_URL = "/api/reports/team-activity/export/"
REPORT_URL = "/api/reports/team-activity/"
A = AuditLogEntry.Action


def r(start: str, end: str, day: date = MARCH_4, ref=None) -> TimeRange:
    h1, m1 = map(int, start.split(":"))
    h2, m2 = map(int, end.split(":"))
    return TimeRange(day, time(h1, m1), time(h2, m2), ref=ref)


def kl(hour: int, minute: int = 0, day: int = 4) -> datetime:
    """A Kuala Lumpur (UTC+8) wall-clock time in March 2026, as UTC."""
    return datetime(2026, 3, day, hour, minute, tzinfo=dt_timezone(timedelta(hours=8))).astimezone(dt_timezone.utc)


# --- The pure module ----------------------------------------------------------------


class RangeArithmeticTests(SimpleTestCase):
    def test_touching_ranges_do_not_overlap(self):
        self.assertEqual(overlap_minutes(r("09:00", "10:00"), r("10:00", "11:00")), 0)
        self.assertEqual(find_overlaps([r("10:00", "11:00")], [r("09:00", "10:00")]), [])

    def test_partial_overlap(self):
        self.assertEqual(overlap_minutes(r("09:00", "10:00"), r("09:30", "10:30")), 30)

    def test_containment(self):
        self.assertEqual(overlap_minutes(r("09:00", "12:00"), r("10:15", "10:45")), 30)

    def test_identical_ranges(self):
        self.assertEqual(overlap_minutes(r("09:00", "10:00"), r("09:00", "10:00")), 60)

    def test_different_dates_never_overlap(self):
        other_day = r("09:00", "10:00", day=date(2026, 3, 5))
        self.assertEqual(overlap_minutes(r("09:00", "10:00"), other_day), 0)

    def test_minute_arithmetic(self):
        self.assertEqual(overlap_minutes(r("09:15", "10:50"), r("10:05", "11:00")), 45)
        self.assertEqual(overlap_minutes(r("23:00", "23:59"), r("23:58", "23:59")), 1)

    def test_symmetric(self):
        a, b = r("08:40", "09:20"), r("09:05", "11:00")
        self.assertEqual(overlap_minutes(a, b), overlap_minutes(b, a))
        (ab,) = find_overlaps([a], [b])
        (ba,) = find_overlaps([b], [a])
        self.assertEqual((ab.start, ab.end, ab.minutes), (ba.start, ba.end, ba.minutes))
        self.assertEqual((ab.start, ab.end), (time(9, 5), time(9, 20)))

    def test_end_must_be_after_start(self):
        with self.assertRaises(ValueError):
            r("10:00", "10:00")

    def test_a_request_overlapping_itself_reports_each_pair_once(self):
        found = find_overlaps([r("09:00", "11:00", ref=1), r("09:30", "10:30", ref=2), r("10:00", "12:00", ref=3)], [])
        self.assertEqual(sorted((o.candidate.ref, o.other.ref) for o in found), [(1, 2), (1, 3), (2, 3)])
        self.assertTrue(all(o.same_request for o in found))

    def test_peers_are_compared_with_candidates_but_never_with_each_other(self):
        peers = [r("09:00", "10:00", ref=1), r("09:30", "10:30", ref=2)]
        self.assertEqual(find_overlaps([], [], peers), [])
        (hit,) = find_overlaps([r("10:15", "10:45", ref=3)], [], peers)
        self.assertEqual((hit.candidate.ref, hit.other.ref, hit.minutes), (3, 2, 15))

    def test_covered_and_double_counted_minutes(self):
        ranges = [r("09:00", "10:00"), r("09:30", "10:30"), r("09:45", "10:00"), r("11:00", "12:00")]
        # 09:30-10:30 is covered 09:30-10:00 twice over: 30 minutes, counted once.
        self.assertEqual(covered_minutes(ranges), [30, 30, 15, 0])
        # 60 + 60 + 15 + 60 = 195 summed; 09:00-10:30 + 11:00-12:00 = 150 covered.
        self.assertEqual(double_counted_minutes(ranges), 45)
        self.assertEqual(double_counted_minutes([r("09:00", "10:00"), r("10:00", "11:00")]), 0)


# --- The API --------------------------------------------------------------------------


class OverlapTestCase(AutoEntryTestCase):
    def log(self, start, end, day="2026-03-04", **extra):
        return self.client.post(
            ENTRIES_URL, {"date": day, "start_time": start, "end_time": end, **extra}, format="json"
        )

    def manual(self, start, end, user=None, day=MARCH_4, note=""):
        h1, m1 = map(int, start.split(":"))
        h2, m2 = map(int, end.split(":"))
        return WorkLogEntry.objects.create(
            user=user or self.alice,
            date=day,
            start_time=time(h1, m1),
            end_time=time(h2, m2),
            category=WorkLogEntry.Category.NON_AMS,
            note=note,
        )

    def ticket_body(self, activities, number="152172RA2778834", **extra):
        return {
            "received_at": iso(T0),
            "cms_next_ticket_no": number,
            "site": self.site.pk,
            "customer": self.customer.pk,
            "assigned_to": self.alice.pk,
            "ticket_type": "software",
            "incoming_channel": "email",
            "cms_added_on": iso(T0),
            "issue_description": "Analyzer stops sending results to the LIS.",
            "notes": "Reported this morning.",
            "activities": activities,
            **extra,
        }

    def post_ticket(self, activities, **extra):
        return self.client.post(TICKETS_URL, self.ticket_body(activities, **extra), format="json")

    def act(self, start: datetime, end: datetime, user=None, **extra):
        return self.activity(start=start, minutes=round((end - start).total_seconds() / 60), resolved_by=user, **extra)

    def assert_overlap_409(self, response, count=1):
        self.assertEqual(response.status_code, 409, response.content)
        body = response.json()
        self.assertEqual(body["code"], "overlap_confirmation_required")
        self.assertTrue(body["detail"])
        self.assertEqual(len(body["overlaps"]), count, body["overlaps"])
        return body["overlaps"]


class ManualEntryOverlapTests(OverlapTestCase):
    def test_overlapping_another_manual_entry_needs_confirmation(self):
        self.assertEqual(self.log("09:00", "10:00").status_code, 201)
        audit_before = AuditLogEntry.objects.count()

        (item,) = self.assert_overlap_409(self.log("09:30", "10:30", note="Report"))
        self.assertEqual(
            item,
            {
                "kind": "manual_entry",
                "person": {"id": self.alice.pk, "name": "Alice"},
                "date": "2026-03-04",
                "start": "09:30",
                "end": "10:30",
                "conflicting_start": "09:00",
                "conflicting_end": "10:00",
                "overlap_start": "09:30",
                "overlap_end": "10:00",
                "overlap_minutes": 30,
                "label": "Manual entry",
                "activity": None,
                "conflicting_activity": None,
                "conflicting_ticket": None,
            },
        )
        self.assertEqual(WorkLogEntry.objects.count(), 1)  # nothing saved
        self.assertEqual(AuditLogEntry.objects.count(), audit_before)

    def test_confirmed_overlap_saves_and_is_flagged(self):
        self.log("09:00", "10:00")
        response = self.log("09:30", "10:30", confirm_overlaps=True)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertNotIn("confirm_overlaps", response.json())
        self.assertEqual((response.json()["overlaps_with_other_time"], response.json()["overlap_minutes"]), (True, 30))
        self.assertEqual(WorkLogEntry.objects.count(), 2)

        entries = self.client.get(ENTRIES_URL, {"date": "2026-03-04"}).json()
        self.assertEqual([(e["overlaps_with_other_time"], e["overlap_minutes"]) for e in entries], [(True, 30)] * 2)
        # Totals still count the overlap twice (as agreed): 60 + 60.
        today = self.client.get("/api/working-hours/summary/").json()["periods"][0]
        self.assertEqual(today["total_minutes"], 120)

    def test_the_label_carries_the_note(self):
        self.manual("09:00", "10:00", note="LIS outage")
        (item,) = self.assert_overlap_409(self.log("09:30", "10:30"))
        self.assertEqual(item["label"], "Manual entry (LIS outage)")

    def test_touching_times_do_not_warn(self):
        self.manual("09:00", "10:00")
        self.assertEqual(self.log("10:00", "11:00").status_code, 201)
        self.assertEqual(self.log("08:00", "09:00").status_code, 201)

    def test_another_persons_time_is_not_an_overlap(self):
        self.manual("09:00", "10:00", user=self.bob)
        self.assertEqual(self.log("09:00", "10:00").status_code, 201)

    def test_other_dates_are_not_compared(self):
        self.manual("09:00", "10:00", day=date(2026, 3, 3))
        self.assertEqual(self.log("09:00", "10:00").status_code, 201)

    def test_overlapping_an_auto_entry_is_caught(self):
        ticket = self.create_ticket([self.activity(resolved_by=self.alice)])  # 09:00-11:00
        (item,) = self.assert_overlap_409(self.log("10:30", "11:30"))
        self.assertEqual(item["kind"], "ticket_activity")
        self.assertEqual(item["label"], "Ticket #152172RA2778834 (Troubleshooting)")
        self.assertEqual(item["conflicting_ticket"], ticket.pk)
        self.assertEqual((item["overlap_start"], item["overlap_end"], item["overlap_minutes"]), ("10:30", "11:00", 30))

    def test_editing_without_moving_the_time_is_not_rechecked(self):
        first = self.manual("09:00", "10:00")
        second = self.log("09:30", "10:30", confirm_overlaps=True).json()
        # A note edit of a confirmed-overlapping entry: not re-checked.
        response = self.client.patch(f"{ENTRIES_URL}{second['id']}/", {"note": "Wrap-up"}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        # Resending its own unchanged times: not re-checked either.
        response = self.client.patch(
            f"{ENTRIES_URL}{first.pk}/", {"start_time": "09:00", "end_time": "10:00"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_an_entry_never_overlaps_itself(self):
        entry = self.manual("09:00", "10:00")
        response = self.client.patch(
            f"{ENTRIES_URL}{entry.pk}/", {"start_time": "09:30", "end_time": "10:30"}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)

    def test_moving_an_entry_onto_other_time_needs_confirmation(self):
        self.manual("09:00", "10:00")
        entry = self.manual("11:00", "12:00")
        response = self.client.patch(f"{ENTRIES_URL}{entry.pk}/", {"start_time": "09:45"}, format="json")
        (item,) = self.assert_overlap_409(response)
        self.assertEqual(item["overlap_minutes"], 15)
        entry.refresh_from_db()
        self.assertEqual(entry.start_time, time(11, 0))  # unchanged
        response = self.client.patch(
            f"{ENTRIES_URL}{entry.pk}/", {"start_time": "09:45", "confirm_overlaps": True}, format="json"
        )
        self.assertEqual(response.status_code, 200, response.content)
        log = AuditLogEntry.objects.filter(action=A.WORK_LOG_UPDATED).latest("id")
        self.assertEqual((log.metadata["overlap_confirmed"], log.metadata["overlap_count"]), (True, 1))

    def test_a_validation_error_wins_over_an_overlap(self):
        self.manual("09:00", "10:00")
        response = self.log("09:30", "10:30", day="2026-03-05")  # future (and would overlap nothing)
        self.assertEqual(response.status_code, 400)
        self.manual("09:00", "10:00", day=date(2026, 3, 5))
        self.assertEqual(self.log("09:30", "10:30", day="2026-03-05").status_code, 400)
        response = self.log("10:30", "09:30")
        self.assertEqual(response.status_code, 400)
        self.assertIn("end_time", response.json())

    def test_the_daily_cap_is_unchanged(self):
        self.manual("00:00", "23:00")
        response = self.log("09:00", "11:00", confirm_overlaps=True)
        self.assertEqual(response.status_code, 400)  # 23 h + 2 h > 24 h, overlap or not
        self.assertIn("24 h", response.json()["end_time"][0])

    def test_audit_metadata_on_a_confirmed_overlap(self):
        self.manual("09:00", "10:00")
        self.manual("09:15", "09:30")
        self.log("09:20", "09:50", confirm_overlaps=True)
        log = AuditLogEntry.objects.get(action=A.WORK_LOG_CREATED)
        self.assertEqual((log.metadata["overlap_confirmed"], log.metadata["overlap_count"]), (True, 2))

    def test_no_overlap_leaves_the_audit_metadata_as_it_was(self):
        self.log("09:00", "10:00")
        log = AuditLogEntry.objects.get(action=A.WORK_LOG_CREATED)
        self.assertNotIn("overlap_confirmed", log.metadata)


class TicketActivityOverlapTests(OverlapTestCase):
    def test_an_activity_overlapping_a_manual_entry_is_caught_and_nothing_is_written(self):
        self.manual("09:00", "10:00")
        audit_before = AuditLogEntry.objects.count()
        response = self.post_ticket([self.act(kl(9, 30), kl(10, 30), self.alice)])
        (item,) = self.assert_overlap_409(response)
        self.assertEqual(
            {k: item[k] for k in ("kind", "start", "end", "overlap_minutes", "label", "activity")},
            {
                "kind": "manual_entry",
                "start": "09:30",
                "end": "10:30",
                "overlap_minutes": 30,
                "label": "Manual entry",
                "activity": 1,
            },
        )
        self.assertEqual(Ticket.objects.count(), 0)
        self.assertEqual(TicketActivity.objects.count(), 0)
        self.assertEqual(WorkLogEntry.objects.count(), 1)
        self.assertEqual(AuditLogEntry.objects.count(), audit_before)

        response = self.post_ticket([self.act(kl(9, 30), kl(10, 30), self.alice)], confirm_overlaps=True)
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(WorkLogEntry.objects.count(), 2)
        log = AuditLogEntry.objects.get(action=A.TICKET_CREATED)
        self.assertEqual((log.metadata["overlap_confirmed"], log.metadata["overlap_count"]), (True, 1))

    def test_an_activity_overlapping_another_tickets_activity_is_caught(self):
        other = self.create_ticket([self.activity(resolved_by=self.alice)], number="CMS1002")  # 09:00-11:00
        (item,) = self.assert_overlap_409(self.post_ticket([self.act(kl(10, 0), kl(10, 45), self.alice)]))
        self.assertEqual(item["kind"], "ticket_activity")
        self.assertEqual(item["label"], "Ticket #CMS1002 (Troubleshooting)")
        self.assertEqual(item["conflicting_ticket"], other.pk)
        self.assertEqual((item["overlap_start"], item["overlap_end"], item["overlap_minutes"]), ("10:00", "10:45", 45))

    def test_different_resolvers_at_the_same_time_are_not_flagged(self):
        response = self.post_ticket(
            [self.act(kl(9), kl(10), self.alice), self.act(kl(9), kl(10), self.bob)],
        )
        self.assertEqual(response.status_code, 201, response.content)

    def test_an_activity_without_a_resolver_is_never_flagged(self):
        self.manual("09:00", "10:00")
        response = self.post_ticket([self.act(kl(9), kl(10)), self.act(kl(9), kl(10))])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(WorkLogEntry.objects.filter(ticket_activity__isnull=False).count(), 0)

    def test_activities_in_one_request_overlapping_each_other(self):
        response = self.post_ticket(
            [
                self.act(kl(9), kl(10), self.alice),
                self.act(kl(9, 30), kl(10, 30), self.alice),
                self.act(kl(9, 45), kl(11), self.alice),
            ]
        )
        items = self.assert_overlap_409(response, count=3)  # each pair once
        self.assertEqual({(i["activity"], i["conflicting_activity"]) for i in items}, {(1, 2), (1, 3), (2, 3)})
        self.assertTrue(all(i["kind"] == "same_request" for i in items))
        first = next(i for i in items if (i["activity"], i["conflicting_activity"]) == (1, 2))
        self.assertEqual((first["label"], first["overlap_minutes"]), ("Activity 2", 30))

    def test_resending_its_own_activities_does_not_flag_the_ticket_against_itself(self):
        ticket = self.create_ticket([self.activity(resolved_by=self.alice)])
        self.patch_ticket(ticket, {"activities": [self.activity(resolved_by=self.alice)], "notes": "Updated."})
        # Moved within its own old time: still only itself.
        self.patch_ticket(
            ticket, {"activities": [self.activity(start=T0 + timedelta(minutes=30), resolved_by=self.alice)]}
        )

    def test_unchanged_activities_are_not_rechecked_after_a_confirmed_overlap(self):
        self.manual("09:00", "10:00")
        ticket_activities = [self.act(kl(9, 30), kl(10, 30), self.alice)]
        response = self.post_ticket(ticket_activities, confirm_overlaps=True)
        ticket = Ticket.objects.get(pk=response.json()["id"])
        # Notes only, activities resent as they are: no 409.
        self.patch_ticket(ticket, {"notes": "Second look.", "activities": ticket_activities})
        # A new type or code on the same times is still "unchanged" for overlap purposes.
        self.patch_ticket(ticket, {"activities": [{**ticket_activities[0], "activity_type": "follow_up"}]})
        # Close it, then reopen it, activities resent unchanged each time.
        closing = {
            "resolution_verified_by": self.alice.pk,
            "resolution_verified_on": iso(kl(12)),
            "cms_closed_by": self.alice.pk,
            "cms_closed_on": iso(kl(12)),
            "service_closed_date": iso(kl(12)),
        }
        self.patch_ticket(ticket, {**closing, "activities": ticket_activities})
        self.patch_ticket(ticket, {**dict.fromkeys(closing), "activities": ticket_activities})

    def test_changed_times_or_resolver_are_rechecked(self):
        self.manual("09:00", "10:00")
        self.manual("09:00", "10:00", user=self.bob)
        response = self.post_ticket([self.act(kl(9, 30), kl(10, 30), self.alice)], confirm_overlaps=True)
        ticket = Ticket.objects.get(pk=response.json()["id"])
        url = f"{TICKETS_URL}{ticket.pk}/"
        # New times.
        moved = self.client.patch(url, {"activities": [self.act(kl(9, 40), kl(10, 30), self.alice)]}, format="json")
        self.assert_overlap_409(moved)
        # Same times, another resolver.
        handed = self.client.patch(url, {"activities": [self.act(kl(9, 30), kl(10, 30), self.bob)]}, format="json")
        (item,) = self.assert_overlap_409(handed)
        self.assertEqual(item["person"]["id"], self.bob.pk)

    def test_a_new_activity_is_compared_with_unchanged_siblings(self):
        kept = self.act(kl(9), kl(10), self.alice)
        ticket = self.create_ticket([kept])
        response = self.client.patch(
            f"{TICKETS_URL}{ticket.pk}/",
            {"activities": [kept, self.act(kl(9, 30), kl(10, 30), self.alice)]},
            format="json",
        )
        (item,) = self.assert_overlap_409(response)
        self.assertEqual((item["kind"], item["activity"], item["conflicting_activity"]), ("same_request", 2, 1))

    def test_update_is_atomic_on_409(self):
        self.manual("09:00", "10:00")
        ticket = self.create_ticket([self.act(kl(13), kl(14), self.alice)])
        entries_before = list(WorkLogEntry.objects.values_list("pk", "start_time", "end_time"))
        audit_before = AuditLogEntry.objects.count()
        response = self.client.patch(
            f"{TICKETS_URL}{ticket.pk}/",
            {"notes": "Changed.", "activities": [self.act(kl(9, 30), kl(10, 30), self.alice)]},
            format="json",
        )
        self.assert_overlap_409(response)
        ticket.refresh_from_db()
        self.assertEqual(ticket.notes, "Reported this morning.")
        self.assertEqual(list(ticket.activities.values_list("start_at", flat=True)), [kl(13)])
        self.assertEqual(list(WorkLogEntry.objects.values_list("pk", "start_time", "end_time")), entries_before)
        self.assertEqual(AuditLogEntry.objects.count(), audit_before)

    def test_put_goes_through_the_same_check(self):
        self.manual("09:00", "10:00")
        ticket = self.create_ticket([])
        body = self.ticket_body([self.act(kl(9, 30), kl(10, 30), self.alice)])
        self.assert_overlap_409(self.client.put(f"{TICKETS_URL}{ticket.pk}/", body, format="json"))
        response = self.client.put(f"{TICKETS_URL}{ticket.pk}/", {**body, "confirm_overlaps": True}, format="json")
        self.assertEqual(response.status_code, 200, response.content)
        log = AuditLogEntry.objects.get(action=A.TICKET_ACTIVITY_ADDED)
        self.assertEqual((log.metadata["overlap_confirmed"], log.metadata["overlap_count"]), (True, 1))

    def test_multipart_confirmation(self):
        import json

        self.manual("09:00", "10:00")
        body = self.ticket_body(json.dumps([self.act(kl(9, 30), kl(10, 30), self.alice)]))
        self.assert_overlap_409(self.client.post(TICKETS_URL, body, format="multipart"))
        response = self.client.post(TICKETS_URL, {**body, "confirm_overlaps": "true"}, format="multipart")
        self.assertEqual(response.status_code, 201, response.content)

    def test_a_validation_error_wins_over_an_overlap(self):
        self.manual("09:00", "10:00")
        overlapping = [self.act(kl(9, 30), kl(10, 30), self.alice)]
        response = self.post_ticket(overlapping, notes="")  # a required field missing
        self.assertEqual(response.status_code, 400)
        self.assertIn("notes", response.json())
        response = self.post_ticket(overlapping, is_forwarded=True)  # an object-level rule
        self.assertEqual(response.status_code, 400)
        self.assertIn("forwarded_to", response.json())
        response = self.post_ticket([*overlapping, self.act(kl(11), kl(10), self.alice)])  # a nested error
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Ticket.objects.count(), 0)

    def test_compared_in_the_resolvers_own_time_zone(self):
        self.bob.timezone = "Europe/London"
        self.bob.save()
        # 09:00-10:00 in Kuala Lumpur is 01:00-02:00 in London (GMT in March).
        self.manual("09:00", "10:00", user=self.bob)  # bob's own 09:00: no clash
        response = self.post_ticket([self.act(kl(9), kl(10), self.bob)])
        self.assertEqual(response.status_code, 201, response.content)
        self.manual("01:30", "02:30", user=self.bob)
        # Two overlaps, both in London time: the first ticket's auto entry and the manual 01:30 one.
        items = self.assert_overlap_409(self.post_ticket([self.act(kl(9), kl(10), self.bob)], number="X2"), count=2)
        self.assertEqual({(i["start"], i["end"], i["date"]) for i in items}, {("01:00", "02:00", "2026-03-04")})
        self.assertEqual(
            sorted((i["kind"], i["overlap_minutes"]) for i in items), [("manual_entry", 30), ("ticket_activity", 60)]
        )

    def test_clipped_at_midnight_like_the_auto_entry(self):
        # 23:00 on Mar 3 to 01:00 on Mar 4 (KL): the entry is Mar 3, 23:00-23:59.
        crossing = [self.act(kl(23, day=3), kl(1, day=4), self.alice)]
        self.manual("00:00", "00:30", day=MARCH_4)
        self.assertEqual(self.post_ticket(crossing).status_code, 201)
        # Now a second copy clashes on Mar 3 only: with the first ticket's
        # clipped entry and a manual 23:30 one (never the 00:00 one).
        self.manual("23:30", "23:45", day=date(2026, 3, 3))
        items = self.assert_overlap_409(self.post_ticket(crossing, number="X2"), count=2)
        self.assertEqual(
            sorted((i["date"], i["end"], i["kind"], i["overlap_minutes"]) for i in items),
            [("2026-03-03", "23:59", "manual_entry", 15), ("2026-03-03", "23:59", "ticket_activity", 59)],
        )

    def test_sub_minute_activities_are_never_flagged(self):
        self.manual("09:00", "10:00")
        # 09:10:05-09:10:45: under a minute, so no auto entry (09:10-09:10).
        start = kl(9, 10) + timedelta(seconds=5)
        activity = {
            **self.activity(resolved_by=self.alice),
            "start_at": iso(start),
            "end_at": iso(start + timedelta(seconds=40)),
        }
        response = self.post_ticket([activity])
        self.assertEqual(response.status_code, 201, response.content)
        self.assertFalse(WorkLogEntry.objects.filter(ticket_activity__isnull=False).exists())


class OverlapFlagOutputTests(OverlapTestCase):
    def test_constant_query_count_for_the_day_list(self):
        def queries_for(count):
            WorkLogEntry.objects.all().delete()
            for i in range(count):
                minute = i * 30
                start = time(minute // 60, minute % 60)
                end = time((minute + 45) // 60, (minute + 45) % 60)
                self.manual(start.strftime("%H:%M"), end.strftime("%H:%M"))
            with CaptureQueriesContext(connection) as ctx:
                response = self.client.get(ENTRIES_URL, {"date": "2026-03-04"})
            self.assertEqual(len(response.json()), count)
            self.assertTrue(all(e["overlaps_with_other_time"] for e in response.json()))
            return len(ctx.captured_queries)

        self.assertEqual(queries_for(2), queries_for(20))

    def test_flags_ignore_touching_and_other_people(self):
        self.manual("09:00", "10:00")
        self.manual("10:00", "11:00")
        self.manual("09:00", "11:00", user=self.bob)
        entries = self.client.get(ENTRIES_URL, {"date": "2026-03-04"}).json()
        self.assertEqual([(e["overlaps_with_other_time"], e["overlap_minutes"]) for e in entries], [(False, 0)] * 2)

    def test_report_entries_and_csv_carry_the_flag(self):
        self.manual("09:00", "10:00")
        self.manual("09:30", "10:30")
        self.manual("11:00", "12:00")
        self.client.force_authenticate(self.admin)
        params = {"start_date": "2026-03-01", "end_date": "2026-03-31", "user_id": str(self.alice.pk)}
        entries = self.client.get(REPORT_URL, params).json()["entries"]
        self.assertEqual([e["overlap_minutes"] for e in entries], [30, 30, 0])

        body = self.client.get(EXPORT_URL, params).content.decode("utf-8-sig").splitlines()
        self.assertTrue(body[0].endswith(",Overlap Minutes"))
        self.assertEqual([line.rsplit(",", 1)[1] for line in body[1:]], ["30", "30", "0"])
