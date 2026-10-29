"""Empty inspection slots on a circular indexing jig."""


def free_ticks(rows, size):
    if type(size) is not int:
        raise TypeError("size must be an integer")
    if size <= 0:
        raise ValueError("size must be positive")
    occupied = set()
    for row in rows:
        at, width = row["at"], row["width"]
        if width < 0:
            raise ValueError("negative width")
        remainder = width % size
        if remainder:
            occupied.update((at + step) % size
                            for step in range(remainder + 1))
    result = []
    start = None
    for tick in range(size + 1):
        available = tick < size and tick not in occupied
        if available and start is None:
            start = tick
        elif not available and start is not None:
            result.append((start, tick))
            start = None
    return result
