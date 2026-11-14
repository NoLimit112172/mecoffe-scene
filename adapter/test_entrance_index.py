"""Differential checks for exact cold-build entrance road search."""
import copy
import math
import random
import unittest
from unittest.mock import patch

from adapter.scene_builder import entrances


class BruteRoadIndex:
    """Reference search from the original facade x all-edges implementation."""
    def __init__(self, edges):
        self.edges = edges

    def best(self, point, normal, facade, length, limit=math.inf):
        selected = None
        for edge, a, b in self.edges:
            road = entrances.project(point, a, b)
            dx, dy = road[0]-point[0], road[1]-point[1]
            if dx*normal[0]+dy*normal[1] < -1e-6:
                continue
            key = (round(entrances.distance(point, road), 6), -length,
                   str(edge['source']), str(edge['target']), point)
            if key[0] <= limit and (selected is None or key < selected[0]):
                selected = (key, edge, point, road, normal, facade)
        return selected


def edge(identifier, a, b, **extra):
    return ({'source': identifier+'/a', 'target': identifier+'/b', **extra}, a, b)


class EntranceIndexTests(unittest.TestCase):
    def assert_search_equal(self, edges, point, normal, length=10., limit=math.inf):
        facade = [[point[0]-1., point[1]], [point[0]+1., point[1]]]
        expected = BruteRoadIndex(edges).best(point, normal, facade, length, limit)
        actual = entrances._RoadIndex(edges).best(point, normal, facade, length, limit)
        self.assertEqual(actual, expected)
        return actual

    def test_rounding_ties_original_order_and_back_facing_roads(self):
        roads = [edge('z-near', [1.0000001, -2.], [1.0000001, 2.]),
                 edge('a-farther-tie', [1.0000004, -2.], [1.0000004, 2.]),
                 edge('behind', [-.01, -2.], [-.01, 2.])]
        roads += [edge('far'+str(i), [100.+i, -10.], [100.+i, 10.]) for i in range(30)]
        winner = self.assert_search_equal(roads, [0., 0.], [1., 0.])
        self.assertEqual(winner[1]['source'], 'a-farther-tie/a')
        # Metadata distinguishes duplicate edges with exactly the same old key.
        duplicate = [edge('same', [2., -3.], [2., 3.], ordinal=i) for i in range(20)]
        self.assertEqual(self.assert_search_equal(duplicate, [0., 0.], [1., 0.])[1]['ordinal'], 0)
        self.assertIsNone(self.assert_search_equal(roads, [0., 0.], [1., 0.], limit=.9))

    def test_large_coordinates_degenerate_edges_and_empty_graph(self):
        origin = 1e12
        roads = [edge('point', [origin+2., origin], [origin+2., origin]),
                 edge('line', [origin-3., origin-2.], [origin-3., origin+2.])]
        roads += [edge('far'+str(i), [origin+50.+i, origin], [origin+50.+i, origin+5.]) for i in range(20)]
        self.assert_search_equal(roads, [origin, origin], [1., 0.])
        self.assertIsNone(self.assert_search_equal([], [0., 0.], [1., 0.]))

    def test_randomized_search_matches_brute_force(self):
        for seed in range(12):
            randomizer = random.Random(seed)
            roads = [edge(str(i), [randomizer.uniform(-200., 200.), randomizer.uniform(-200., 200.)],
                          [randomizer.uniform(-200., 200.), randomizer.uniform(-200., 200.)])
                     for i in range(160)]
            index, reference = entrances._RoadIndex(roads), BruteRoadIndex(roads)
            for case in range(30):
                point = [randomizer.uniform(-250., 250.), randomizer.uniform(-250., 250.)]
                angle = randomizer.uniform(-math.pi, math.pi)
                normal = [math.cos(angle), math.sin(angle)]
                facade = [[point[0]-4., point[1]], [point[0]+4., point[1]]]
                limit = randomizer.choice([math.inf, 0., 1., 10., 100.])
                with self.subTest(seed=seed, case=case):
                    self.assertEqual(index.best(point, normal, facade, 8., limit),
                                     reference.best(point, normal, facade, 8., limit))

    def test_complete_outputs_match_brute_force_without_prior_place_cache(self):
        randomizer = random.Random(2026)
        nodes, edges = [], []
        for i in range(180):
            for end in ('a', 'b'):
                nodes.append({'id': f'{i}/{end}', 'x': randomizer.uniform(-100., 100.),
                              'y': randomizer.uniform(-100., 100.)})
            edges.append({'source': f'{i}/a', 'target': f'{i}/b'})
        buildings = []
        for i in range(25):
            x, y = randomizer.uniform(-90., 90.), randomizer.uniform(-90., 90.)
            polygon = [[x,y], [x+10.,y], [x+10.,y+4.], [x+4.,y+4.], [x+4.,y+10.], [x,y+10.], [x,y]]
            if i % 2:
                polygon.reverse()
            buildings.append({'osm_id': 'building/'+str(i), 'polygon': polygon})
        campus = {'campus_id': 'cold-index-test', 'projection': {
            'method': 'local_equirectangular', 'origin_lon': 116., 'origin_lat': 40., 'earth_radius_m': 6371000.},
            'source': {'source_type': 'synthetic'}, 'buildings': buildings,
            'walk_graph': {'nodes': nodes, 'edges': edges}}
        original = copy.deepcopy(campus)
        entrances._CACHE.clear()
        with patch.object(entrances, '_RoadIndex', BruteRoadIndex):
            expected = entrances.generate_entrances(campus)
        entrances._CACHE.clear()
        actual = entrances.generate_entrances(campus)
        self.assertEqual(actual, expected)
        self.assertEqual(campus, original)
        entrances._CACHE.clear()

    def test_cold_index_prunes_far_edges_before_exact_projection(self):
        roads = [edge('near', [2., -5.], [2., 5.])]
        roads += [edge('far'+str(i), [1000.+i, -5.], [1000.+i, 5.]) for i in range(1000)]
        index = entrances._RoadIndex(roads)
        with patch.object(entrances, 'project', wraps=entrances.project) as projected:
            winner = index.best([0., 0.], [1., 0.], [[0.,-5.], [0.,5.]], 10.)
            self.assertLess(projected.call_count, 30)
        self.assertEqual(winner[1]['source'], 'near/a')


if __name__ == '__main__':
    unittest.main()
