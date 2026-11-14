"""Repeated map checks keep the exact geometry contract for mutable inputs."""
import copy
from pathlib import Path
import subprocess
import unittest

from scene_service.geometry import inside, valid_ring, _valid_ring_coordinates


class RingValidationCacheCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        source=subprocess.check_output(
            ['git','show','c51f7bd:adapter/scene_service/geometry.py'],
            cwd=Path(__file__).resolve().parents[1])
        original={'__name__':'upstream_geometry_ring_oracle'}
        exec(compile(source,'c51f7bd:adapter/scene_service/geometry.py','exec'),original)
        cls.original_valid_ring=staticmethod(original['valid_ring'])

    def setUp(self):
        _valid_ring_coordinates.cache_clear()
        self.addCleanup(_valid_ring_coordinates.cache_clear)

    def test_mutating_a_previously_valid_ring_revalidates_its_coordinates(self):
        ring = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]
        self.assertTrue(valid_ring(ring))
        self.assertTrue(inside([5, 5], ring))
        ring[1], ring[2] = ring[2], ring[1]
        self.assertFalse(valid_ring(ring))
        self.assertFalse(inside([5, 5], ring))
        self.assertEqual(_valid_ring_coordinates.cache_info().misses,2)

    def test_equal_copies_share_validation_without_mutating_the_inputs(self):
        for coordinate_type in (int,float):
            with self.subTest(coordinate_type=coordinate_type):
                ring = [[coordinate_type(value) for value in p]
                        for p in [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
                original = copy.deepcopy(ring)
                _valid_ring_coordinates.cache_clear()
                for _ in range(20):
                    self.assertTrue(valid_ring(copy.deepcopy(ring)))
                self.assertEqual(ring, original)
                self.assertEqual(_valid_ring_coordinates.cache_info().misses, 1)
                self.assertEqual(_valid_ring_coordinates.cache_info().hits, 19)

    def test_equal_valued_large_int_and_float_rings_match_upstream_in_both_cache_orders(self):
        origin=2**60
        integers=[[origin,origin],[origin+1024,origin],[origin+1024,origin+1024],
                  [origin,origin+1024],[origin,origin]]
        floats=[[float(value) for value in p] for p in integers]
        self.assertEqual(integers,floats)
        # These outcomes come from the untouched upstream module in its own
        # namespace, including its original intersects/on_segment predicates.
        self.assertIs(self.original_valid_ring(integers),True)
        self.assertIs(self.original_valid_ring(floats),False)
        for first,second in ((integers,floats),(floats,integers)):
            with self.subTest(first_coordinate_type=type(first[0][0])):
                _valid_ring_coordinates.cache_clear()
                for ring in (first,second)*20:
                    self.assertEqual(valid_ring(copy.deepcopy(ring)),self.original_valid_ring(ring))
                self.assertEqual(_valid_ring_coordinates.cache_info().misses,2)
                self.assertEqual(_valid_ring_coordinates.cache_info().hits,38)

    def test_each_coordinate_type_is_part_of_the_key_under_mixed_repeated_calls(self):
        origin=2**60
        integers=[[origin,origin],[origin+1024,origin],[origin+1024,origin+1024],
                  [origin,origin+1024],[origin,origin]]
        variants=[integers,[[float(value) for value in p] for p in integers]]
        for index in range(len(integers)*2):
            mixed=copy.deepcopy(integers)
            point,axis=divmod(index,2)
            mixed[point][axis]=float(mixed[point][axis])
            variants.append(mixed)
        expected=[self.original_valid_ring(ring) for ring in variants]
        self.assertEqual(set(expected),{True,False})
        for order in (list(range(len(variants))),list(reversed(range(len(variants))))):
            _valid_ring_coordinates.cache_clear()
            for index in order*10:
                with self.subTest(index=index):
                    self.assertEqual(valid_ring(copy.deepcopy(variants[index])),expected[index])
            self.assertEqual(_valid_ring_coordinates.cache_info().misses,len(variants))
            self.assertEqual(_valid_ring_coordinates.cache_info().hits,len(variants)*9)

    def test_invalid_coordinates_still_fail_before_cached_validation(self):
        for ring in (None, (), [], [[0, 0]] * 4,
                     [[0, 0], [10, 0], [10, float('nan')], [0, 0]],
                     [[0, 0], [True, 0], [10, 10], [0, 0]],
                     [[0, 0], [10, 0], [10, 10], [0, 10]]):
            with self.subTest(ring=ring):
                self.assertFalse(valid_ring(ring))


if __name__ == '__main__':
    unittest.main()
