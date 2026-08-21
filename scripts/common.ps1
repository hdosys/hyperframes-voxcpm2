Set-StrictMode -Version Latest

function Invoke-CoreNative {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Role,
        [Parameter(Mandatory = $true)]
        [string]$FilePath,
        [Parameter(Mandatory = $true)]
        [AllowEmptyCollection()]
        [string[]]$ProcessArguments,
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [ValidateRange(1, 3600)]
        [int]$TimeoutSeconds = 600
    )

    $command = Get-Command $FilePath -CommandType Application -ErrorAction Stop | Select-Object -First 1
    if (-not (Test-Path -LiteralPath $WorkingDirectory -PathType Container)) {
        throw "$Role working directory does not exist: $WorkingDirectory"
    }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = [string]$command.Source
    $info.WorkingDirectory = [IO.Path]::GetFullPath($WorkingDirectory)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.WindowStyle = [Diagnostics.ProcessWindowStyle]::Hidden
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in $ProcessArguments) {
        $info.ArgumentList.Add([string]$argument)
    }

    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    try {
        if (-not $process.Start()) { throw "$Role did not start." }
        $stdoutTask = $process.StandardOutput.ReadToEndAsync()
        $stderrTask = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            try { $process.Kill($true) } catch {}
            throw "$Role exceeded $TimeoutSeconds seconds."
        }
        $stdout = $stdoutTask.GetAwaiter().GetResult()
        $stderr = $stderrTask.GetAwaiter().GetResult()
        if (-not [string]::IsNullOrWhiteSpace($stdout)) { Write-Host $stdout.TrimEnd() }
        if (-not [string]::IsNullOrWhiteSpace($stderr)) { Write-Host $stderr.TrimEnd() }
        if ($process.ExitCode -ne 0) {
            $details = ($stdout + [Environment]::NewLine + $stderr).Trim()
            if ($details.Length -gt 4000) { $details = $details.Substring($details.Length - 4000) }
            throw "$Role failed with exit code $($process.ExitCode). $details"
        }
        return @((($stdout + [Environment]::NewLine + $stderr).Trim()) -split "`r?`n" |
                Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
    } finally {
        $stopwatch.Stop()
        $process.Dispose()
        Write-Host ("TIMING {0}: {1:N3} s" -f $Role, $stopwatch.Elapsed.TotalSeconds)
    }
}

function Get-CoreRepositoryRoot {
    return [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
}

function Get-CoreVersions {
    $path = Join-Path (Get-CoreRepositoryRoot) 'versions.json'
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        throw "versions.json is missing: $path"
    }
    return [IO.File]::ReadAllText($path) | ConvertFrom-Json
}

function New-CoreTemporaryDirectory {
    param([string]$Prefix = 'hfv2')

    $parent = if (-not [string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
        [IO.Path]::GetFullPath($env:RUNNER_TEMP)
    } else {
        [IO.Path]::GetPathRoot((Get-CoreRepositoryRoot))
    }
    if (-not (Test-Path -LiteralPath $parent -PathType Container)) {
        throw "Temporary parent does not exist: $parent"
    }
    $name = $Prefix + '-' + [Guid]::NewGuid().ToString('N').Substring(0, 8)
    $path = Join-Path $parent $name
    New-Item -ItemType Directory -Path $path | Out-Null
    return $path
}

function Remove-CoreTemporaryDirectory {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) { return }
    $full = [IO.Path]::GetFullPath($Path)
    $root = [IO.Path]::GetPathRoot($full)
    if ($full -eq $root -or [IO.Path]::GetFileName($full) -notmatch '^hfv2-[0-9a-f]{8}$') {
        throw "Refusing to remove an unrecognized temporary path: $full"
    }
    Remove-Item -LiteralPath $full -Recurse -Force
}
