// Windows PowerShell 5.1 fallback for a parent environment containing Path/PATH.
// Receives only a local launcher request, starts Node directly, and keeps logs.
const fs = require('node:fs')
const { spawn } = require('node:child_process')

const request = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const { cwd, vite, port, stdout, stderr, pidFile } = request
if (!Number.isInteger(port) || port < 1024 || port > 65535 || !fs.existsSync(vite)) {
  throw new Error('Invalid local Vite launch request')
}
const environment = {}
const seen = new Set()
for (const [name, value] of Object.entries(process.env)) {
  const normalized = name.toLowerCase()
  if (seen.has(normalized)) continue
  seen.add(normalized)
  environment[name] = value
}
const out = fs.openSync(stdout, 'a')
const err = fs.openSync(stderr, 'a')
const report = value => {
  const temporary = `${pidFile}.${process.pid}.tmp`
  fs.writeFileSync(temporary, JSON.stringify(value), 'utf8')
  fs.renameSync(temporary, pidFile)
}
const child = spawn(process.execPath, [vite, '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd, env: environment, stdio: ['ignore', out, err], detached: true, windowsHide: true,
})
child.once('error', error => {
  fs.writeSync(err, `${error.stack || error.message}\n`)
  report({ error: error.message })
})
child.once('spawn', () => {
  report({ pid: child.pid })
  child.unref()
})
