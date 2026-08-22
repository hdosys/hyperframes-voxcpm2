#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Archive
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$Archive = [IO.Path]::GetFullPath($Archive)
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) { throw "Release archive is missing: $Archive" }
$sidecar = "$Archive.sha256"
if (-not (Test-Path -LiteralPath $sidecar -PathType Leaf)) { throw "Release sidecar is missing: $sidecar" }
$expectedHash = ([IO.File]::ReadAllText($sidecar).Trim() -split '\s+')[0].ToLowerInvariant()
$actualHash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualHash -cne $expectedHash) { throw "Release archive SHA-256 mismatch: $actualHash" }

Add-Type -AssemblyName System.IO.Compression
$zip = [IO.Compression.ZipFile]::OpenRead($Archive)
try {
    $names = @($zip.Entries | ForEach-Object { $_.FullName })
    if ($names.Count -ne @($names | Sort-Object -Unique).Count) { throw 'Release archive has duplicate entries.' }
    foreach ($name in $names) {
        if ([string]::IsNullOrWhiteSpace($name) -or $name.Contains('\') -or $name.StartsWith('/') -or
            $name -match '^[A-Za-z]:' -or @($name -split '/' | Where-Object { $_ -eq '.' -or $_ -eq '..' }).Count) {
            throw "Release archive entry is unsafe: $name"
        }
    }
    foreach ($required in @(
            'manifest.json', 'bin/tts.ps1', 'engine/audio/scripts/audio.mjs',
            'engine/audio/scripts/lib/tts.mjs', 'engine/audio/scripts/lib/voxcpm2.mjs',
            'engine/audio/scripts/lib/voxcpm2-cli.mjs', 'runtime/cpu/llama-tts-server.exe',
            'reference/herdr-narrator-de.wav',
            'licenses/HyperFrames-APACHE-2.0.txt', 'licenses/llama.cpp-omni-MIT.txt'
        )) {
        if ($required -notin $names) { throw "Release archive entry is missing: $required" }
    }
    if (@($names | Where-Object { $_ -match '(?i)(^|/)vulkan(/|$)' }).Count -ne 0) {
        throw 'Release archive contains a forbidden Vulkan payload.'
    }
} finally {
    $zip.Dispose()
}

$stage = New-CoreTemporaryDirectory
try {
    [IO.Compression.ZipFile]::ExtractToDirectory($Archive, $stage)
    $manifest = [IO.File]::ReadAllText((Join-Path $stage 'manifest.json')) | ConvertFrom-Json
    if ([int]$manifest.schemaVersion -ne 1 -or [string]$manifest.platform -cne 'windows-x64') {
        throw 'Release manifest identity is invalid.'
    }
    foreach ($record in @($manifest.files)) {
        $path = Join-Path $stage ([string]$record.path).Replace('/', '\')
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Manifest file is missing: $($record.path)" }
        $item = Get-Item -LiteralPath $path -Force
        if ($item.Length -ne [long]$record.size -or
            (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne [string]$record.sha256) {
            throw "Manifest file identity mismatch: $($record.path)"
        }
    }
    foreach ($file in @(
            (Join-Path $stage 'engine\audio\scripts\audio.mjs'),
            (Join-Path $stage 'engine\audio\scripts\lib\tts.mjs'),
            (Join-Path $stage 'engine\audio\scripts\lib\voxcpm2.mjs'),
            (Join-Path $stage 'engine\audio\scripts\lib\voxcpm2-cli.mjs')
        )) {
        Invoke-CoreNative -Role "release syntax check $([IO.Path]::GetFileName($file))" -FilePath 'node.exe' `
            -ProcessArguments @('--check', $file) -WorkingDirectory $stage -TimeoutSeconds 30 | Out-Null
    }
    $server = Join-Path $stage 'runtime\cpu\llama-tts-server.exe'
    $identity = (Invoke-CoreNative -Role 'release CPU server identity' -FilePath $server `
            -ProcessArguments @('--version') -WorkingDirectory $stage -TimeoutSeconds 30) -join "`n"
    if ($identity -notmatch [regex]::Escape(([string]$manifest.runtime.commit).Substring(0, 7))) {
        throw "Release CPU server does not report the pinned runtime commit: $server"
    }
    $help = (Invoke-CoreNative -Role 'release VoxCPM2 CLI help' -FilePath 'pwsh.exe' `
            -ProcessArguments @('-NoProfile', '-File', (Join-Path $stage 'bin\tts.ps1'), '--help') `
            -WorkingDirectory $stage -TimeoutSeconds 30) -join "`n"
    if ($help -notmatch '(?m)^  tts\.ps1 --text ' -or $help -match '(?i)voxcpm2\.ps1') {
        throw 'Release VoxCPM2 CLI help does not expose the canonical tts.ps1 command.'
    }
} finally {
    Remove-CoreTemporaryDirectory -Path $stage
}
Write-Host "Release verified: $Archive ($actualHash)"
