param(
    [switch]$NoFrontend,
    [switch]$OpenDocs,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RootDir 'backend'
$FrontendDir = Join-Path $RootDir 'frontend'
$EnvFile = Join-Path $BackendDir '.env'
$EnvExampleFile = Join-Path $BackendDir '.env.example'
$VenvDir = Join-Path $BackendDir '.venv'
$VenvPython = Join-Path $VenvDir 'Scripts\python.exe'
$RequirementsFile = Join-Path $BackendDir 'requirements.txt'
$HealthUrl = 'http://127.0.0.1:8000/api/v1/health'
$DocsUrl = 'http://127.0.0.1:8000/docs'

function Write-Step([string]$Tag, [string]$Message, [ConsoleColor]$Color = [ConsoleColor]::Cyan) {
    Write-Host "[$Tag] " -ForegroundColor $Color -NoNewline
    Write-Host $Message
}

function Test-BackendHealth {
    try {
        $resp = Invoke-RestMethod -Uri $HealthUrl -Method Get -TimeoutSec 2 -ErrorAction Stop
        return ($resp.status -eq 'ok')
    } catch {
        return $false
    }
}

function Test-PortListening([int]$Port) {
    try {
        $conn = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        return ($null -ne $conn)
    } catch {
        return $false
    }
}

function Find-HBuilderX {
    if ($env:HBUILDERX_PATH -and (Test-Path $env:HBUILDERX_PATH)) {
        return $env:HBUILDERX_PATH
    }

    $candidates = @(
        'D:\HBuilderX\HBuilderX.exe',
        'C:\HBuilderX\HBuilderX.exe',
        'E:\HBuilderX\HBuilderX.exe',
        'F:\HBuilderX\HBuilderX.exe',
        'C:\Program Files\HBuilderX\HBuilderX.exe',
        'C:\Program Files (x86)\HBuilderX\HBuilderX.exe',
        (Join-Path $env:LOCALAPPDATA 'Programs\HBuilderX\HBuilderX.exe')
    )
    foreach ($p in $candidates) {
        if ($p -and (Test-Path $p)) {
            return $p
        }
    }

    $shortcuts = @(
        (Join-Path $env:USERPROFILE 'Desktop\HBuilder X.lnk'),
        (Join-Path $env:USERPROFILE 'Desktop\HBuilderX.lnk'),
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\HBuilderX\HBuilderX.lnk'),
        (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\HBuilder X.lnk')
    )
    foreach ($lnkPath in $shortcuts) {
        if (Test-Path $lnkPath) {
            try {
                $shell = New-Object -ComObject WScript.Shell
                $target = $shell.CreateShortcut($lnkPath).TargetPath
                if ($target -and (Test-Path $target)) {
                    return $target
                }
            } catch {
            }
        }
    }
    return $null
}

Write-Host ''
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host '   棋逢嘴手 · TrashTalk Chess 一键启动器' -ForegroundColor White
Write-Host '============================================================' -ForegroundColor DarkCyan
Write-Host ''

# 1. 检查并初始化 backend\.env
if (-not (Test-Path $EnvFile)) {
    if (Test-Path $EnvExampleFile) {
        Copy-Item -Path $EnvExampleFile -Destination $EnvFile
        Write-Step '配置' '已从 backend\.env.example 自动创建 backend\.env（如需使用服务端默认大模型，请填入对应 API Key；也可直接在前端设置中填写 BYOK 密钥）。' ([ConsoleColor]::Yellow)
    } else {
        Write-Step '警告' '未找到 backend\.env 与 .env.example，后端将使用默认空配置启动。' ([ConsoleColor]::Yellow)
    }
} else {
    Write-Step '配置' '已检测到 backend\.env。' ([ConsoleColor]::Green)
}

# 2. 检查或创建 Python 虚拟环境并安装依赖
if (-not (Test-Path $VenvPython)) {
    Write-Step '环境' '未检测到 backend\.venv，正在创建虚拟环境并安装依赖...' ([ConsoleColor]::Yellow)
    $sysPython = Get-Command python -ErrorAction SilentlyContinue
    if (-not $sysPython) {
        throw '未找到系统 python 命令，请先安装 Python 3.11+ 并添加到 PATH。'
    }
    & $sysPython.Source -m venv $VenvDir
    if ($LASTEXITCODE -ne 0) {
        throw '创建 Python 虚拟环境失败。'
    }
    & $VenvPython -m pip install --upgrade pip
    & $VenvPython -m pip install -r $RequirementsFile
    if ($LASTEXITCODE -ne 0) {
        throw '安装后端依赖失败，请检查网络连接或 requirements.txt。'
    }
    Write-Step '环境' '后端虚拟环境与依赖安装完成。' ([ConsoleColor]::Green)
} else {
    Write-Step '环境' '已检测到 backend\.venv 虚拟环境。' ([ConsoleColor]::Green)
}

# 3. 启动 FastAPI 后端
if (Test-BackendHealth) {
    Write-Step '后端' 'FastAPI 后端已在运行中 (http://127.0.0.1:8000)。' ([ConsoleColor]::Green)
} elseif (Test-PortListening -Port 8000) {
    throw '端口 8000 已被其他程序占用，但健康检查未通过，请释放 8000 端口后重试。'
} else {
    Write-Step '后端' '正在新窗口启动 FastAPI 后端 (http://127.0.0.1:8000)...' ([ConsoleColor]::Cyan)
    $backendCmd = "`$Host.UI.RawUI.WindowTitle = 'TrashTalk Chess Backend (8000)'; Set-Location -LiteralPath '$($BackendDir.Replace("'", "''"))'; & '$($VenvPython.Replace("'", "''"))' -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload"
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $backendCmd) | Out-Null

    $ready = $false
    for ($i = 0; $i -lt 30; $i++) {
        Start-Sleep -Milliseconds 500
        if (Test-BackendHealth) {
            $ready = $true
            break
        }
    }

    if ($ready) {
        Write-Step '后端' '后端服务启动成功，健康检查通过！' ([ConsoleColor]::Green)
    } else {
        Write-Step '警告' '后端进程已拉起，但 15 秒内健康检查尚未就绪，请查看弹出的后端终端窗口输出。' ([ConsoleColor]::Yellow)
    }
}

if ($OpenDocs) {
    Start-Process $DocsUrl | Out-Null
}

# 4. 检测并拉起前端 (HBuilderX / 已编译 H5)
$h5DevIndex = Join-Path $FrontendDir 'unpackage\dist\dev\h5\index.html'
$h5BuildIndex = Join-Path $FrontendDir 'unpackage\dist\build\h5\index.html'
$hbxExe = Find-HBuilderX

if (-not $NoFrontend) {
    if ($hbxExe) {
        Write-Step '前端' "已检测到 HBuilderX ($hbxExe)，正在打开 frontend 项目..." ([ConsoleColor]::Cyan)
        Start-Process -FilePath $hbxExe -ArgumentList "`"$FrontendDir`"" | Out-Null
        Write-Step '提示' '在 HBuilderX 中点击顶部「运行 -> 运行到浏览器 -> Chrome」或「运行到小程序模拟器」即可进入对局。' ([ConsoleColor]::White)
    } elseif ((Test-Path $h5DevIndex) -or (Test-Path $h5BuildIndex)) {
        $h5Dir = if (Test-Path $h5DevIndex) { Split-Path $h5DevIndex } else { Split-Path $h5BuildIndex }
        if (-not (Test-PortListening -Port 5173)) {
            Write-Step '前端' '未检测到 HBuilderX，正在使用已构建的 H5 静态资源启动本地预览 (http://127.0.0.1:5173)...' ([ConsoleColor]::Cyan)
            $feCmd = "`$Host.UI.RawUI.WindowTitle = 'TrashTalk Chess Frontend (5173)'; Set-Location -LiteralPath '$($h5Dir.Replace("'", "''"))'; & '$($VenvPython.Replace("'", "''"))' -m http.server 5173 --bind 127.0.0.1"
            Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $feCmd) | Out-Null
        }
        Start-Process 'http://127.0.0.1:5173' | Out-Null
    } else {
        Write-Step '前端' '未自动检测到 HBuilderX。请安装并打开 HBuilderX，导入 frontend\ 目录后点击「运行 -> 运行到浏览器」即可。' ([ConsoleColor]::Yellow)
    }
}

Write-Host ''
Write-Host '------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host "  后端接口地址 : http://127.0.0.1:8000/api/v1" -ForegroundColor Green
Write-Host "  Swagger 文档 : $DocsUrl" -ForegroundColor Green
Write-Host "  前端项目目录 : $FrontendDir" -ForegroundColor Cyan
Write-Host "  停止后台服务 : 双击运行根目录下的 停止服务.bat，或直接关闭后端终端窗口" -ForegroundColor Gray
Write-Host '------------------------------------------------------------' -ForegroundColor DarkGray
Write-Host ''

if (-not $NoPause) {
    Write-Host '按任意键关闭此引导窗口（后端服务窗口会继续保持运行）...' -ForegroundColor DarkGray
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
}
