"""Per-operation conservative candidates; exact geometry remains authoritative.

The grid never stores map results between builds. Large objects and large
queries fall back to ordered scans, bounding cell allocations without dropping
candidates. Bounds expand outwards by the geometry tolerance and one float ULP.
"""
import math

from .geometry import EPS


def coordinate_bounds(points):
    return (min(p[0] for p in points), min(p[1] for p in points),
            max(p[0] for p in points), max(p[1] for p in points))


def _expanded(bounds):
    west, south, east, north = bounds
    return (math.nextafter(west - EPS, -math.inf), math.nextafter(south - EPS, -math.inf),
            math.nextafter(east + EPS, math.inf), math.nextafter(north + EPS, math.inf))


def _overlaps(left, right):
    return (left[0] <= right[2] and left[2] >= right[0] and
            left[1] <= right[3] and left[3] >= right[1])


class BoundsIndex:
    """Stable original-order candidates for local-metre validated geometry."""
    def __init__(self, records, bounds, *, cell_size=64., max_cells=4096):
        if not math.isfinite(cell_size) or cell_size <= 0 or max_cells < 1:
            raise ValueError('positive finite cell size and cell limit required')
        self.records = tuple(records)
        self.boxes = tuple(_expanded(bounds(record)) for record in self.records)
        self.cell_size, self.max_cells = cell_size, max_cells
        self.cells, self.overflow = {}, []
        for index, box in enumerate(self.boxes):
            cells = self._cells(box)
            if cells is None:
                self.overflow.append(index)
            else:
                for cell in cells:
                    self.cells.setdefault(cell, []).append(index)

    def _cells(self, bounds):
        if not all(math.isfinite(value) for value in bounds):
            return None
        west, south, east, north = (math.floor(value / self.cell_size) for value in bounds)
        if (east - west + 1) * (north - south + 1) > self.max_cells:
            return None
        return ((x, y) for x in range(west, east + 1) for y in range(south, north + 1))

    def query(self, bounds):
        box = _expanded(bounds)
        cells = self._cells(box)
        if cells is None:
            candidates = range(len(self.records))
        else:
            found = set(self.overflow)
            for cell in cells:
                found.update(self.cells.get(cell, ()))
            candidates = sorted(found)
        return [self.records[index] for index in candidates if _overlaps(box, self.boxes[index])]
