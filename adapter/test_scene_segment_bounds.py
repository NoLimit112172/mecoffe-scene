"""Pinned-old predicate differential, with one certified roundoff correction."""
from fractions import Fraction
import math
import random
import unittest
from unittest.mock import patch

from scene_service import geometry
from physical_map_test_oracle import (SEPARATED_SEGMENTS, SOURCE_COMMIT, cross,
                                     load_c51f7bd_modules, separated_roundoff_false_positive)


def outcome(operation,*args):
    try:
        return ('value',operation(*args))
    except Exception as error:
        return ('error',type(error),str(error))


class SegmentBoundsCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.old_geometry,_=load_c51f7bd_modules()

    def assertHistoricalResultOrCertifiedCorrection(self,points):
        actual=geometry.intersects(*points)
        historical=self.old_geometry.intersects(*points)
        if actual != historical:
            self.assertTrue(separated_roundoff_false_positive(points,actual,historical),
                            f'Unexpected predicate change against {SOURCE_COMMIT}: {points!r}')
            return 1
        return 0

    def test_separated_near_collinear_roundoff_is_a_deliberate_false_positive_correction(self):
        examples=[SEPARATED_SEGMENTS,
            [[1.2541639998114533,-157.83297331052592],[180.59766154810896,26.746124048769474],
             [180.59766241918624,26.746124945276236],[359.9411599674837,211.32522230457164]]]
        for a,b,c,d in examples:
            points=[a,b,c,d]
            with self.subTest(points=points):
                # Fraction sees the exact stored binary coordinates. Both axis
                # intervals are disjoint well beyond the existing EPS contact.
                for i in (0,1):
                    self.assertGreater(min(Fraction(c[i]),Fraction(d[i]))-max(Fraction(a[i]),Fraction(b[i])),2*Fraction(geometry.EPS))
                self.assertAlmostEqual(math.dist(b,c),1.25e-6,delta=1e-13)
                self.assertFalse(any(self.old_geometry.on_segment(p,q,r) for p,q,r in ((a,c,d),(b,c,d),(c,a,b),(d,a,b))))
                determinants=[cross(*p) for p in ((a,b,c),(a,b,d),(c,d,a),(c,d,b))]
                self.assertLess(determinants[0]*determinants[1],0)
                self.assertLess(determinants[2]*determinants[3],0)
                self.assertTrue(self.old_geometry.intersects(*points))
                self.assertFalse(geometry.intersects(*points))
                self.assertTrue(separated_roundoff_false_positive(points,False,True))
                self.assertFalse(separated_roundoff_false_positive(points,True,False))
        # The differential exception cannot hide contact or an ordinary crossing.
        for points in (([0,0],[10,0],[10+geometry.EPS*.5,0],[20,0]),
                       ([0,0],[10,10],[0,10],[10,0]),
                       ([0,0],[10,0],[20,10],[30,-10])):
            self.assertFalse(separated_roundoff_false_positive(points,False,True))

    def test_separate_boxes_skip_exact_work_but_near_contact_uses_it(self):
        with patch('scene_service.geometry.on_segment',side_effect=AssertionError('exact work')):
            self.assertFalse(geometry.intersects([0,0],[1,1],[10,0],[11,1]))
            self.assertFalse(geometry.intersects([0,0],[1,1],[0,10],[1,11]))
        with patch('scene_service.geometry.on_segment',wraps=geometry.on_segment) as exact:
            self.assertTrue(geometry.intersects([0,0],[10,0],[10+geometry.EPS*.5,0],[20,0]))
            self.assertGreater(exact.call_count,0)

    def test_exact_contacts_degenerate_parallel_and_tolerance(self):
        cases=[([0,0],[10,0],[10,0],[20,0]),
               ([0,0],[10,0],[2,0],[8,0]),
               ([0,0],[0,0],[0,0],[0,0]),
               ([0,0],[10,10],[0,10],[10,0]),
               ([-0.,0.],[0.,-0.],[-0.,0.],[0.,-0.])]
        for gap in (-geometry.EPS,0.,geometry.EPS*.5,geometry.EPS,
                    math.nextafter(geometry.EPS,math.inf),geometry.EPS*2,geometry.EPS*4):
            cases.append(([0,0],[10,0],[10+gap,0],[20+gap,0]))
            cases.append(([0,0],[10,0],[0,gap],[10,gap]))
        for case in cases:
            for points in (case,(case[2],case[3],case[0],case[1]),
                           (case[1],case[0],case[3],case[2])):
                with self.subTest(points=points):
                    self.assertEqual(outcome(geometry.intersects,*points),outcome(self.old_geometry.intersects,*points))

    def test_seeded_random_and_near_collinear_differential(self):
        random_source=random.Random(20261113)
        for _ in range(5000):
            scale=random_source.choice((1e-5,1.,1e3,1e7))
            points=[[random_source.uniform(-scale,scale) for _ in (0,1)] for _ in range(4)]
            self.assertHistoricalResultOrCertifiedCorrection(points)
        for offset in (0.,1e5,1e7,9e7):
            for step in (geometry.EPS,math.ulp(offset),1e-6,1.):
                points=([offset,offset],[offset+100,offset+100],
                        [offset+101,offset+101+step],[offset+200,offset+200-step])
                self.assertHistoricalResultOrCertifiedCorrection(points)
        # Include cancellation-scale inputs rather than only widely separated
        # random segments; every mismatch must satisfy the exact narrow proof.
        rng=random.Random(20261114);corrections=0
        for _ in range(500):
            a=[rng.uniform(-100,100),rng.uniform(-100,100)]
            vector=[rng.uniform(20,200),rng.uniform(20,200)]
            b=[a[i]+vector[i] for i in (0,1)]
            gap_fraction=1.25e-6/math.hypot(*vector);extension=rng.uniform(.3,2)
            c=[b[i]+gap_fraction*vector[i] for i in (0,1)]
            d=[c[i]+extension*vector[i] for i in (0,1)]
            corrections+=self.assertHistoricalResultOrCertifiedCorrection((a,b,c,d))
        self.assertGreater(corrections,0)

    def test_nonfinite_extreme_and_malformed_inputs_keep_original_outcome(self):
        ordinary=([0.,0.],[10.,0.],[5.,-1.],[5.,1.])
        cases=[]
        for value in (float('nan'),float('inf'),-float('inf'),1e150,-1e150,True,'bad'):
            points=[list(p) for p in ordinary];points[0][0]=value;cases.append(points)
        cases.extend(((None,*ordinary[1:]),([], *ordinary[1:]),
                      ([0,0,0],*ordinary[1:]),([0],*ordinary[1:])))
        for points in cases:
            with self.subTest(points=points):
                self.assertEqual(outcome(geometry.intersects,*points),outcome(self.old_geometry.intersects,*points))

    def test_hole_and_self_intersection_validation_matches_original(self):
        polygons=[{'polygon':[[0,0],[20,0],[20,20],[0,20],[0,0]],
                   'holes':[[[4,4],[8,4],[8,8],[4,8],[4,4]]]},
                  {'polygon':[[0,0],[10,10],[0,10],[10,0],[0,0]],'holes':[]},
                  {'polygon':[[0,0],[20,0],[20,20],[0,20],[0,0]],
                   'holes':[[[0,4],[8,4],[8,8],[0,8],[0,4]]]}]
        for polygon in polygons:
            geometry._valid_ring_coordinates.cache_clear()
            actual=geometry.valid_building(polygon)
            expected=self.old_geometry.valid_building(polygon)
            self.assertEqual(actual,expected)
        geometry._valid_ring_coordinates.cache_clear()


if __name__=='__main__':
    unittest.main()
