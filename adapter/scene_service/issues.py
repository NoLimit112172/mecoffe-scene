"""Shared Chinese explanations; these describe failures, never change rules."""
import copy
import json
from pathlib import Path

ISSUE_MESSAGES = json.loads(Path(__file__).with_name('issue_messages.json').read_text(encoding='utf-8'))


def describe_issue(code, details=''):
    """Return an independent explanation, retaining an unknown diagnostic code."""
    code = code or 'INVALID_INPUT'
    return {'code': code, **copy.deepcopy(ISSUE_MESSAGES.get(code, ISSUE_MESSAGES['INVALID_INPUT'])),
            'details': str(details)}


def compile_failure(error):
    return {'ok': False, 'error': describe_issue(getattr(error, 'code', 'INVALID_INPUT'), str(error))}
