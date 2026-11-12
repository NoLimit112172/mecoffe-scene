"""Stable runtime API. Generated export: edit the authoritative repository sources."""
from .compiler import compile_scene
from .validation import validate_result
from .checker import check_scene
from .maps import load_map
from .issues import describe_issue
from .common import SceneError

__version__ = '0.2.0'
SCENE_RESULT_SCHEMA_VERSIONS = ('scene.result.v1', 'scene.result.v2', 'scene.result.v3')
# New auto-evidence.2 maps emit v3; legacy maps and none still emit v2.
SCENE_RESULT_OUTPUT_SCHEMA_VERSION = 'scene.result.v3'
__all__ = ['compile_scene', 'validate_result', 'check_scene', 'load_map', 'describe_issue',
           'SceneError', '__version__', 'SCENE_RESULT_SCHEMA_VERSIONS', 'SCENE_RESULT_OUTPUT_SCHEMA_VERSION']
