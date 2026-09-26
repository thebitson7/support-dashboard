"""CSV downloads, shared by every export endpoint."""

import csv
from collections.abc import Iterable

from django.http import HttpResponse

# A cell starting with one of these is run as a formula by Excel / Sheets
# ("CSV injection"); free text such as notes and names is user-entered.
FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def text_cell(value) -> str:
    """User-entered text, made safe to open in a spreadsheet (a leading ' keeps it text)."""
    text = "" if value is None else str(value)
    return f"'{text}" if text.startswith(FORMULA_PREFIXES) else text


def csv_response(filename: str, header: list[str], rows: Iterable[list]) -> HttpResponse:
    """
    A CSV attachment. UTF-8 with a byte-order mark, so Excel reads accented
    names and the "—" in ticket references correctly instead of guessing a
    legacy code page. Callers pass numbers / dates already formatted and
    free text through text_cell().
    """
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{filename}"'
    response["Cache-Control"] = "no-store"
    response.write("﻿")
    writer = csv.writer(response)
    writer.writerow(header)
    writer.writerows(rows)
    return response
