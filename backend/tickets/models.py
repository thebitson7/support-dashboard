from django.conf import settings
from django.core.validators import FileExtensionValidator
from django.db import models

# --- Minimal reference data ----------------------------------------------------
# Placeholders with just enough fields for ticket creation; their own Lookups
# pages will grow them later.


class Site(models.Model):
    name = models.CharField(max_length=200)
    ocn = models.CharField("OCN", max_length=50)

    class Meta:
        ordering = ["name", "ocn"]
        # A site can have several OCNs, but never the same one twice.
        constraints = [models.UniqueConstraint(fields=["name", "ocn"], name="unique_site_ocn")]

    def __str__(self):
        return f"{self.name} ({self.ocn})"


class Customer(models.Model):
    name = models.CharField(max_length=200, unique=True)

    class Meta:
        ordering = ["name"]

    def __str__(self):
        return self.name


class WorkDoneCode(models.Model):
    code = models.CharField(max_length=20, unique=True)
    description = models.CharField(max_length=200)

    class Meta:
        ordering = ["code"]

    def __str__(self):
        return f"{self.code} · {self.description}"


# --- Tickets -------------------------------------------------------------------


def user_fk(related_name: str, *, optional: bool = False) -> models.ForeignKey:
    """A user reference. PROTECT: people are deactivated, never deleted, once they own tickets."""
    return models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name=related_name,
        null=optional,
        blank=optional,
    )


class Ticket(models.Model):
    class Type(models.TextChoices):
        HARDWARE = "hardware", "Hardware"
        SOFTWARE = "software", "Software"
        NETWORK = "network", "Network"
        CONFIGURATION = "configuration", "Configuration"
        TRAINING = "training", "Training / How-to"
        OTHER = "other", "Other"

    class Channel(models.TextChoices):
        PHONE = "phone", "Phone"
        EMAIL = "email", "Email"
        PORTAL = "portal", "Customer Portal"
        REMOTE_MONITORING = "remote_monitoring", "Remote Monitoring Alert"
        WALK_IN = "walk_in", "Walk-in / On-site"

    pdf_attachment = models.FileField(
        upload_to="tickets/attachments/",
        blank=True,
        validators=[FileExtensionValidator(["pdf"])],
    )
    received_at = models.DateTimeField()
    cms_next_ticket_no = models.CharField("CMS next ticket no", max_length=50)
    site = models.ForeignKey(Site, on_delete=models.PROTECT, related_name="tickets")
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT, related_name="tickets")
    assigned_to = user_fk("assigned_tickets")
    ticket_type = models.CharField(max_length=20, choices=Type.choices)
    incoming_channel = models.CharField(max_length=20, choices=Channel.choices)
    is_forwarded = models.BooleanField(default=False)
    forwarded_to = user_fk("forwarded_tickets", optional=True)
    cms_added_by = user_fk("added_tickets", optional=True)
    cms_added_on = models.DateTimeField()
    issue_description = models.TextField()
    possible_root_cause = models.TextField(blank=True)
    notes = models.TextField()
    total_duration_hours = models.DecimalField(max_digits=6, decimal_places=2, default=0)
    is_pre = models.BooleanField("PRE", default=False)
    # Verification: filling these closes the ticket (see `status`).
    resolution_verified_by = user_fk("verified_tickets", optional=True)
    resolution_verified_on = models.DateTimeField(null=True, blank=True)
    cms_closed_by = user_fk("closed_tickets", optional=True)
    cms_closed_on = models.DateTimeField(null=True, blank=True)
    service_closed_date = models.DateTimeField(null=True, blank=True)
    # The authenticated user who created the record (never client-supplied).
    created_by = user_fk("created_tickets")
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-received_at", "-id"]
        # site / assigned_to are foreign keys, which Django already indexes.
        indexes = [
            models.Index(fields=["-received_at"]),
            models.Index(fields=["cms_closed_on"]),  # the open/closed status filter
        ]

    def __str__(self):
        return f"#{self.pk} {self.cms_next_ticket_no} · {self.site.name}"

    @property
    def status(self) -> str:
        """Matches the tickets table: closed once CMS has a closing date."""
        return "closed" if self.cms_closed_on else "open"


class TicketActivity(models.Model):
    class Type(models.TextChoices):
        TROUBLESHOOTING = "troubleshooting", "Troubleshooting"
        REMOTE_SUPPORT = "remote_support", "Remote Support"
        ONSITE_VISIT = "onsite_visit", "On-site Visit"
        ESCALATION = "escalation", "Escalation"
        FOLLOW_UP = "follow_up", "Follow-up"
        TRAINING = "training", "Training"

    ticket = models.ForeignKey(Ticket, on_delete=models.CASCADE, related_name="activities")
    activity_type = models.CharField(max_length=20, choices=Type.choices)
    start_at = models.DateTimeField()
    end_at = models.DateTimeField()
    duration_minutes = models.PositiveIntegerField(
        blank=True, help_text="Computed from start/end when left empty."
    )
    work_done_code = models.ForeignKey(WorkDoneCode, on_delete=models.PROTECT)
    is_likely_cause = models.BooleanField(
        "likely cause",
        default=False,
        help_text="Marks this activity as having identified the likely cause of the issue.",
    )
    resolved_by = user_fk("resolved_activities", optional=True)

    class Meta:
        ordering = ["start_at", "id"]
        verbose_name_plural = "ticket activities"

    def __str__(self):
        return f"{self.get_activity_type_display()} ({self.duration_minutes} min)"

    @staticmethod
    def minutes_between(start, end) -> int:
        return max(0, round((end - start).total_seconds() / 60))

    def save(self, *args, **kwargs):
        if self.duration_minutes is None and self.start_at and self.end_at:
            self.duration_minutes = self.minutes_between(self.start_at, self.end_at)
        super().save(*args, **kwargs)
