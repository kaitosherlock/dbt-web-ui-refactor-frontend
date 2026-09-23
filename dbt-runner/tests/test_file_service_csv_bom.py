"""A seed CSV saved with a byte-order mark must reach dbt without it."""

from pathlib import Path

from app.services.file_service import _normalise_content


def test_csv_bom_is_dropped():
    assert _normalise_content(Path("seeds/orders.csv"), "﻿ID,STATUS\n1,x\n") == "ID,STATUS\n1,x\n"


def test_other_files_are_left_alone():
    text = "﻿select 1"
    assert _normalise_content(Path("models/a.sql"), text) == text
