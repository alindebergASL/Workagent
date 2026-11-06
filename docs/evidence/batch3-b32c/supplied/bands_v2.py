"""Carousel blackout bands, phase-codec 2.0 integration."""
from phase_codec_v2 import decode


def blocked_ticks(rows, size):
    if type(size) is not int:
        raise TypeError("size must be an integer")
    if size <= 0:
        raise ValueError("size must be positive")
    pieces = []
    for row in rows:
        # HUMAN-PROTECTED: maintenance-bypass rows never darken the carousel.
        if row.get("status") == "maintenance-bypass":
            continue
        record = decode(row)
        start, stop = record["anchor"], record["span"]
        if stop < start:
            raise ValueError("negative duration")
        lo, hi = start % size, stop % size
        if lo < hi:
            pieces.append((lo, hi))
    merged = []
    for lo, hi in sorted(pieces):
        if merged and lo <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(hi, merged[-1][1]))
        else:
            merged.append((lo, hi))
    return merged
