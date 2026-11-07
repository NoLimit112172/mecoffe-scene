# 本地一键启动：验证解释器、生成数据、确认服务就绪，再打开中科大三维历史回放。
param(
    [switch]$NoBrowser,
    [switch]$Rebuild,
    [ValidateRange(1024, 65535)][int]$Port = 5180
)
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath($PSScriptRoot)
$Frontend = Join-Path $Root 'frontend'
$Logs = Join-Path $Root 'logs'
$BaseUrl = "http://127.0.0.1:$Port"
$Url = "$BaseUrl/mecoffe3d?scenario=ustc-history"
$Scene = Join-Path $Frontend 'public\mecoffe\scene.json'
$DemoPath = Join-Path $Frontend 'public\mecoffe\latest-demo.json'
$NetworkPath = Join-Path $Frontend 'public\mecoffe\latest-network.json'
$SnapshotPath = Join-Path $Root 'data\source\population_snapshot.latest.json'
$RuntimePath = Join-Path $Frontend 'public\mecoffe\runtime-local.json'

function Get-TextHash([string]$Text) {
    $digest = [Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($digest.ComputeHash([Text.Encoding]::UTF8.GetBytes($Text)))).Replace('-', '').ToLowerInvariant() }
    finally { $digest.Dispose() }
}

function Get-FileSha256([string]$Path) {
    $digest = [Security.Cryptography.SHA256]::Create()
    $stream = [IO.File]::OpenRead($Path)
    try { return ([BitConverter]::ToString($digest.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
    finally { $stream.Dispose(); $digest.Dispose() }
}

function Publish-GeneratedFile([string]$Prepared, [string]$Destination) {
    if (Test-Path -LiteralPath $Destination) {
        if ((Get-FileSha256 $Prepared) -eq (Get-FileSha256 $Destination)) {
            Write-Host "内容未变，保留现有文件：$Destination"
            return
        }
        # 同目录原子替换；若目标被占用而禁止替换，报错并保留旧文件。
        [IO.File]::Replace($Prepared, $Destination, [NullString]::Value)
    } else {
        [IO.File]::Move($Prepared, $Destination)
    }
}

function Invoke-DataAdapter([string]$Python, [string]$Adapter, [string]$Destination) {
    # 仍完整生成和校验；相同内容不触发替换或 Vite 热更新。
    $prepared = "$Destination.$([Guid]::NewGuid().ToString('N')).prepared.tmp"
    try {
        & $Python -X utf8 (Join-Path $Root $Adapter) --output $prepared
        if ($LASTEXITCODE -ne 0) { throw "数据生成失败：$Adapter。请查看上面的适配器错误。" }
        Publish-GeneratedFile $prepared $Destination
    } finally {
        if (Test-Path -LiteralPath $prepared) { Remove-Item -LiteralPath $prepared -Force }
    }
}

function Find-Node {
    $candidates = @((Get-Command node -All -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object Source))
    if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'nodejs\node.exe' }
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        if (-not $candidate -or -not (Test-Path -LiteralPath $candidate)) { continue }
        try {
            $version = (& $candidate --version 2>$null | Out-String).Trim()
            if ($LASTEXITCODE -eq 0 -and $version -match '^v(\d+)\.' -and [int]$Matches[1] -ge 18) {
                Write-Host "Node.js $version：$candidate"
                return $candidate
            }
        } catch { }
    }
    throw '没有找到可运行的 Node.js 18+。请安装 Node.js 后重新打开 VS Code。'
}

function Find-Python {
    $candidates = @(
        (Join-Path $Root '.venv\Scripts\python.exe'),
        (Join-Path $Root 'backend\.venv\Scripts\python.exe')
    )
    $candidates += @(Get-Command python, python3, py -All -CommandType Application -ErrorAction SilentlyContinue | ForEach-Object Source)
    if ($env:LOCALAPPDATA) {
        $pythonDirectory = Join-Path $env:LOCALAPPDATA 'Programs\Python'
        if (Test-Path -LiteralPath $pythonDirectory) {
            $candidates += @(Get-ChildItem -LiteralPath $pythonDirectory -Directory | Sort-Object Name -Descending | ForEach-Object { Join-Path $_.FullName 'python.exe' })
        }
    }
    $probe = 'import sys,json,hashlib,pathlib,tempfile,decimal,collections; print(json.dumps(dict(executable=sys.executable,version=list(sys.version_info[:3]))))'
    foreach ($candidate in ($candidates | Select-Object -Unique)) {
        # Windows Store 占位程序会弹商店，不能作为有效的 Python。
        if (-not $candidate -or $candidate -match '\\WindowsApps\\' -or -not (Test-Path -LiteralPath $candidate)) { continue }
        try {
            $prefix = @()
            if ([IO.Path]::GetFileName($candidate) -ieq 'py.exe') { $prefix = @('-3') }
            $result = & $candidate @prefix -c $probe 2>$null
            if ($LASTEXITCODE -ne 0) { continue }
            $info = ($result | Out-String) | ConvertFrom-Json
            if ([int]$info.version[0] -eq 3 -and [int]$info.version[1] -ge 9 -and (Test-Path -LiteralPath $info.executable)) {
                Write-Host "Python $($info.version -join '.')：$($info.executable)"
                return [string]$info.executable
            }
        } catch { }
    }
    throw '没有找到可运行且标准库完整的 Python 3.9+。请安装 Python 并重新打开 VS Code；不要使用 Windows Store 占位程序。'
}

function Test-PortBusy {
    $client = New-Object Net.Sockets.TcpClient
    try { return ($client.ConnectAsync('127.0.0.1', $Port).Wait(400) -and $client.Connected) }
    catch { return $false }
    finally { $client.Dispose() }
}

function Read-JsonFile([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path)) { throw "缺少文件：$Path" }
    try { return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json }
    catch { throw "JSON 文件无法读取：$Path。$($_.Exception.Message)" }
}

function Assert-GeneratedData {
    $snapshot = Read-JsonFile $SnapshotPath
    $network = Read-JsonFile $NetworkPath
    $demo = Read-JsonFile $DemoPath
    $script:ExpectedPeople = @($snapshot.nodes).Count
    $script:ExpectedRelationships = @($snapshot.edges).Count
    $script:SnapshotHash = Get-FileSha256 $SnapshotPath
    if ($network.schema -ne 'mecoffe.scene.v1' -or $network.meta.mode -ne 'network_snapshot' -or
        $demo.schema -ne 'mecoffe.scene.v1' -or $demo.meta.mode -ne 'network_demo' -or $demo.meta.illustrative -ne $true) {
        throw '生成的数据类型不正确，未启动浏览器。请查看适配器输出。'
    }
    foreach ($data in @($network, $demo)) {
        if (@($data.people).Count -ne $script:ExpectedPeople -or @($data.relationships).Count -ne $script:ExpectedRelationships -or
            $data.meta.snapshot_id -ne $snapshot.snapshot_id -or $data.meta.snapshot_revision -ne $snapshot.snapshot_revision -or
            $data.meta.sources.snapshot_sha256 -ne $script:SnapshotHash) {
            throw '生成数据与最新人物快照不一致，未启动浏览器。'
        }
    }
    if (@($demo.events).Count -eq 0 -or @($demo.days).Count -eq 0) { throw '动态演示没有可播放的事件或日期。' }
    $script:WorkspaceId = Get-TextHash $Root.ToLowerInvariant()
    $runtime = @{ schema = 'mecoffe.local-runtime.v1'; workspace_id = $script:WorkspaceId; entry = '/mecoffe'; demo_sha256 = (Get-FileSha256 $DemoPath) }
    # 本机身份文件由 .gitignore 排除，不记录本机绝对路径或凭据。
    $temporary = "$RuntimePath.$PID.tmp"
    [IO.File]::WriteAllText($temporary, ($runtime | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $RuntimePath -Force
    Write-Host "新版演示校验通过：$script:ExpectedPeople 人、$script:ExpectedRelationships 条关系、$(@($demo.days).Count) 个演示日。"
}

function Test-OurServer {
    try {
        $runtime = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/mecoffe/runtime-local.json" -TimeoutSec 2
        if ($runtime.schema -ne 'mecoffe.local-runtime.v1' -or $runtime.workspace_id -ne $script:WorkspaceId) { return $false }
        $module = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/src/views/MeCoffeScene.vue" -TimeoutSec 2
        if ($module.StatusCode -ne 200 -or $module.Content -notmatch 'network_demo' -or $module.Content.TrimStart().StartsWith('<!DOCTYPE', [StringComparison]::OrdinalIgnoreCase)) { return $false }
        $demo = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/mecoffe/latest-demo.json" -TimeoutSec 3
        return ($demo.meta.mode -eq 'network_demo' -and $demo.meta.sources.snapshot_sha256 -eq $script:SnapshotHash -and
            @($demo.people).Count -eq $script:ExpectedPeople -and @($demo.relationships).Count -eq $script:ExpectedRelationships)
    } catch { return $false }
}

function Write-LogTail([string]$Path) {
    if ($Path -and (Test-Path -LiteralPath $Path)) { Get-Content -LiteralPath $Path -Tail 12 | ForEach-Object { Write-Host $_ } }
}

function Start-ViteBackground([string]$Node, [string]$Vite, [string]$OutPath, [string]$ErrorPath, [string]$Stamp) {
    try {
        $process = Start-Process -FilePath $Node -ArgumentList @(('"' + $Vite + '"'), '--host', '127.0.0.1', '--port', [string]$Port, '--strictPort') -WorkingDirectory $Frontend -WindowStyle Hidden -RedirectStandardOutput $OutPath -RedirectStandardError $ErrorPath -PassThru
        return $process
    } catch {
        # 某些 VS Code 环境同时含 Path/PATH；.NET Framework 构建环境字典时会拒绝重复键。
        # 使用 WMI 启动隐藏 Node bootstrap，不继承该损坏环境块，不改系统或用户环境变量。
        if ($_.Exception.Message -notmatch '(?i)already.*added|same key|key.*dictionary|重复|已经添加') { throw }
        Write-Host '检测到父进程环境重复键，改用隐藏的兼容启动方式。'
        $helper = Join-Path $Root 'scripts\start-vite.cjs'
        if (-not (Test-Path -LiteralPath $helper)) { throw '缺少兼容启动脚本 scripts/start-vite.cjs。' }
        $requestPath = Join-Path $Logs "launch-$Port-$Stamp.json"
        $pidPath = Join-Path $Logs "launch-$Port-$Stamp.pid.json"
        $request = @{ cwd = $Frontend; vite = $Vite; port = $Port; stdout = $OutPath; stderr = $ErrorPath; pidFile = $pidPath }
        [IO.File]::WriteAllText($requestPath, ($request | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
        $command = '"' + $Node + '" "' + $helper + '" "' + $requestPath + '"'
        $created = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = $command; CurrentDirectory = $Frontend; ProcessStartupInformation = $startup }
        if ($created.ReturnValue -ne 0) { throw "兼容启动失败（返回码 $($created.ReturnValue)），日志：$ErrorPath" }
        $pidDeadline = (Get-Date).AddSeconds(8)
        while (-not (Test-Path -LiteralPath $pidPath)) {
            if ((Get-Date) -gt $pidDeadline) { throw "兼容启动没有返回进程号，日志：$ErrorPath" }
            Start-Sleep -Milliseconds 100
        }
        $result = Read-JsonFile $pidPath
        if ($result.error) { throw "兼容启动失败：$($result.error)，日志：$ErrorPath" }
        return Get-Process -Id ([int]$result.pid) -ErrorAction Stop
    }
}

$mutex = $null
$locked = $false
$exitCode = 0
try {
    $mutex = New-Object Threading.Mutex($false, ('Local\MeCoffe.Scene.' + (Get-TextHash $Root.ToLowerInvariant()).Substring(0, 20)))
    try { $locked = $mutex.WaitOne(90000) }
    catch [Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) { throw '另一个启动任务仍在执行，请稍后再按 F5。' }

    $node = Find-Node
    $python = Find-Python
    $vite = Join-Path $Frontend 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path -LiteralPath $vite)) {
        $npm = Join-Path (Split-Path $node) 'npm.cmd'
        if (-not (Test-Path -LiteralPath $npm)) { throw '找到了 Node.js，但缺少 npm.cmd。请修复 Node.js 安装。' }
        Write-Host '首次运行：按锁文件安装前端依赖（npm ci）…'
        Push-Location $Frontend
        try {
            & $npm ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw 'npm ci 失败，请检查终端中的网络或依赖错误。' }
        } finally { Pop-Location }
    }
    if (-not (Test-Path -LiteralPath $vite)) { throw '前端依赖安装未完成，缺少 Vite 入口。' }

    if ($Rebuild -or -not (Test-Path -LiteralPath $Scene)) {
        Invoke-DataAdapter $python 'adapter\oasis_to_scene.py' $Scene
    }
    if (-not (Test-Path -LiteralPath $SnapshotPath)) { throw '缺少 data/source/population_snapshot.latest.json，无法生成新版演示。' }
    Invoke-DataAdapter $python 'adapter\snapshot_to_scene.py' $NetworkPath
    Invoke-DataAdapter $python 'adapter\build_demo.py' $DemoPath
    Assert-GeneratedData

    if (Test-PortBusy) {
        if (-not (Test-OurServer)) { throw "端口 $Port 已被其他服务占用，或服务不属于当前项目。未结束任何进程；请关闭冲突服务后重试。" }
        Write-Host "复用已就绪的本项目服务（端口 $Port）。"
    } else {
        New-Item -ItemType Directory -Path $Logs -Force | Out-Null
        $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
        $out = Join-Path $Logs "vite-$Port-$stamp.out.log"
        $err = Join-Path $Logs "vite-$Port-$stamp.err.log"
        # 直接启动 Node，避免 cmd.exe 拼接和重定向转义；与任务终端分离并隐藏窗口。
        $child = Start-ViteBackground $node $vite $out $err $stamp
        $deadline = (Get-Date).AddSeconds(40)
        while (-not (Test-OurServer)) {
            if ($child.HasExited) { Write-LogTail $err; throw "前端服务已退出（$($child.ExitCode)），日志：$err" }
            if ((Get-Date) -gt $deadline) { Write-LogTail $err; throw "前端服务未在 40 秒内就绪，日志：$err" }
            Start-Sleep -Milliseconds 250
        }
        Write-Host "本项目服务已就绪（进程 $($child.Id)），日志：$out"
    }
    Write-Host "已就绪：$BaseUrl"
    Write-Host "中科大三维沙盘 · 历史回放：$Url"
    Write-Host "中科大 GIS · 历史回放：$BaseUrl/mecoffe-gis?scenario=ustc-history"
    Write-Host "三维素材库：$BaseUrl/mecoffe3d/assets"
    Write-Host "NUS 建模预览：$BaseUrl/mecoffe3d?campus=nus"
    Write-Host "旧版二维沙盘：$BaseUrl/mecoffe"
    if (-not $NoBrowser) { Start-Process $Url }
} catch {
    Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    $exitCode = 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    if ($mutex) { $mutex.Dispose() }
}
exit $exitCode
