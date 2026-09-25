"""Seed the minimal Site / Customer / WorkDoneCode reference data (safe to re-run)."""

from django.core.management.base import BaseCommand
from django.db import transaction

from tickets.models import Customer, Site, WorkDoneCode

# Site names come from the frontend's former mock-ticket pool. Two sites carry
# a second OCN, as some real sites do (same name, separate rows).
SITES = [
    ("NG Teng Fong General Hospital", "OCN04817-801-00"),
    ("NG Teng Fong General Hospital", "OCN04817-802-00"),
    ("Penang Adventist Hospital", "OCN02265-801-00"),
    ("Frimley Park Hospital", "OCN07731-801-00"),
    ("Sunway Velocity", "OCN03390-801-00"),
    ("Mount Elizabeth Hospital Singapore", "OCN05102-801-00"),
    ("Singapore Med Lab Cebu NRA", "OCN06648-801-00"),
    ("Gleneagles Hospital Kuala Lumpur", "OCN01974-801-00"),
    ("Raffles Hospital Singapore", "OCN08213-801-00"),
    ("Bumrungrad International Hospital", "OCN04459-801-00"),
    ("Samitivej Sukhumvit Hospital", "OCN09306-801-00"),
    ("St. Luke's Medical Center Global City", "OCN02587-801-00"),
    ("Makati Medical Center", "OCN07014-801-00"),
    ("Siloam Hospitals Lippo Village", "OCN03861-801-00"),
    ("Tan Tock Seng Hospital", "OCN05529-801-00"),
    ("Tan Tock Seng Hospital", "OCN05529-802-00"),
    ("Changi General Hospital", "OCN06172-801-00"),
    ("Subang Jaya Medical Centre", "OCN01448-801-00"),
    ("Prince Court Medical Centre", "OCN08890-801-00"),
    ("Vinmec Central Park Hospital", "OCN02736-801-00"),
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


class Command(BaseCommand):
    help = "Create/update the Site, Customer and WorkDoneCode reference data used by tickets."

    @transaction.atomic
    def handle(self, *args, **options):
        for name, ocn in SITES:
            Site.objects.get_or_create(name=name, ocn=ocn)
        for name in CUSTOMERS:
            Customer.objects.get_or_create(name=name)
        for code, description in WORK_DONE_CODES:
            WorkDoneCode.objects.update_or_create(code=code, defaults={"description": description})

        self.stdout.write(
            self.style.SUCCESS(
                f"Reference data ready: {Site.objects.count()} sites, "
                f"{Customer.objects.count()} customers, "
                f"{WorkDoneCode.objects.count()} work-done codes."
            )
        )
