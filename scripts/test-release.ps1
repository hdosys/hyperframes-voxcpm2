#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Archive,
    [string]$ExpectedDownstreamCommit = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$root = Get-CoreRepositoryRoot
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
            'engine/audio/scripts/lib/supertonic.mjs', 'engine/audio/scripts/lib/supertonic-runner.py',
            'engine/audio/scripts/versions.json', 'versions.json', 'requirements.txt', 'bin/download-supertonic.py',
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
    if ($null -eq $manifest.downstream -or
        [string]$manifest.downstream.repository -cne 'https://github.com/hdosys/hyperframes-voxcpm2.git' -or
        [string]$manifest.downstream.commit -notmatch '^[0-9a-f]{40}$' -or
        $manifest.downstream.dirty -isnot [bool]) {
        throw 'Release manifest downstream identity is invalid.'
    }
    $patchRecords = @($manifest.downstream.patches)
    $sourcePatches = @(Get-ChildItem -LiteralPath (Join-Path $root 'patches') -File -Filter '*.patch' | Sort-Object Name)
    if ($patchRecords.Count -ne $sourcePatches.Count) {
        throw 'Release manifest does not identify every downstream patch.'
    }
    foreach ($sourcePatch in $sourcePatches) {
        $relative = "patches/$($sourcePatch.Name)"
        $matchingRecords = @($patchRecords | Where-Object { [string]$_.path -ceq $relative })
        if ($matchingRecords.Count -ne 1 -or [string]$matchingRecords[0].target -notmatch '^(runtime|hyperframes)$' -or
            [string]$matchingRecords[0].sha256 -notmatch '^[0-9a-f]{64}$' -or
            [string]$matchingRecords[0].sha256 -cne (Get-FileHash -LiteralPath $sourcePatch.FullName -Algorithm SHA256).Hash.ToLowerInvariant()) {
            throw "Release manifest patch identity mismatch: $relative"
        }
    }
    if (-not [string]::IsNullOrWhiteSpace($ExpectedDownstreamCommit) -and
        ([string]$manifest.downstream.commit -cne $ExpectedDownstreamCommit -or [bool]$manifest.downstream.dirty)) {
        throw 'Release archive was not built from the expected clean downstream commit.'
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
