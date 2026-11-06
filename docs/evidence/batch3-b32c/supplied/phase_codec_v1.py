"""Synthetic phase-codec 1.4: absolute, unwrapped endpoints."""
VERSION = "1.4"


def decode(row):
    return int(row["start"], 10), int(row["stop"], 10)
