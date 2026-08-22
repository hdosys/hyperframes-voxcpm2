#requires -Version 7.0
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^\d+\.\d+\.\d+$')]
    [string]$Version,
    [string]$OutputDirectory = '',
    [string]$RuntimeSource = '',
    [string]$CpuServer = ''
)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$repositoryRoot = Get-CoreRepositoryRoot
$versions = Get-CoreVersions
if ([string]$versions.releaseVersion -cne $Version) {
    throw "versions.json declares $($versions.releaseVersion), not $Version"
}
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path $repositoryRoot 'dist'
}
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
if (-not (Test-Path -LiteralPath $OutputDirectory)) {
    New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
}
$stage = New-CoreTemporaryDirectory
try {
    $hyperframesSource = Join-Path $stage 'h'
    Invoke-CoreNative -Role 'HyperFrames source clone' -FilePath 'git.exe' `
        -ProcessArguments @('clone', '--branch', [string]$versions.hyperframes.tag, '--depth', '1',
            '--filter=blob:none', '--sparse', '--config', 'core.longpaths=true',
            [string]$versions.hyperframes.repository, $hyperframesSource) `
        -WorkingDirectory $stage -TimeoutSeconds 300 | Out-Null
    Invoke-CoreNative -Role 'HyperFrames audio sparse checkout' -FilePath 'git.exe' `
        -ProcessArguments @('-C', $hyperframesSource, 'sparse-checkout', 'set', 'skills/media-use/audio') `
        -WorkingDirectory $stage -TimeoutSeconds 300 | Out-Null
    $hyperframesCommit = (Invoke-CoreNative -Role 'HyperFrames source identity' -FilePath 'git.exe' `
            -ProcessArguments @('-C', $hyperframesSource, 'rev-parse', 'HEAD') `
            -WorkingDirectory $stage -TimeoutSeconds 30 | Select-Object -Last 1).Trim()
    if ($hyperframesCommit -cne [string]$versions.hyperframes.commit) {
        throw "Unexpected HyperFrames commit: $hyperframesCommit"
    }

    if ([string]::IsNullOrWhiteSpace($RuntimeSource)) {
        $RuntimeSource = Join-Path $stage 'r'
        Invoke-CoreNative -Role 'llama.cpp-omni source clone' -FilePath 'git.exe' `
            -ProcessArguments @('clone', '--branch', [string]$versions.runtime.ref, '--depth', '1',
                '--config', 'core.longpaths=true', [string]$versions.runtime.repository, $RuntimeSource) `
            -WorkingDirectory $stage -TimeoutSeconds 300 | Out-Null
    } else {
        $RuntimeSource = [IO.Path]::GetFullPath($RuntimeSource)
    }
    $runtimeCommit = (Invoke-CoreNative -Role 'llama.cpp-omni source identity' -FilePath 'git.exe' `
            -ProcessArguments @('-C', $RuntimeSource, 'rev-parse', 'HEAD') `
            -WorkingDirectory $stage -TimeoutSeconds 30 | Select-Object -Last 1).Trim()
    if ($runtimeCommit -cne [string]$versions.runtime.commit) {
        throw "Unexpected llama.cpp-omni commit: $runtimeCommit"
    }

    if ([string]::IsNullOrWhiteSpace($CpuServer)) {
        $cmake = (Get-Command 'cmake.exe' -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
        $common = @(
            '-G', 'Visual Studio 17 2022', '-A', 'x64', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_STATIC=ON',
            '-DGGML_NATIVE=OFF', '-DLLAMA_BUILD_TESTS=OFF', '-DLLAMA_BUILD_EXAMPLES=OFF',
            '-DLLAMA_BUILD_APP=OFF', '-DLLAMA_BUILD_UI=OFF', '-DLLAMA_BUILD_TOOLS=ON',
            '-DLLAMA_BUILD_SERVER=ON', '-DLLAMA_TOOLS_INSTALL=OFF', '-DLLAMA_OPENSSL=OFF'
        )
        $cpuBuild = Join-Path $stage 'c'
        Invoke-CoreNative -Role 'CPU runtime configuration' -FilePath $cmake `
            -ProcessArguments (@('-S', $RuntimeSource, '-B', $cpuBuild) + $common + @('-DGGML_VULKAN=OFF')) `
            -WorkingDirectory $stage -TimeoutSeconds 300 | Out-Null
        Invoke-CoreNative -Role 'CPU runtime build' -FilePath $cmake `
            -ProcessArguments @('--build', $cpuBuild, '--config', 'Release', '--target', 'llama-tts-server', '--parallel', '8') `
            -WorkingDirectory $stage -TimeoutSeconds 1200 | Out-Null
        $CpuServer = Join-Path $cpuBuild 'bin\Release\llama-tts-server.exe'
    }

    $CpuServer = [IO.Path]::GetFullPath($CpuServer)
    if (-not (Test-Path -LiteralPath $CpuServer -PathType Leaf)) {
        throw "CPU server input is missing: $CpuServer"
    }
    $identity = (Invoke-CoreNative -Role 'CPU server identity' -FilePath $CpuServer `
            -ProcessArguments @('--version') -WorkingDirectory $stage -TimeoutSeconds 30) -join "`n"
    if ($identity -notmatch [regex]::Escape(([string]$versions.runtime.commit).Substring(0, 7))) {
        throw 'CPU server did not report the pinned runtime commit.'
    }

    $patch = Join-Path $repositoryRoot "patches\hyperframes-$($versions.hyperframes.version).patch"
    Invoke-CoreNative -Role 'HyperFrames provider patch check' -FilePath 'git.exe' `
        -ProcessArguments @('-C', $hyperframesSource, 'apply', '--check', '--whitespace=error-all', $patch) `
        -WorkingDirectory $stage -TimeoutSeconds 30 | Out-Null
    Invoke-CoreNative -Role 'HyperFrames provider patch application' -FilePath 'git.exe' `
        -ProcessArguments @('-C', $hyperframesSource, 'apply', '--whitespace=error-all', $patch) `
        -WorkingDirectory $stage -TimeoutSeconds 30 | Out-Null
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'src\voxcpm2.mjs') `
        -Destination (Join-Path $hyperframesSource 'skills\media-use\audio\scripts\lib\voxcpm2.mjs')
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'src\voxcpm2-cli.mjs') `
        -Destination (Join-Path $hyperframesSource 'skills\media-use\audio\scripts\lib\voxcpm2-cli.mjs')

    $bundle = Join-Path $stage 'bundle'
    $engine = Join-Path $bundle 'engine'
    $bin = Join-Path $bundle 'bin'
    $runtime = Join-Path $bundle 'runtime'
    $licenses = Join-Path $bundle 'licenses'
    foreach ($directory in @($bundle, $engine, $bin, (Join-Path $runtime 'cpu'), $licenses)) {
        New-Item -ItemType Directory -Path $directory -Force | Out-Null
    }
    Copy-Item -LiteralPath (Join-Path $hyperframesSource 'skills\media-use\audio') -Destination $engine -Recurse
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'src\voxcpm2.ps1') -Destination $bin
    Copy-Item -LiteralPath $CpuServer -Destination (Join-Path $runtime 'cpu\llama-tts-server.exe')
    Copy-Item -LiteralPath (Join-Path $hyperframesSource 'LICENSE') -Destination (Join-Path $licenses 'HyperFrames-APACHE-2.0.txt')
    Copy-Item -LiteralPath (Join-Path $RuntimeSource 'LICENSE') -Destination (Join-Path $licenses 'llama.cpp-omni-MIT.txt')
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'LICENSE') -Destination (Join-Path $licenses 'hyperframes-voxcpm2-APACHE-2.0.txt')
    Copy-Item -LiteralPath (Join-Path $repositoryRoot 'THIRD_PARTY_NOTICES.md') -Destination $bundle

    foreach ($item in @(Get-ChildItem -LiteralPath $bundle -Recurse -Force)) {
        if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
            throw "Release bundle contains a reparse point: $($item.FullName)"
        }
        if (-not $item.PSIsContainer -and $item.Length -le 0) {
            throw "Release bundle contains an empty file: $($item.FullName)"
        }
    }
    foreach ($asset in @(Get-ChildItem -LiteralPath (Join-Path $engine 'audio\assets\sfx') -File -Filter '*.mp3')) {
        $prefix = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes($asset.FullName), 0,
            [Math]::Min(64, [int]$asset.Length))
        if ($prefix.StartsWith('version https://git-lfs.github.com/spec/v1')) {
            throw "HyperFrames release contains an unresolved Git LFS pointer: $($asset.Name)"
        }
    }

    $payloadFiles = @(Get-ChildItem -LiteralPath $bundle -File -Recurse | Sort-Object FullName)
    $fileRecords = @($payloadFiles | ForEach-Object {
            $relative = $_.FullName.Substring($bundle.Length + 1).Replace('\', '/')
            [ordered]@{
                path = $relative
                size = [long]$_.Length
                sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        })
    $releaseManifest = [ordered]@{
        schemaVersion = 1
        releaseVersion = $Version
        platform = 'windows-x64'
        hyperframes = $versions.hyperframes
        runtime = $versions.runtime
        models = $versions.models
        referenceAudio = $versions.referenceAudio
        files = $fileRecords
    }
    [IO.File]::WriteAllText((Join-Path $bundle 'manifest.json'),
        ($releaseManifest | ConvertTo-Json -Depth 10), (New-Object Text.UTF8Encoding($false)))

    $archiveName = "hyperframes-voxcpm2-v$Version-windows-x64.zip"
    $archive = Join-Path $OutputDirectory $archiveName
    $sidecar = "$archive.sha256"
    Remove-Item -LiteralPath $archive, $sidecar -Force -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression
    $archiveStream = [IO.File]::Open($archive, [IO.FileMode]::CreateNew, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try {
        $zip = [IO.Compression.ZipArchive]::new($archiveStream, [IO.Compression.ZipArchiveMode]::Create, $false)
        try {
            foreach ($file in @(Get-ChildItem -LiteralPath $bundle -File -Recurse | Sort-Object FullName)) {
                $relative = $file.FullName.Substring($bundle.Length + 1).Replace('\', '/')
                $entry = $zip.CreateEntry($relative, [IO.Compression.CompressionLevel]::Optimal)
                $entry.LastWriteTime = [DateTimeOffset]::new(1980, 1, 1, 0, 0, 0, [TimeSpan]::Zero)
                $input = [IO.File]::OpenRead($file.FullName)
                $output = $entry.Open()
                try { $input.CopyTo($output) } finally { $output.Dispose(); $input.Dispose() }
            }
        } finally {
            $zip.Dispose()
        }
    } finally {
        $archiveStream.Dispose()
    }
    $archiveHash = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText($sidecar, "$archiveHash  $archiveName`n", (New-Object Text.UTF8Encoding($false)))
    [pscustomobject]@{
        archive = $archive
        sha256 = $archiveHash
        bytes = (Get-Item -LiteralPath $archive).Length
        sidecar = $sidecar
    } | ConvertTo-Json -Compress
} finally {
    Remove-CoreTemporaryDirectory -Path $stage
}
