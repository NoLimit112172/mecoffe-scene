"""Pure scene compilation boundary. No files, network, database or registration."""
from .issues import compile_failure
from .request import adapt_intent
from .resolver import resolve


def compile_scene(intent, snapshot, plan, map_package=None, *, assignment_seed=None):
    """Provisional intent names are isolated in request.adapt_intent."""
    try:
        request = adapt_intent(intent, snapshot, plan, map_package, assignment_seed)
        return {'ok': True, 'result': resolve(request)}
    except (ValueError, KeyError, TypeError, AttributeError, IndexError) as error:
        return compile_failure(error)
