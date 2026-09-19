#requires -Version 7.0
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$root = Get-CoreRepositoryRoot
$versions = Get-CoreVersions
$package = [IO.File]::ReadAllText((Join-Path $root 'package.json')) | ConvertFrom-Json
if ([int]$versions.schemaVersion -ne 1 -or [string]$package.version -cne [string]$versions.releaseVersion) {
    throw 'package.json and versions.json do not describe the same release.'
}
Invoke-CoreNative -Role 'provider syntax check' -FilePath 'node.exe' `
    -ProcessArguments @('--check', (Join-Path $root 'src\voxcpm2.mjs')) -WorkingDirectory $root -TimeoutSeconds 30 | Out-Null

$stage = New-CoreTemporaryDirectory
try {
    $source = Join-Path $stage 'h'
    Invoke-CoreNative -Role 'HyperFrames patch fixture clone' -FilePath 'git.exe' `
        -ProcessArguments @('clone', '--branch', [string]$versions.hyperframes.tag, '--depth', '1',
            '--filter=blob:none', '--sparse', '--config', 'core.longpaths=true',
            [string]$versions.hyperframes.repository, $source) `
        -WorkingDirectory $stage -TimeoutSeconds 300 | Out-Null
    Invoke-CoreNative -Role 'HyperFrames patch fixture checkout' -FilePath 'git.exe' `
        -ProcessArguments @('-C', $source, 'sparse-checkout', 'set', 'skills/media-use/audio') `
        -WorkingDirectory $stage -TimeoutSeconds 300 | Out-Null
    $commit = (Invoke-CoreNative -Role 'HyperFrames patch fixture identity' -FilePath 'git.exe' `
            -ProcessArguments @('-C', $source, 'rev-parse', 'HEAD') `
            -WorkingDirectory $stage -TimeoutSeconds 30 | Select-Object -Last 1).Trim()
    if ($commit -cne [string]$versions.hyperframes.commit) {
        throw "Unexpected HyperFrames patch fixture commit: $commit"
    }
    $patch = Join-Path $root 'patches\hyperframes-voxcpm2.patch'
    Invoke-CoreNative -Role 'HyperFrames integration patch check' -FilePath 'git.exe' `
        -ProcessArguments @('-C', $source, 'apply', '--check', '--whitespace=error-all', $patch) `
        -WorkingDirectory $stage -TimeoutSeconds 30 | Out-Null
    Invoke-CoreNative -Role 'HyperFrames integration patch application' -FilePath 'git.exe' `
        -ProcessArguments @('-C', $source, 'apply', '--whitespace=error-all', $patch) `
        -WorkingDirectory $stage -TimeoutSeconds 30 | Out-Null
    Copy-Item -LiteralPath (Join-Path $root 'src\voxcpm2.mjs') `
        -Destination (Join-Path $source 'skills\media-use\audio\scripts\lib\voxcpm2.mjs')
    Copy-Item -LiteralPath (Join-Path $root 'src\voxcpm2-cli.mjs') `
        -Destination (Join-Path $source 'skills\media-use\audio\scripts\lib\voxcpm2-cli.mjs')
    Copy-Item -LiteralPath (Join-Path $root 'src\supertonic.mjs') `
        -Destination (Join-Path $source 'skills\media-use\audio\scripts\lib\supertonic.mjs')
    Copy-Item -LiteralPath (Join-Path $root 'src\qwen3.mjs') `
        -Destination (Join-Path $source 'skills\media-use\audio\scripts\lib\qwen3.mjs')
    Copy-Item -LiteralPath (Join-Path $root 'versions.json') `
        -Destination (Join-Path $source 'skills\media-use\audio\scripts\versions.json')
    foreach ($file in @(
            (Join-Path $source 'skills\media-use\audio\scripts\audio.mjs'),
            (Join-Path $source 'skills\media-use\audio\scripts\lib\tts.mjs'),
            (Join-Path $source 'skills\media-use\audio\scripts\lib\voxcpm2.mjs'),
            (Join-Path $source 'skills\media-use\audio\scripts\lib\voxcpm2-cli.mjs'),
            (Join-Path $source 'skills\media-use\audio\scripts\lib\supertonic.mjs'),
            (Join-Path $source 'skills\media-use\audio\scripts\lib\qwen3.mjs')
        )) {
        Invoke-CoreNative -Role "syntax check $([IO.Path]::GetFileName($file))" -FilePath 'node.exe' `
            -ProcessArguments @('--check', $file) -WorkingDirectory $source -TimeoutSeconds 30 | Out-Null
    }

    $runtimeSource = Join-Path $stage 'r'
    Invoke-CoreNative -Role 'llama.cpp-omni patch fixture clone' -FilePath 'git.exe' `
        -ProcessArguments @('clone', '--branch', [string]$versions.runtime.ref, '--depth', '1',
            '--config', 'core.longpaths=true', [string]$versions.runtime.repository, $runtimeSource) `
        -WorkingDirectory $stage -TimeoutSeconds 300 | Out-Null
    $runtimeCommit = (Invoke-CoreNative -Role 'llama.cpp-omni patch fixture identity' -FilePath 'git.exe' `
            -ProcessArguments @('-C', $runtimeSource, 'rev-parse', 'HEAD') `
            -WorkingDirectory $stage -TimeoutSeconds 30 | Select-Object -Last 1).Trim()
    if ($runtimeCommit -cne [string]$versions.runtime.commit) {
        throw "Unexpected llama.cpp-omni patch fixture commit: $runtimeCommit"
    }
    $runtimePatch = Join-Path $root "patches\llama.cpp-omni-$($versions.runtime.ref)-threads.patch"
    Invoke-CoreNative -Role 'llama.cpp-omni integration patch check' -FilePath 'git.exe' `
        -ProcessArguments @('-C', $runtimeSource, 'apply', '--check', '--whitespace=error-all', $runtimePatch) `
        -WorkingDirectory $stage -TimeoutSeconds 30 | Out-Null
} finally {
    Remove-CoreTemporaryDirectory -Path $stage
}
Write-Host 'Source contract verified.'
