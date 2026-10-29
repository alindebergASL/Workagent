"""Synthetic phase-codec 2.0: anchor and duration, not endpoints."""
VERSION = "2.0"


def decode(row):
    return {"anchor": int(row["anchor"], 10),
            "span": int(row["span"], 10)}
