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


def adapt_intent(intent, snapshot, plan, map_package, assignment_seed):
    """Provisional local intent = current prefs; no team field names are assumed.

    The independently supplied seed must not silently replace a different intent
    seed. Spatial payloads come from the explicit map argument, never the intent.
    none deliberately does not inspect/copy the supplied map package.
    """
    require(isinstance(intent,dict),'INVALID_INPUT','Scene intent must be an object')
    require(not any(key in intent for key in ('snapshot','plan','map')),
            'INVALID_INPUT','Pass actual snapshot, plan and map separately from scene intent')
    if 'assignment_seed' in intent:
        require(type(intent['assignment_seed']) is type(assignment_seed) and intent['assignment_seed']==assignment_seed,
                'INVALID_INPUT','Intent seed differs from the independent assignment_seed')
    prefs=copy.deepcopy(intent)
    prefs['assignment_seed']=assignment_seed
    return adapt_request(prefs,snapshot,plan,None if prefs.get('mode')=='none' else map_package)
