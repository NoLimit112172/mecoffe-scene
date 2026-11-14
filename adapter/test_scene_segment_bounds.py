"""Segment broad-phase rejection preserves the original exact predicate."""
import math
import random
import unittest
from unittest.mock import patch

from scene_service import geometry


def original(a,b,c,d):
    def cross(p,q,r):
        return (q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0])
    if any(geometry.on_segment(p,q,r) for p,q,r in ((a,c,d),(b,c,d),(c,a,b),(d,a,b))):
        return True
    return cross(a,b,c)*cross(a,b,d)<0 and cross(c,d,a)*cross(c,d,b)<0


def outcome(operation,*args):
    try:
        return ('value',operation(*args))
    except Exception as error:
        return ('error',type(error),str(error))


class SegmentBoundsCase(unittest.TestCase):
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
                    self.assertEqual(outcome(geometry.intersects,*points),outcome(original,*points))

    def test_seeded_random_and_near_collinear_differential(self):
        random_source=random.Random(20261113)
        for _ in range(5000):
            scale=random_source.choice((1e-5,1.,1e3,1e7))
            points=[[random_source.uniform(-scale,scale) for _ in (0,1)] for _ in range(4)]
            self.assertEqual(geometry.intersects(*points),original(*points))
        for offset in (0.,1e5,1e7,9e7):
            for step in (geometry.EPS,math.ulp(offset),1e-6,1.):
                points=([offset,offset],[offset+100,offset+100],
                        [offset+101,offset+101+step],[offset+200,offset+200-step])
                self.assertEqual(geometry.intersects(*points),original(*points))

    def test_nonfinite_extreme_and_malformed_inputs_keep_original_outcome(self):
        ordinary=([0.,0.],[10.,0.],[5.,-1.],[5.,1.])
        cases=[]
        for value in (float('nan'),float('inf'),-float('inf'),1e150,-1e150,True,'bad'):
            points=[list(p) for p in ordinary];points[0][0]=value;cases.append(points)
        cases.extend(((None,*ordinary[1:]),([], *ordinary[1:]),
                      ([0,0,0],*ordinary[1:]),([0],*ordinary[1:])))
        for points in cases:
            with self.subTest(points=points):
                self.assertEqual(outcome(geometry.intersects,*points),outcome(original,*points))

    def test_hole_and_self_intersection_validation_matches_original(self):
        polygons=[{'polygon':[[0,0],[20,0],[20,20],[0,20],[0,0]],
                   'holes':[[[4,4],[8,4],[8,8],[4,8],[4,4]]]},
                  {'polygon':[[0,0],[10,10],[0,10],[10,0],[0,0]],'holes':[]},
                  {'polygon':[[0,0],[20,0],[20,20],[0,20],[0,0]],
                   'holes':[[[0,4],[8,4],[8,8],[0,8],[0,4]]]}]
        for polygon in polygons:
            geometry._valid_ring_coordinates.cache_clear()
            actual=geometry.valid_building(polygon)
            with patch('scene_service.geometry.intersects',original):
                geometry._valid_ring_coordinates.cache_clear()
                expected=geometry.valid_building(polygon)
            self.assertEqual(actual,expected)
        geometry._valid_ring_coordinates.cache_clear()


if __name__=='__main__':
    unittest.main()
