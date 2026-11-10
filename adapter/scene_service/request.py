"""Boundary adapter: future scene_intent field names are translated only here."""
import copy

from .common import require


def adapt_request(prefs, snapshot, plan, map_package=None):
    """Accept the documented internal preferences, never infer missing intent."""
    require(isinstance(prefs,dict),'INVALID_INPUT','Preferences must be an object')
    require(isinstance(snapshot,dict) and isinstance(plan,dict),'REF_MISMATCH','Snapshot and plan must be objects')
    result=copy.deepcopy(prefs)
    result['snapshot']=copy.deepcopy(snapshot)
    result['plan']=copy.deepcopy(plan)
    if map_package is not None:
        require(isinstance(map_package,dict),'INVALID_MAP','Expected a local map package')
        result['map']=copy.deepcopy(map_package)
    return result
