"""Portable JSON and explicit scene errors; no network or model dependencies."""
import hashlib
import json
import math
from pathlib import Path

SAFE_INTEGER = 9007199254740991
JSON_WHITESPACE = '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'


def nonblank(value):
    return isinstance(value, str) and bool(value.strip(JSON_WHITESPACE))


class SceneError(ValueError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def require(condition, code, message):
    if not condition:
        raise SceneError(code, message)


def portable(value):
    if isinstance(value, str):
        require(not any(0xD800 <= ord(c) <= 0xDFFF for c in value), 'INVALID_JSON', 'JSON contains an unpaired surrogate')
        return value
    if value is None or type(value) is bool:
        return value
    if isinstance(value, (int, float)):
        require(math.isfinite(value) and int(value) == value and abs(value) <= SAFE_INTEGER,
                'INVALID_JSON', 'SceneResult v1 numbers must be safe integers')
        return int(value)
    if isinstance(value, list):
        return [portable(item) for item in value]
    if isinstance(value, dict):
        require(all(isinstance(key, str) for key in value), 'INVALID_JSON', 'Object keys must be strings')
        return {portable(key): portable(item) for key, item in value.items()}
    raise SceneError('INVALID_JSON', 'Unsupported JSON value')


def canonical(value):
    return json.dumps(portable(value), ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode('utf-8')).hexdigest()


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding='utf-8'))
    except (OSError, ValueError) as error:
        raise SceneError('INVALID_INPUT', f'Cannot read JSON input: {error}') from error


def write_json(path, value):
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')
