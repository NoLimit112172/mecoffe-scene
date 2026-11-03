import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const read = path => readFileSync(join(root, path), 'utf8')

// JSONC is the format VS Code accepts. Strip comments outside strings only;
// a regexp alone would corrupt the // in launch URLs or quoted file paths.
function parseJsonc(source) {
  const text = source.replace(/^\uFEFF/, '')
  let cleaned = '', quoted = false, escaped = false
  for (let i = 0; i < text.length; i++) {
    const character = text[i]
    if (quoted) {
      cleaned += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') {
      quoted = true
      cleaned += character
    } else if (character === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
      cleaned += '\n'
    } else if (character === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2)
      assert.notEqual(end, -1, 'Unclosed JSONC comment')
      cleaned += ' '
      i = end + 1
    } else cleaned += character
  }
  let withoutTrailingCommas = ''
  quoted = false
  escaped = false
  for (let i = 0; i < cleaned.length; i++) {
    const character = cleaned[i]
    if (quoted) {
      withoutTrailingCommas += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') quoted = false
    } else if (character === '"') {
      quoted = true
      withoutTrailingCommas += character
    } else if (character !== ',' || !/^\s*[}\]]/.test(cleaned.slice(i + 1))) {
      withoutTrailingCommas += character
    }
  }
  return JSON.parse(withoutTrailingCommas)
}

const config = path => parseJsonc(read(path))
const tasksConfig = () => config('.vscode/tasks.json')
const launchConfig = () => config('.vscode/launch.json')
const frontendPackage = () => config('frontend/package.json')

function workspacePath(value, cwd = root) {
  assert.equal(typeof value, 'string', 'A referenced path must be a string')
  const expanded = value.replaceAll('${workspaceFolder}', root)
  assert.ok(!expanded.includes('${'), `Unresolved path variable: ${value}`)
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded)
}

function requireFile(path, context) {
  assert.ok(existsSync(path) && statSync(path).isFile(), `${context}: missing file ${path}`)
}

function requireDirectory(path, context) {
  assert.ok(existsSync(path) && statSync(path).isDirectory(), `${context}: missing directory ${path}`)
}

function validateTaskReferences(document) {
  const tasks = document.tasks
  assert.ok(Array.isArray(tasks) && tasks.length > 0)
  const labels = new Set(tasks.map(task => task.label))
  assert.equal(labels.size, tasks.length, 'Task labels must be unique')
  const inputs = new Set((document.inputs || []).map(input => input.id))
  assert.equal(inputs.size, (document.inputs || []).length, 'Input IDs must be unique')
  for (const reference of JSON.stringify(tasks).matchAll(/\$\{input:([^}]+)\}/g)) {
    assert.ok(inputs.has(reference[1]), `Missing input: ${reference[1]}`)
  }
  for (const task of tasks) {
    assert.match(task.label, /^MeCoffe：[\s\S]*[\u4e00-\u9fff]/, 'Use the shared Chinese task prefix')
    const dependencies = [task.dependsOn || []].flat()
    for (const label of dependencies) assert.ok(labels.has(label), `Missing dependency: ${label}`)
    const cwd = workspacePath(task.options?.cwd || '${workspaceFolder}')
    requireDirectory(cwd, task.label)
    if (!task.command) {
      assert.ok(dependencies.length, `${task.label}: a task needs a command or dependencies`)
      continue
    }
    assert.equal(task.type, 'process', `${task.label}: pass prompt values as arguments, not shell code`)
    const args = task.args || []
    assert.ok(args.every(value => typeof value === 'string'), `${task.label}: arguments must be strings`)
    const executable = basename(task.command).toLowerCase().replace(/\.exe$|\.cmd$/, '')
    if (/^python(?:3)?$/.test(executable)) {
      const moduleIndex = args.indexOf('-m')
      if (moduleIndex >= 0) {
        const module = args[moduleIndex + 1]
        assert.ok(module, `${task.label}: missing module name`)
        if (module === 'unittest') {
          assert.ok(args.includes('discover'), 'The Python suite must use unittest discovery')
          requireDirectory(workspacePath(args[args.indexOf('-s') + 1], cwd), task.label)
        } else {
          const modulePath = workspacePath(module.replaceAll('.', '/'), cwd)
          assert.ok(existsSync(`${modulePath}.py`) || existsSync(join(modulePath, '__main__.py')),
            `${task.label}: missing runnable Python module ${module}`)
        }
      } else {
        const script = args.find(value => value.endsWith('.py'))
        assert.ok(script, `${task.label}: missing Python script argument`)
        requireFile(workspacePath(script, cwd), task.label)
      }
      for (const flag of ['--osm', '--metadata', '--catalog']) {
        const position = args.indexOf(flag)
        if (position >= 0 && !args[position + 1].includes('${input:')) {
          requireFile(workspacePath(args[position + 1], cwd), task.label)
        }
      }
    } else if (executable === 'powershell' || executable === 'pwsh') {
      const fileIndex = args.findIndex(value => value.toLowerCase() === '-file')
      assert.ok(fileIndex >= 0, `${task.label}: use an explicit PowerShell script`)
      const script = workspacePath(args[fileIndex + 1], cwd)
      requireFile(script, task.label)
      if (basename(script) === 'run-frontend.ps1') {
        const actionIndex = args.findIndex(value => value.toLowerCase() === '-action')
        assert.ok(actionIndex >= 0, `${task.label}: missing frontend action`)
        assert.ok(frontendPackage().scripts[args[actionIndex + 1]], `${task.label}: missing npm script`)
      }
    } else if (executable === 'node') {
      const script = args.find(value => /\.(?:c|m)?js$/.test(value))
      assert.ok(script, `${task.label}: missing Node script`)
      requireFile(workspacePath(script, cwd), task.label)
    } else if (executable === 'npm') {
      const scriptName = args[0] === 'run' ? args[1] : args[0]
      const packagePath = join(cwd, 'package.json')
      requireFile(packagePath, task.label)
      assert.ok(parseJsonc(readFileSync(packagePath, 'utf8')).scripts[scriptName], `${task.label}: missing npm script`)
    } else assert.fail(`${task.label}: add validation for executable ${task.command}`)
  }
  function visit(label, chain = []) {
    assert.ok(!chain.includes(label), `Circular task dependency: ${[...chain, label].join(' -> ')}`)
    const task = tasks.find(candidate => candidate.label === label)
    for (const dependency of [task.dependsOn || []].flat()) visit(dependency, [...chain, label])
  }
  for (const task of tasks) visit(task.label)
}

function validateLaunchReferences(document, tasksDocument) {
  const routes = new Set([...read('frontend/src/router/index.js').matchAll(/\bpath\s*:\s*['"]([^'"]+)['"]/g)].map(match => match[1]))
  const labels = new Set(tasksDocument.tasks.map(task => task.label))
  for (const launch of document.configurations) {
    const url = new URL(launch.url)
    assert.equal(url.origin, 'http://127.0.0.1:5180')
    assert.ok(routes.has(url.pathname), `Missing router path: ${url.pathname}`)
    assert.ok(labels.has(launch.preLaunchTask), `Missing preLaunchTask: ${launch.preLaunchTask}`)
    requireDirectory(workspacePath(launch.webRoot), launch.name)
    const campus = url.searchParams.get('campus')
    if (campus) {
      assert.match(campus, /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/)
      for (const file of ['campus3d.json', 'asset_assignments.json', 'manifest.json']) {
        requireFile(join(root, 'frontend/public/mecoffe/campuses', campus, file), launch.name)
      }
    }
  }
}

test('VS Code JSONC parsing keeps URLs, escaped strings and literal comment markers', () => {
  const parsed = parseJsonc(`\uFEFF{
    // A launch URL contains two slashes.
    "url": "http://127.0.0.1:5180/mecoffe3d?campus=nus",
    "quoted": "say \\"go\\" /* literal */ ,}", /* outside comment */
    "items": ["a", // trailing comment
      "b",],
  }`)
  assert.equal(parsed.url, 'http://127.0.0.1:5180/mecoffe3d?campus=nus')
  assert.equal(parsed.quoted, 'say "go" /* literal */ ,}')
  assert.deepEqual(parsed.items, ['a', 'b'])
  assert.throws(() => parseJsonc('{/* unclosed'), /Unclosed/)
})

test('all four ordered Chrome launch entries resolve to real routes and a ready-server task', () => {
  const launches = launchConfig(), tasks = tasksConfig()
  validateLaunchReferences(launches, tasks)
  assert.deepEqual(launches.configurations.map(launch => new URL(launch.url).pathname + new URL(launch.url).search),
    ['/mecoffe', '/mecoffe3d', '/mecoffe3d/assets', '/mecoffe3d?campus=nus'])
  assert.equal(new Set(launches.configurations.map(launch => launch.name)).size, 4)
  assert.equal(new Set(launches.configurations.map(launch => launch.presentation.group)).size, 1)
  for (const [index, launch] of launches.configurations.entries()) {
    assert.ok(['chrome', 'pwa-chrome'].includes(launch.type))
    assert.equal(launch.request, 'launch')
    assert.equal(launch.presentation.order, index + 1)
    const preparation = tasks.tasks.find(task => task.label === launch.preLaunchTask)
    assert.ok(preparation.args.some(value => value.replaceAll('\\', '/').endsWith('/start-mecoffe.ps1')))
    assert.ok(preparation.args.includes('-NoBrowser'), 'The debugger alone should open the selected page')
    assert.ok(!preparation.isBackground, 'Launcher returns only after the HTTP readiness check')
  }
})

test('all VS Code task scripts, modules, input references and dependencies exist', () => {
  validateTaskReferences(tasksConfig())
})

test('configuration checks reject broken route, missing prelaunch task and missing script/module', () => {
  const tasks = tasksConfig()
  const route = launchConfig()
  route.configurations[0].url = 'http://127.0.0.1:5180/not-a-real-page'
  assert.throws(() => validateLaunchReferences(route, tasks), /Missing router path/)
  const prelaunch = launchConfig()
  prelaunch.configurations[0].preLaunchTask = 'MeCoffe：不存在的任务'
  assert.throws(() => validateLaunchReferences(prelaunch, tasks), /Missing preLaunchTask/)
  const script = { tasks: [{ label: 'MeCoffe：测试缺失脚本', type: 'process', command: 'python', args: ['adapter/not-a-real-script.py'] }] }
  assert.throws(() => validateTaskReferences(script), /missing file/)
  const module = { tasks: [{ label: 'MeCoffe：测试缺失模块', type: 'process', command: 'python', args: ['-m', 'adapter.not_a_real_module'] }] }
  assert.throws(() => validateTaskReferences(module), /missing runnable Python module/)
  const input = { tasks: [{ label: 'MeCoffe：测试缺失输入', type: 'process', command: 'python', args: ['${input:missing}'] }] }
  assert.throws(() => validateTaskReferences(input), /Missing input/)
})

test('all-tests task runs Python and frontend suites sequentially without hiding failures', () => {
  const tasks = tasksConfig().tasks
  const all = tasks.find(task => task.label === 'MeCoffe：运行全部测试')
  assert.ok(all)
  assert.equal(all.dependsOrder, 'sequence')
  assert.ok(!all.command, 'Use dependency exit status rather than a shell chain')
  const dependencies = all.dependsOn.map(label => tasks.find(task => task.label === label))
  assert.ok(dependencies.some(task => task.args.includes('unittest') && task.args.includes('discover')))
  assert.ok(dependencies.some(task => task.args.includes('test')))
  assert.equal(all.group.kind, 'test')
  assert.equal(all.group.isDefault, true)
})

test('map tasks bind prompted inputs to the shared builder and preview directory', () => {
  const tasks = tasksConfig().tasks
  const builders = tasks.filter(task => task.args?.includes('adapter.scene_builder'))
  const value = (task, flag) => task.args[task.args.indexOf(flag) + 1]
  const osm = builders.find(task => task.args.includes('--bbox'))
  const geojson = builders.find(task => task.args.includes('geojson'))
  assert.ok(osm && geojson, 'Expose both input formats')
  for (const task of [osm, geojson]) {
    assert.equal(task.args[task.args.indexOf('-m') + 1], 'adapter.scene_builder')
    const campusId = value(task, '--campus-id')
    assert.match(campusId, /^\$\{input:[^}]+\}$/)
    assert.ok(value(task, '--output-dir').endsWith(`/frontend/public/mecoffe/campuses/${campusId}`),
      'The generated files must be served under the same prompted campus ID')
  }
  const bbox = osm.args.slice(osm.args.indexOf('--bbox') + 1, osm.args.indexOf('--bbox') + 5)
  assert.equal(bbox.length, 4)
  assert.equal(new Set(bbox).size, 4, 'Longitude/latitude bounds must use four distinct prompts')
  for (const coordinate of bbox) assert.match(coordinate, /^\$\{input:[^}]+\}$/)
  assert.match(value(geojson, '--input'), /^\$\{input:[^}]+\}$/)
  const legacy = builders.find(task => task.args.includes('ustc_legacy'))
  assert.ok(legacy, 'Rebuild USTC using the compatibility profile')
  assert.equal(value(legacy, '--profile'), 'ustc_legacy')
  assert.equal(value(legacy, '--output-dir').replaceAll('\\', '/'), 'frontend/public/mecoffe/campuses/ustc')
})

test('frontend task runner preserves npm failure status and stops after a failed install', { skip: process.platform !== 'win32' }, () => {
  // Exercise the actual runner in an isolated checkout with a fake npm. This
  // never installs packages, invokes the real frontend, or touches port 5180.
  const temporary = mkdtempSync(join(tmpdir(), 'mecoffe-vscode-runner-'))
  try {
    const scripts = join(temporary, 'scripts')
    const bin = join(temporary, 'fake node')
    const frontend = join(temporary, 'frontend')
    for (const directory of [scripts, bin, frontend]) mkdirSync(directory)
    const runner = join(scripts, 'run-frontend.ps1')
    copyFileSync(join(root, 'scripts/run-frontend.ps1'), runner)
    writeFileSync(join(bin, 'node.cmd'), '@echo off\r\nexit /b 0\r\n')
    const log = join(temporary, 'calls.txt')
    const environment = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'path'))
    environment.Path = `${bin};${process.env.Path || process.env.PATH}`
    environment.MECOFFE_TEST_CALL_LOG = log
    const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
    const run = exitCode => {
      writeFileSync(log, '')
      writeFileSync(join(bin, 'npm.cmd'), `@echo off\r\necho %*>>"%MECOFFE_TEST_CALL_LOG%"\r\nexit /b ${exitCode}\r\n`)
      const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runner, '-Action', 'test'],
        { env: environment, encoding: 'utf8', timeout: 30000, windowsHide: true })
      assert.ifError(result.error)
      assert.equal(result.status, exitCode, result.stderr || result.stdout)
      return readFileSync(log, 'utf8').trim().split(/\r?\n/)
    }
    assert.deepEqual(run(13), ['ci --no-audit --no-fund'], 'Do not run tests after npm ci fails')
    const viteDirectory = join(frontend, 'node_modules/vite/bin')
    mkdirSync(viteDirectory, { recursive: true })
    writeFileSync(join(viteDirectory, 'vite.js'), '// Existing dependency marker for the isolated runner test.\n')
    assert.deepEqual(run(7), ['run test'], 'Preserve the test command exit status')
    assert.deepEqual(run(0), ['run test'], 'A successful test command must return zero')
  } finally {
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
    assert.ok(basename(temporary).startsWith('mecoffe-vscode-runner-'))
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('launcher publishes generated files atomically and leaves identical locked files untouched', { skip: process.platform !== 'win32' }, () => {
  const temporary = mkdtempSync(join(tmpdir(), 'mecoffe-vscode-publish-'))
  try {
    const fixture = join(temporary, 'publish-test.ps1')
    // Load exactly the two functions under test from PowerShell's parser. Do
    // not dot-source the launcher body: it would generate data/start a server.
    writeFileSync(fixture, `param([string]$Launcher, [string]$Temporary)
$ErrorActionPreference = 'Stop'
$tokens = $null
$parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($Launcher, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'Launcher has a PowerShell syntax error' }
$names = @('Get-FileSha256', 'Publish-GeneratedFile')
$definitions = @($ast.FindAll({ param($node)
    $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $names -contains $node.Name
}, $true))
if ($definitions.Count -ne 2) { throw 'Expected exactly two publishing helper functions' }
foreach ($definition in $definitions) { . ([scriptblock]::Create($definition.Extent.Text)) }

$prepared = Join-Path $Temporary 'prepared.json'
$destination = Join-Path $Temporary 'destination.json'
[IO.File]::WriteAllText($prepared, 'identical content')
[IO.File]::WriteAllText($destination, 'identical content')
[IO.File]::SetLastWriteTimeUtc($destination, [datetime]'2020-01-02T03:04:05Z')
$before = [IO.File]::GetLastWriteTimeUtc($destination).Ticks
$handle = [IO.File]::Open($destination, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    Publish-GeneratedFile $prepared $destination
    if ([IO.File]::GetLastWriteTimeUtc($destination).Ticks -ne $before) { throw 'Identical data changed destination mtime' }
    if ([IO.File]::ReadAllText($destination) -ne 'identical content') { throw 'Identical data changed destination content' }
} finally { $handle.Dispose() }

[IO.File]::WriteAllText($prepared, 'new content')
Publish-GeneratedFile $prepared $destination
if ([IO.File]::ReadAllText($destination) -ne 'new content') { throw 'Changed data was not published' }
if (Test-Path -LiteralPath $prepared) { throw 'Atomic replacement did not consume the prepared file' }

$missing = Join-Path $Temporary 'new-destination.json'
[IO.File]::WriteAllText($prepared, 'first content')
Publish-GeneratedFile $prepared $missing
if ([IO.File]::ReadAllText($missing) -ne 'first content') { throw 'Missing target was not created' }
if (Test-Path -LiteralPath $prepared) { throw 'Move did not consume the prepared file' }

[IO.File]::WriteAllText($prepared, 'blocked replacement')
$handle = [IO.File]::Open($destination, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::Read)
try {
    $failed = $false
    try { Publish-GeneratedFile $prepared $destination } catch { $failed = $true }
    if (-not $failed) { throw 'Replacing a locked different target must fail' }
    if ([IO.File]::ReadAllText($destination) -ne 'new content') { throw 'Failed replacement damaged the old target' }
    if ([IO.File]::ReadAllText($prepared) -ne 'blocked replacement') { throw 'Failed replacement damaged the prepared file' }
} finally { $handle.Dispose() }
Write-Output 'PUBLISH_OK: identical-locked, changed, missing, changed-locked'
`, 'utf8')
    const powershell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe')
    const result = spawnSync(powershell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', fixture,
      '-Launcher', join(root, 'start-mecoffe.ps1'), '-Temporary', temporary],
    { encoding: 'utf8', timeout: 30000, windowsHide: true })
    assert.ifError(result.error)
    assert.equal(result.status, 0, result.stderr || result.stdout)
    assert.match(result.stdout, /PUBLISH_OK: identical-locked, changed, missing, changed-locked/)
  } finally {
    assert.equal(dirname(resolve(temporary)), resolve(tmpdir()))
    assert.ok(basename(temporary).startsWith('mecoffe-vscode-publish-'))
    rmSync(temporary, { recursive: true, force: true })
  }
})

test('workspace recommendations and search exclusions keep source editing practical', () => {
  const workspace = config('mecoffe-scene.code-workspace')
  for (const folder of workspace.folders) requireDirectory(workspacePath(folder.path), 'Workspace folder')
  const exclusions = workspace.settings['search.exclude']
  for (const token of ['node_modules', 'dist', 'data/source', 'data/osm']) {
    assert.ok(Object.entries(exclusions).some(([pattern, enabled]) => enabled === true && pattern.includes(token)), `Search excludes ${token}`)
  }
  const extensions = new Set(config('.vscode/extensions.json').recommendations.map(extension => extension.toLowerCase()))
  for (const id of ['vue.volar', 'ms-python.python', 'ms-python.vscode-pylance']) assert.ok(extensions.has(id), `Recommend ${id}`)
})
