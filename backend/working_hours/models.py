from django.conf import settings
from django.db import models


class WorkLogEntry(models.Model):
    class Category(models.TextChoices):
        AMS = "ams", "AMS"
        NON_AMS = "non_ams", "Non-AMS"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="work_logs"
    )
    date = models.DateField()
    category = models.CharField(max_length=10, choices=Category.choices)
    hours = models.DecimalField(max_digits=5, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-date", "user"]
        indexes = [models.Index(fields=["user", "date"])]
        verbose_name_plural = "work log entries"

    def __str__(self):
        return f"{self.user} · {self.date} · {self.get_category_display()} · {self.hours}h"
