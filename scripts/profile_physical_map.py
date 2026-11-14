"""Compare the unmodified offline physical-map CLI in fresh, isolated processes.

Example (Python 3.11, standard library only):
  python -B scripts/profile_physical_map.py --python /path/to/python3.11 \
    --output logs/physical-map-speed/review-01

The primary metric includes interpreter startup and all local physical-map work;
it excludes upstream OSM acquisition. Inputs are archived bytes, not downloaded.
Every invocation has an absent candidate directory. Filesystem caches are not
flushed. Stages are observed at the parent's receipt of the unchanged stderr
phase records. wait4 reports each child process's own peak RSS.

Real recipes fingerprint the implementation, so changed code necessarily changes
some published bytes. An additional, separately labelled diagnostic substitutes
only _builder_identity in memory, then calls the same CLI parser. That diagnostic
must match every output byte; it is never included in performance aggregates.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import selectors
import shlex
import shutil
import signal
import statistics
import subprocess
import sys
import tarfile
import time

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CASES = ROOT / 'adapter/physical_map_examples/performance/cases.json'
RUNTIME_PATHS = ('adapter', 'scripts/prepare-physical-map.py',
                 'frontend/public/mecoffe/assets3d/catalog.json', 'NOTICE.md', 'YULAN_LICENSE')
PHASES = ['reading', 'geometry', 'entrances_gis', 'evidence_quality', 'publishing']
FIXED_IDENTITY = {'name': 'mecoffe-physical-map-builder', 'version': 'physical-map.1',
                  'implementation_sha256': '0' * 64}
DIAGNOSTIC_CODE = """import json,sys
sys.path.insert(0,sys.argv[1])
import adapter.scene_builder.physical_map as physical
physical._builder_identity=lambda:json.loads(sys.argv[2])
from adapter.scene_builder.__main__ import main
raise SystemExit(main(['physical-map',*sys.argv[3:]]))
"""


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def write_json(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + '\n', encoding='utf-8')


def file_table(root):
    return {p.relative_to(root).as_posix(): {'sha256': digest(p), 'bytes': p.stat().st_size}
            for p in sorted(Path(root).rglob('*')) if p.is_file() and '__pycache__' not in p.parts}


def snapshot_baseline(repo, commit, target):
    resolved = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', commit + '^{commit}'], text=True).strip()
    archive = target.parent / 'baseline-runtime.tar'
    subprocess.run(['git', '-C', str(repo), 'archive', '--format=tar', '--output=' + str(archive),
                    resolved, *RUNTIME_PATHS], check=True)
    target.mkdir()
    with tarfile.open(archive) as contents:
        if any(not (member.isfile() or member.isdir()) for member in contents):
            raise ValueError('Runtime archive contains a non-regular entry')
        contents.extractall(target, filter='data')
    return {'source_commit': resolved, 'git_archive_command': ['git', '-C', str(repo), 'archive',
            '--format=tar', '--output=' + str(archive), resolved, *RUNTIME_PATHS],
            'archive': str(archive), 'archive_sha256': digest(archive), 'files': file_table(target)}


def snapshot_optimized(repo, target):
    target.mkdir()
    for name in RUNTIME_PATHS:
        source, destination = repo / name, target / name
        if source.is_dir():
            shutil.copytree(source, destination, ignore=shutil.ignore_patterns('__pycache__', '*.pyc'))
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source, destination)
    return {'source_worktree': str(repo), 'source_head': subprocess.check_output(
        ['git', '-C', str(repo), 'rev-parse', 'HEAD'], text=True).strip(),
        'git_status': subprocess.check_output(['git', '-C', str(repo), 'status', '--short'], text=True),
        'files': file_table(target)}


def freeze_inputs(repo, specification, target, case_ids):
    target.mkdir()
    cases = []
    for raw_case in specification['cases']:
        if case_ids and raw_case['id'] not in case_ids:
            continue
        case = dict(raw_case)
        directory = target / case['id']; directory.mkdir()
        for field in ['osm', 'metadata', 'scope', 'scope_source']:
            original = repo / case[field]
            frozen = directory / original.name
            shutil.copyfile(original, frozen)
            case[field] = str(frozen)
        metadata = json.loads(Path(case['metadata']).read_bytes())
        if digest(case['osm']) != metadata['sha256'] or metadata['sha256'] != case['expected_source_sha256']:
            raise ValueError('Archived XML/metadata hash mismatch: ' + case['id'])
        cases.append(case)
    if not cases or (case_ids and set(case_ids) != {case['id'] for case in cases}):
        raise ValueError('Unknown or empty benchmark case selection')
    shared = {}
    for field in ['rules', 'limits']:
        frozen = target / Path(specification[field]).name
        shutil.copyfile(repo / specification[field], frozen)
        shared[field] = str(frozen)
    shared['road_buffer_m'], shared['seed'] = specification['road_buffer_m'], specification['seed']
    return cases, shared


def cli_arguments(case, shared, candidate):
    return ['--osm', case['osm'], '--metadata', case['metadata'], '--scope', case['scope'],
            '--scope-source', case['scope_source'], '--map-id', case['map_id'],
            '--map-version', case['map_version'], '--title', case['title'], '--rules', shared['rules'],
            '--limits', shared['limits'], '--road-buffer-m', str(shared['road_buffer_m']),
            '--seed', str(shared['seed']), '--out', str(candidate)]


def observed_stage_seconds(events, elapsed):
    result, previous_phase, previous_time = {}, 'startup', 0.
    for event in events:
        at = event['observed_seconds']
        result[previous_phase] = result.get(previous_phase, 0.) + at - previous_time
        previous_phase, previous_time = event['phase'], at
    result[previous_phase] = result.get(previous_phase, 0.) + elapsed - previous_time
    return result


def run_cli(python, runtime, case, shared, directory, timeout, fixed_identity=False):
    directory.mkdir(parents=True)
    candidate = directory / 'candidate'
    if candidate.exists():
        raise ValueError('Candidate must be absent before each invocation')
    arguments = cli_arguments(case, shared, candidate)
    command = ([python, '-I', '-B', '-c', DIAGNOSTIC_CODE, str(runtime), json.dumps(FIXED_IDENTITY), *arguments]
               if fixed_identity else [python, '-I', '-B', str(runtime / 'scripts/prepare-physical-map.py'), *arguments])
    record = {'command': command, 'shell_display_only': shlex.join(command), 'cwd': str(directory),
              'cli_input_argv': arguments, 'empty_output_before': True,
              'fixed_builder_identity_diagnostic': fixed_identity, 'timeout_seconds': timeout}
    write_json(directory / 'command.json', record)
    events, buffers = [], {'stdout': bytearray(), 'stderr': bytearray()}
    started = time.perf_counter()
    process = subprocess.Popen(command, cwd=directory, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                               bufsize=0, start_new_session=True)
    timed_out = False
    with selectors.DefaultSelector() as selector, (directory / 'stdout.json').open('wb') as stdout, (directory / 'stderr.jsonl').open('wb') as stderr:
        for stream, name in [(process.stdout, 'stdout'), (process.stderr, 'stderr')]:
            selector.register(stream, selectors.EVENT_READ, (name, stdout if name == 'stdout' else stderr))
        while selector.get_map():
            if not timed_out and time.perf_counter() - started > timeout:
                timed_out = True
                os.killpg(process.pid, signal.SIGKILL)
            for key, _ in selector.select(.2):
                name, destination = key.data
                chunk = os.read(key.fileobj.fileno(), 65536)
                if not chunk:
                    selector.unregister(key.fileobj); key.fileobj.close(); continue
                destination.write(chunk); buffers[name].extend(chunk)
                if name == 'stderr':
                    while b'\n' in buffers[name]:
                        line, _, remainder = buffers[name].partition(b'\n'); buffers[name] = bytearray(remainder)
                        try:
                            event = json.loads(line)
                            if isinstance(event, dict) and event.get('phase'):
                                events.append({'phase': event['phase'], 'observed_seconds': time.perf_counter() - started})
                        except (UnicodeDecodeError, json.JSONDecodeError):
                            pass
        _, status, usage = os.wait4(process.pid, 0)
        process.returncode = os.waitstatus_to_exitcode(status)
        elapsed = time.perf_counter() - started
    rss_bytes = int(usage.ru_maxrss if sys.platform == 'darwin' else usage.ru_maxrss * 1024)
    record.update(exit_code=process.returncode, timed_out=timed_out, wall_seconds=elapsed,
                  peak_rss_bytes=rss_bytes, peak_rss_mib=rss_bytes / 1048576,
                  stderr_events=events, phase_sequence=[e['phase'] for e in events],
                  phase_sequence_matches_contract=[e['phase'] for e in events] == PHASES,
                  observed_stage_seconds=observed_stage_seconds(events, elapsed),
                  user_cpu_seconds=usage.ru_utime, system_cpu_seconds=usage.ru_stime)
    if process.returncode == 0:
        value = json.loads((directory / 'stdout.json').read_bytes())
        record.update(summary=value['summary'], builder_identity=value['recipe']['builder'],
                      recipe=value['recipe'], candidate_files=file_table(candidate))
    write_json(directory / 'measurement.json', record)
    return record


def json_changes(left, right, path='$'):
    if type(left) is not type(right):
        return [{'path': path, 'before': left, 'after': right}]
    if isinstance(left, dict):
        result = []
        for key in sorted(set(left) | set(right)):
            if key not in left or key not in right:
                result.append({'path': path + '.' + key, 'before': left.get(key), 'after': right.get(key)})
            else:
                result.extend(json_changes(left[key], right[key], path + '.' + key))
        return result
    if isinstance(left, list) and len(left) == len(right):
        return [change for index, (a, b) in enumerate(zip(left, right))
                for change in json_changes(a, b, path + '[' + str(index) + ']')]
    return [] if left == right else [{'path': path, 'before': left, 'after': right}]


def compare_candidates(left, right):
    a, b = file_table(left), file_table(right)
    changed = [name for name in sorted(set(a) | set(b)) if a.get(name) != b.get(name)]
    result = {'all_bytes_identical': not changed, 'files_before': a, 'files_after': b, 'changed_files': changed,
              'json_changes': {}}
    for name in changed:
        if name in a and name in b and name.endswith(('.json', '.geojson')):
            result['json_changes'][name] = json_changes(json.loads((left / name).read_bytes()), json.loads((right / name).read_bytes()))
    return result


def audit_provenance_changes(comparison, stdout_before, stdout_after):
    """Allow only the real implementation fingerprint and its hash cascade.

    This audits raw outputs rather than normalizing or dropping their fields.
    The independent fixed-identity comparison still checks complete bytes.
    """
    source_files = {'asset_assignments.json': '$.geometry_source', 'entrances.json': '$.geometry_source',
                    'campus3d.json': '$.source', 'landcover.json': '$.source',
                    **{f'gis/{name}.geojson': '$.source' for name in
                       ['boundary', 'buildings', 'entrances', 'landcover', 'pois', 'roads', 'water']}}
    unclassified = []
    for name in comparison['changed_files']:
        changes = comparison['json_changes'].get(name, [])
        if not changes:
            unclassified.append({'file': name, 'reason': 'File-set, binary, or serialization difference'})
        for change in changes:
            path = change['path']
            allowed = (name in source_files and path == source_files[name] + '.physical_map.builder.implementation_sha256')
            allowed |= name in ['manifest.json', 'quality.json'] and path == '$.evidence_policy.input_map_ref.manifest_sha256'
            allowed |= (name == 'manifest.json' and path.startswith('$.files.') and
                        path[len('$.files.'):] in comparison['changed_files'] and path[len('$.files.'):] != 'manifest.json')
            if not allowed:
                unclassified.append({'file': name, **change})
    stdout_changes = json_changes(stdout_before, stdout_after)
    allowed_stdout = {'$.map_ref.manifest_sha256', '$.quality.evidence_policy.input_map_ref.manifest_sha256',
                      '$.recipe.builder.implementation_sha256'}
    unclassified.extend({'file': 'stdout', **change} for change in stdout_changes if change['path'] not in allowed_stdout)
    return {'only_implementation_fingerprint_and_dependent_hashes_changed': not unclassified,
            'unclassified_changes': unclassified, 'stdout_json_changes': stdout_changes,
            'stdout_absolute_path_fields_changed': [] if all(change['path'] in allowed_stdout for change in stdout_changes) else None}


def aggregate(records):
    walls = [record['wall_seconds'] for record in records]
    phases = sorted({phase for record in records for phase in record['observed_stage_seconds']})
    return {'runs': len(records), 'wall_seconds': walls, 'median_wall_seconds': statistics.median(walls),
            'min_wall_seconds': min(walls), 'max_wall_seconds': max(walls),
            'peak_rss_mib': [record['peak_rss_mib'] for record in records],
            'max_peak_rss_mib': max(record['peak_rss_mib'] for record in records),
            'median_observed_stage_seconds': {phase: statistics.median(record['observed_stage_seconds'].get(phase, 0.) for record in records) for phase in phases},
            'summary': records[0]['summary'], 'all_quality_summaries_identical': all(record['summary'] == records[0]['summary'] for record in records)}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--python', default=sys.executable)
    parser.add_argument('--baseline-commit', default='c51f7bd')
    parser.add_argument('--optimized-root', type=Path, default=ROOT)
    parser.add_argument('--case-file', type=Path, default=DEFAULT_CASES)
    parser.add_argument('--cases', nargs='+')
    parser.add_argument('--variants', nargs='+', choices=['baseline', 'optimized'], default=['baseline', 'optimized'])
    parser.add_argument('--repeats', type=int, default=3)
    parser.add_argument('--timeout-seconds', type=float, default=900.)
    parser.add_argument('--skip-fixed-identity', action='store_true')
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    if not hasattr(os, 'wait4'):
        parser.error('This benchmark requires POSIX wait4 for per-process peak RSS (Linux/macOS).')
    if args.repeats < 1 or args.timeout_seconds <= 0:
        parser.error('repeats and timeout must be positive')
    output = args.output.resolve(); output.mkdir(parents=True, exist_ok=False)
    repo = args.optimized_root.resolve()
    report = {'schema': 'mecoffe.physical-map-benchmark.v1', 'primary_metric': 'Fresh-process local physical-map total wall time including startup; excludes upstream OSM download.',
              'measurement_conditions': ['Archived inputs; no network acquisition.', 'Every candidate directory is absent before its invocation.',
                 'OS filesystem caches are not flushed; fresh process is not a claim of cold disk cache.',
                 'Phase times are parent-observed unchanged stderr boundaries; RSS is per-child wait4 maximum.',
                 'Fixed-identity runs are compatibility diagnostics only and excluded from timing aggregates.'],
              'python': subprocess.check_output([args.python, '--version'], text=True).strip(), 'platform': sys.platform,
              'invocation': [sys.executable, *sys.argv], 'variants': {}, 'runs': {}, 'comparisons': {}}
    try:
        baseline, optimized = output / 'baseline-runtime', output / 'optimized-runtime'
        report['baseline_snapshot'] = snapshot_baseline(repo, args.baseline_commit, baseline)
        report['optimized_snapshot'] = snapshot_optimized(repo, optimized)
        specification = json.loads(args.case_file.read_bytes())
        cases, shared = freeze_inputs(repo, specification, output / 'inputs', args.cases)
        report['inputs'] = {'cases': cases, 'shared': shared, 'files': file_table(output / 'inputs')}
        original_rules = baseline / specification['rules']
        if digest(original_rules) != digest(shared['rules']):
            raise ValueError('Evidence rules differ from the baseline; this is not a pure performance comparison')
        runtimes = {'baseline': baseline, 'optimized': optimized}
        for case in cases:
            case_runs = {variant: [] for variant in args.variants}
            report['runs'][case['id']] = case_runs
            for index in range(args.repeats):
                order = args.variants if index % 2 == 0 else list(reversed(args.variants))
                for variant in order:
                    directory = output / case['id'] / variant / f'run-{index + 1:02d}'
                    measurement = run_cli(args.python, runtimes[variant], case, shared, directory, args.timeout_seconds)
                    case_runs[variant].append(measurement)
                    print(json.dumps({'case': case['id'], 'variant': variant, 'run': index + 1,
                        'exit': measurement['exit_code'], 'wall_seconds': measurement['wall_seconds'],
                        'rss_mib': measurement['peak_rss_mib'], 'summary': {key: value for key, value in measurement.get('summary', {}).items() if key != 'warnings'}}, ensure_ascii=False), flush=True)
                    if measurement['exit_code'] != 0 or not measurement['phase_sequence_matches_contract']:
                        raise ValueError('CLI failure or phase contract mismatch; inspect ' + str(directory))
            report['variants'][case['id']] = {variant: aggregate(rows) for variant, rows in case_runs.items()}
            for variant in args.variants:
                first = output / case['id'] / variant / 'run-01/candidate'
                if not all(compare_candidates(first, output / case['id'] / variant / f'run-{index + 1:02d}/candidate')['all_bytes_identical'] for index in range(args.repeats)):
                    raise ValueError('One implementation produced nondeterministic repeated outputs: ' + variant)
            if set(args.variants) == {'baseline', 'optimized'}:
                comparison = compare_candidates(output / case['id'] / 'baseline/run-01/candidate', output / case['id'] / 'optimized/run-01/candidate')
                comparison['speedup'] = report['variants'][case['id']]['baseline']['median_wall_seconds'] / report['variants'][case['id']]['optimized']['median_wall_seconds']
                comparison['quality_summary_identical'] = case_runs['baseline'][0]['summary'] == case_runs['optimized'][0]['summary']
                comparison['raw_provenance_audit'] = audit_provenance_changes(comparison,
                    json.loads((output / case['id'] / 'baseline/run-01/stdout.json').read_bytes()),
                    json.loads((output / case['id'] / 'optimized/run-01/stdout.json').read_bytes()))
                report['comparisons'][case['id']] = comparison
                if not comparison['raw_provenance_audit']['only_implementation_fingerprint_and_dependent_hashes_changed']:
                    raise ValueError('Real outputs contain a change beyond the implementation fingerprint/hash cascade')
                if not args.skip_fixed_identity:
                    for variant in args.variants:
                        diagnostic = run_cli(args.python, runtimes[variant], case, shared, output / case['id'] / variant / 'fixed-identity', args.timeout_seconds, True)
                        if diagnostic['exit_code']:
                            raise ValueError('Fixed-identity diagnostic CLI failed')
                    comparison['fixed_identity_diagnostic'] = compare_candidates(output / case['id'] / 'baseline/fixed-identity/candidate', output / case['id'] / 'optimized/fixed-identity/candidate')
                    comparison['fixed_identity_stdout_bytes_identical'] = ((output / case['id'] / 'baseline/fixed-identity/stdout.json').read_bytes() ==
                                                                          (output / case['id'] / 'optimized/fixed-identity/stdout.json').read_bytes())
                    if not comparison['fixed_identity_diagnostic']['all_bytes_identical']:
                        raise ValueError('Fixed-identity diagnostic detected a semantic or serialization change')
                    if not comparison['fixed_identity_stdout_bytes_identical']:
                        raise ValueError('Fixed-identity diagnostic stdout differs')
                if not comparison['quality_summary_identical']:
                    raise ValueError('Quality/function summary changed')
        report['passed'] = True
    except Exception as error:
        report.update(passed=False, error=str(error))
        raise
    finally:
        write_json(output / 'result.json', report)
    print(json.dumps({'passed': True, 'output': str(output), 'variants': {case: {variant: {key: value for key, value in row.items() if key != 'summary'} for variant, row in variants.items()} for case, variants in report['variants'].items()},
                      'speedups': {key: row['speedup'] for key, row in report['comparisons'].items()}}, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
