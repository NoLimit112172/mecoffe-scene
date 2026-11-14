"""Repeated map checks keep the exact geometry contract for mutable inputs."""
import copy
import unittest

from scene_service.geometry import inside, valid_ring, _valid_ring_coordinates


class RingValidationCacheCase(unittest.TestCase):
    def test_mutating_a_previously_valid_ring_revalidates_its_coordinates(self):
        ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
        self.assertTrue(valid_ring(ring))
        self.assertTrue(inside([5, 5], ring))
        ring[1], ring[2] = ring[2], ring[1]
        self.assertFalse(valid_ring(ring))
        self.assertFalse(inside([5, 5], ring))

    def test_equal_copies_share_validation_without_mutating_the_inputs(self):
        ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
        original = copy.deepcopy(ring)
        _valid_ring_coordinates.cache_clear()
        for _ in range(20):
            self.assertTrue(valid_ring(copy.deepcopy(ring)))
        self.assertEqual(ring, original)
        self.assertEqual(_valid_ring_coordinates.cache_info().misses, 1)
        self.assertEqual(_valid_ring_coordinates.cache_info().hits, 19)

    def test_invalid_coordinates_still_fail_before_cached_validation(self):
        for ring in (None, (), [], [[0, 0]] * 4,
                     [[0, 0], [10, 0], [10, float('nan')], [0, 0]],
                     [[0, 0], [True, 0], [10, 10], [0, 0]],
                     [[0, 0], [10, 0], [10, 10], [0, 10]]):
            with self.subTest(ring=ring):
                self.assertFalse(valid_ring(ring))


if __name__ == '__main__':
    unittest.main()
