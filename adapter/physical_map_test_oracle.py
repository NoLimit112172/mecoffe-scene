"""Test-only, independently imported c51f7bd geometry/evidence from local Git.

This file is outside scene_service/scene_builder and is not a runtime module.
No current predicate or FullScan replacement is used as the historical oracle.
All relative imports in the private namespace also read the pinned Git commit.
A missing baseline is an explicit test failure, never a fallback to new code.
"""
from fractions import Fraction
from functools import lru_cache
import hashlib
import importlib
import importlib.abc
import importlib.util
import math
from pathlib import Path
import subprocess
import sys
import types


SOURCE_COMMIT = 'c51f7bd04ac06c82c4d21c04f2ff20eb1a465eeb'
SOURCE_SHA256 = {'geometry': '0ab96e3763a96be436826f23bb5ed580dcab7694211fdbd7bcb66ca4df0151f2',
                 'evidence': '41dafebe31b60c60c369a7f99c91e4abba8c85d578c64b21cb8e817493f05185'}
SEPARATED_SEGMENTS = [[59.22607115080913, -41.77362745156836],
                      [131.08213136827828, 107.19133539578883],
                      [131.08213191135872, 107.19133652165011],
                      [227.92868954281394, 307.96415673754103]]
_NAMESPACE = '_physical_map_test_c51f7bd_scene_service'
_ROOT = Path(__file__).resolve().parents[1]


class _PinnedModules(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def __init__(self):
        names = subprocess.check_output(['git', '-C', str(_ROOT), 'ls-tree', '-r', '--name-only',
                                         SOURCE_COMMIT, 'adapter/scene_service'], text=True)
        self.paths = set(names.splitlines())
        self.sources = {}

    def find_spec(self, fullname, path=None, target=None):
        if fullname != _NAMESPACE and not fullname.startswith(_NAMESPACE + '.'):
            return None
        suffix = fullname[len(_NAMESPACE):].replace('.', '/')
        base = 'adapter/scene_service' + suffix
        package = base + '/__init__.py'
        source = package if package in self.paths else base + '.py'
        if source not in self.paths:
            return None
        spec = importlib.util.spec_from_loader(fullname, self, is_package=source == package)
        spec.loader_state = source
        return spec

    def create_module(self, spec):
        return None

    def exec_module(self, module):
        source = module.__spec__.loader_state
        raw = self.sources.get(source)
        if raw is None:
            raw = subprocess.check_output(['git', '-C', str(_ROOT), 'show', SOURCE_COMMIT + ':' + source])
            self.sources[source] = raw
        name = source.rsplit('/', 1)[-1].removesuffix('.py')
        if name in SOURCE_SHA256 and hashlib.sha256(raw).hexdigest() != SOURCE_SHA256[name]:
            raise AssertionError('Pinned historical source SHA does not match: ' + source)
        module.__file__ = 'git:' + SOURCE_COMMIT + ':' + source
        exec(compile(raw, module.__file__, 'exec'), module.__dict__)


@lru_cache(maxsize=1)
def load_c51f7bd_modules():
    """Return (old_geometry, old_evidence), with independent pinned dependencies."""
    finder = _PinnedModules()
    sys.meta_path.insert(0, finder)
    # A private namespace avoids executing the public package's unrelated
    # compiler/contract-file initialization. Every imported implementation
    # submodule still comes directly from the pinned Git source above.
    package = types.ModuleType(_NAMESPACE)
    package.__path__ = []
    package.__spec__ = importlib.util.spec_from_loader(_NAMESPACE, finder, is_package=True)
    sys.modules[_NAMESPACE] = package
    try:
        geometry = importlib.import_module(_NAMESPACE + '.geometry')
        evidence = importlib.import_module(_NAMESPACE + '.evidence')
    except Exception:
        sys.meta_path.remove(finder)
        for name in list(sys.modules):
            if name == _NAMESPACE or name.startswith(_NAMESPACE + '.'):
                del sys.modules[name]
        raise
    return geometry, evidence


def cross(a, b, c):
    return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])


def separated_roundoff_false_positive(points, actual, historical):
    """Narrow differential exception, with exact binary-rational box proof.

    Only old True/new False, >2*EPS-separated ordinary finite segments, no old
    on-segment contact, and all four determinants within 32 ULPs of the squared
    local coordinate span qualify. Exact rational determinants satisfy the same
    bound. Contact/overlap, non-collinear changes and other result directions
    are not excepted. This does not exempt any enrich_map output differences.
    """
    if actual is not False or historical is not True:
        return False
    if (not isinstance(points,(list,tuple)) or len(points) != 4 or
            any(not isinstance(p,(list,tuple)) or len(p) != 2 for p in points) or
            any(type(x) not in (int, float) or not math.isfinite(x) or abs(x) > 1e8
                for p in points for x in p)):
        return False
    old, _ = load_c51f7bd_modules()
    a, b, c, d = points
    exact = [[Fraction(x) for x in p] for p in points]
    if not any(max(min(exact[2][i], exact[3][i]) - max(exact[0][i], exact[1][i]),
                   min(exact[0][i], exact[1][i]) - max(exact[2][i], exact[3][i])) > 2*Fraction(old.EPS)
               for i in (0, 1)):
        return False
    if any(old.on_segment(p, q, r) for p, q, r in ((a,c,d),(b,c,d),(c,a,b),(d,a,b))):
        return False
    span=max(1.,*(abs(p[i]-q[i]) for p in points for q in points for i in (0,1)))
    bound=32*math.ulp(span*span)
    exact_crosses=[]
    for p, q, r in ((a,b,c),(a,b,d),(c,d,a),(c,d,b)):
        exact_cross=(Fraction(q[0])-Fraction(p[0]))*(Fraction(r[1])-Fraction(p[1])) - (Fraction(q[1])-Fraction(p[1]))*(Fraction(r[0])-Fraction(p[0]))
        if abs(cross(p,q,r)) > bound or abs(exact_cross) > Fraction(bound):
            return False
        exact_crosses.append(exact_cross)
    return (old.intersects(*points) is True and
            not (exact_crosses[0]*exact_crosses[1] < 0 and exact_crosses[2]*exact_crosses[3] < 0))
