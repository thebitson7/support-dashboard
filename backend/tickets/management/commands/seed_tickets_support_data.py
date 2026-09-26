"""
Seed the reference data: countries, sites, customers, work-done codes, holidays.

Safe to re-run: it only creates what's missing and never overwrites records
(or site countries) that were edited since. Local development only.
"""

from datetime import date

from django.db import transaction

from core.management import DevOnlyCommand
from tickets.models import Country, Customer, Holiday, Site, WorkDoneCode

COUNTRIES = [
    ("Malaysia", "MY"),
    ("Singapore", "SG"),
    ("Philippines", "PH"),
    ("India", "IN"),
    ("Bangladesh", "BD"),
    ("Maldives", "MV"),
    ("Thailand", "TH"),
    ("Indonesia", "ID"),
    ("Vietnam", "VN"),
    ("Sri Lanka", "LK"),
    ("Hong Kong", "HK"),
    ("Australia", "AU"),
    ("New Zealand", "NZ"),
    ("Fiji", "FJ"),
    ("United Kingdom", "GB"),
]

# (name, OCN, country code). Names come from the frontend's former mock-ticket
# pool; each one names a real hospital, so its country is known. Two sites
# carry a second OCN, as some real sites do (same name, separate rows).
SITES = [
    ("NG Teng Fong General Hospital", "OCN04817-801-00", "SG"),
    ("NG Teng Fong General Hospital", "OCN04817-802-00", "SG"),
    ("Penang Adventist Hospital", "OCN02265-801-00", "MY"),
    ("Frimley Park Hospital", "OCN07731-801-00", "GB"),
    ("Sunway Velocity", "OCN03390-801-00", "MY"),
    ("Mount Elizabeth Hospital Singapore", "OCN05102-801-00", "SG"),
    ("Singapore Med Lab Cebu NRA", "OCN06648-801-00", "PH"),  # the lab is in Cebu
    ("Gleneagles Hospital Kuala Lumpur", "OCN01974-801-00", "MY"),
    ("Raffles Hospital Singapore", "OCN08213-801-00", "SG"),
    ("Bumrungrad International Hospital", "OCN04459-801-00", "TH"),
    ("Samitivej Sukhumvit Hospital", "OCN09306-801-00", "TH"),
    ("St. Luke's Medical Center Global City", "OCN02587-801-00", "PH"),
    ("Makati Medical Center", "OCN07014-801-00", "PH"),
    ("Siloam Hospitals Lippo Village", "OCN03861-801-00", "ID"),
    ("Tan Tock Seng Hospital", "OCN05529-801-00", "SG"),
    ("Tan Tock Seng Hospital", "OCN05529-802-00", "SG"),
    ("Changi General Hospital", "OCN06172-801-00", "SG"),
    ("Subang Jaya Medical Centre", "OCN01448-801-00", "MY"),
    ("Prince Court Medical Centre", "OCN08890-801-00", "MY"),
    ("Vinmec Central Park Hospital", "OCN02736-801-00", "VN"),
]

# (name, date, country code or None for global, recurs annually). Recurring
# ones are stored in 2026; only their month/day matter. Holidays whose date
# moves every year are entered for a specific year.
HOLIDAYS = [
    ("New Year's Day", date(2026, 1, 1), None, True),
    ("Company Foundation Day", date(2026, 3, 15), None, True),
    ("Christmas Day", date(2026, 12, 25), None, True),
    ("Malaysia National Day", date(2026, 8, 31), "MY", True),
    ("Malaysia Day", date(2026, 9, 16), "MY", True),
    ("Hari Raya Aidilfitri", date(2026, 3, 20), "MY", False),
    ("Singapore National Day", date(2026, 8, 9), "SG", True),
    ("Chinese New Year", date(2026, 2, 17), "SG", False),
    ("Philippine Independence Day", date(2026, 6, 12), "PH", True),
    ("India Republic Day", date(2026, 1, 26), "IN", True),
    ("Bangladesh Victory Day", date(2026, 12, 16), "BD", True),
    ("Maldives Independence Day", date(2026, 7, 26), "MV", True),
]

CUSTOMERS = [
    "IHH Healthcare",
    "Parkway Pantai",
    "KPJ Healthcare",
    "Sunway Healthcare Group",
    "Bangkok Dusit Medical Services",
    "Bumrungrad Hospital PCL",
    "Ramsay Sime Darby Health Care",
    "Siloam International Hospitals",
    "Mayapada Healthcare Group",
    "Metro Pacific Health",
    "Ayala Healthcare Holdings",
    "National Healthcare Group",
    "SingHealth",
    "Hospital Authority Hong Kong",
    "Health New Zealand",
    "Queensland Health",
    "Vinmec Healthcare System",
    "Apollo Hospitals Enterprise",
]

WORK_DONE_CODES = [
    ("HWR", "Hardware Replacement"),
    ("HWD", "Hardware Diagnosis"),
    ("SWC", "Software Configuration"),
    ("SWU", "Software Upgrade / Patch"),
    ("SWI", "Software Installation"),
    ("NET", "Network Troubleshooting"),
    ("LIS", "LIS / Interface Connectivity"),
    ("RMD", "Remote Diagnostic"),
    ("CAL", "Calibration"),
    ("PMV", "Preventive Maintenance"),
    ("QCR", "QC Review & Adjustment"),
    ("REA", "Reagent / Consumable Issue"),
    ("DBM", "Database Maintenance"),
    ("BKP", "Backup & Restore"),
    ("USR", "User Account / Access"),
    ("TRN", "User Training"),
    ("DOC", "Documentation / Report"),
    ("NFF", "No Fault Found"),
]


class Command(DevOnlyCommand):
    help = "Create/update countries, sites, customers, work-done codes and holidays."

    @transaction.atomic
    def handle(self, *args, **options):
        countries = {}
        for name, code in COUNTRIES:
            countries[code], _ = Country.objects.get_or_create(code=code, defaults={"name": name})

        for name, ocn, code in SITES:
            site, _ = Site.objects.get_or_create(name=name, ocn=ocn)
            # Backfill only: never overwrite a country someone set by hand.
            if site.country_id is None:
                site.country = countries[code]
                site.save(update_fields=["country"])
        for name in CUSTOMERS:
            Customer.objects.get_or_create(name=name)
        for code, description in WORK_DONE_CODES:
            WorkDoneCode.objects.get_or_create(code=code, defaults={"description": description})
        for name, day, code, recurring in HOLIDAYS:
            Holiday.objects.get_or_create(
                name=name,
                country=countries[code] if code else None,
                defaults={"date": day, "is_recurring_annually": recurring},
            )

        self.stdout.write(
            self.style.SUCCESS(
                f"Reference data ready: {Country.objects.count()} countries, "
                f"{Site.objects.count()} sites "
                f"({Site.objects.filter(country__isnull=True).count()} without a country), "
                f"{Customer.objects.count()} customers, "
                f"{WorkDoneCode.objects.count()} work-done codes, "
                f"{Holiday.objects.count()} holidays."
            )
        )
