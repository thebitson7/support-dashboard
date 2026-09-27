"""Shared wording for audit descriptions, so every sentence reads the same way."""

from datetime import date, datetime, time


def duration(minutes: int) -> str:
    """95 -> "1h 35m", 20 -> "20m"."""
    hours, rest = divmod(max(0, int(minutes)), 60)
    return f"{hours}h {rest:02d}m" if hours else f"{rest}m"


def clock(value: time) -> str:
    """time(14, 5) -> "2:05 PM"."""
    hour = value.hour % 12 or 12
    return f"{hour}:{value.minute:02d} {'PM' if value.hour >= 12 else 'AM'}"


def day(value: date) -> str:
    """date(2026, 3, 4) -> "4 Mar 2026"."""
    return f"{value.day} {value.strftime('%b')} {value.year}"


def moment(value: datetime, tzinfo) -> str:
    """An aware datetime in `tzinfo`: "4 Mar 2026, 9:00 AM"."""
    local = value.astimezone(tzinfo)
    return f"{day(local.date())}, {clock(local.time())}"


def listing(items: list[str]) -> str:
    """["a", "b", "c"] -> "a, b and c"."""
    items = [i for i in items if i]
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} and {items[-1]}"
