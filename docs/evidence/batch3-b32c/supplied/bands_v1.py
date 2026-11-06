"""Carousel blackout bands, phase-codec 1.4 integration."""
from phase_codec_v1 import decode


def blocked_ticks(rows, size):
    if type(size) is not int:
        raise TypeError("size must be an integer")
    if size <= 0:
        raise ValueError("size must be positive")
    pieces = []
    for row in rows:
        start, stop = decode(row)
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
