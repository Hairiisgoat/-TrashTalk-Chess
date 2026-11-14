param(
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

function Get-PortPids([int[]]$Ports) {
    $pids = @()
    foreach ($port in $Ports) {
        $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        foreach ($c in $conns) {
            if ($c.OwningProcess -gt 0) {
                $pids += [int]$c.OwningProcess
            }
        }
    }
    return ($pids | Select-Object -Unique)
}

function Stop-ProjectProcesses {
    $allProcs = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
    $port8000Pids = Get-PortPids -Ports @(8000, 5173)

    $targets = $allProcs | Where-Object {
        if ($_.ProcessId -eq $PID) { return $false }
        $cmd = $_.CommandLine
        $exe = $_.ExecutablePath
        $isProjectCmd = $false
        if ($cmd) {
            $isProjectCmd = ($cmd -match 'uvicorn' -and $cmd -match 'app\.main:app') -or
                            ($cmd -match 'TrashTalk Chess Backend \(8000\)') -or
                            ($cmd -match 'http\.server\s+5173') -or
                            ($cmd -match 'TrashTalk Chess Frontend \(5173\)')
        }
        $isProjectPortOwner = ($port8000Pids -contains [int]$_.ProcessId) -and $exe -and ($exe.StartsWith($RootDir, [System.StringComparison]::OrdinalIgnoreCase))
        return ($isProjectCmd -or $isProjectPortOwner)
    }

    $stopped = 0
    foreach ($proc in $targets) {
        try {
            $null = & taskkill /PID $proc.ProcessId /T /F 2>$null
            if ($LASTEXITCODE -eq 0) {
                Write-Host "[已停止] PID=$($proc.ProcessId) ($($proc.Name)) 及其子进程" -ForegroundColor Green
                $stopped++
            }
        } catch {
        }
    }

    for ($i = 0; $i -lt 10; $i++) {
        if ((Get-PortPids -Ports @(8000)).Count -eq 0) { break }
        Start-Sleep -Milliseconds 300
    }

    if ($stopped -eq 0) {
        Write-Host '[提示] 未检测到正在运行的 TrashTalk Chess 后端或静态预览进程。' -ForegroundColor Yellow
    } else {
        Write-Host "[完成] 共清理 $stopped 个主进程。" -ForegroundColor Cyan
    }
}

Write-Host ''
Write-Host '=== 停止 TrashTalk Chess 后台服务 ===' -ForegroundColor DarkCyan
Stop-ProjectProcesses
Write-Host ''

if (-not $NoPause) {
    Write-Host '按任意键退出...' -ForegroundColor DarkGray
    $null = $Host.UI.RawUI.ReadKey('NoEcho,IncludeKeyDown')
}
