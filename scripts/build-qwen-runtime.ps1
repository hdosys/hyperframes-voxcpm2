#requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')
$root = Get-CoreRepositoryRoot
$qwen = (Get-CoreVersions).qwen3
$source = Join-Path $OutputDirectory 'source'
$build = Join-Path $OutputDirectory 'build'
if (Test-Path -LiteralPath $OutputDirectory) { throw 'Choose a new build directory.' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
Invoke-CoreNative -Role 'Qwen runtime source' -FilePath git.exe -ProcessArguments @('clone', [string]$qwen.runtime.repository, $source) -WorkingDirectory $root -TimeoutSeconds 180 | Out-Null
Invoke-CoreNative -Role 'Qwen immutable runtime checkout' -FilePath git.exe -ProcessArguments @('-C', $source, 'checkout', '--detach', [string]$qwen.runtime.commit) -WorkingDirectory $root -TimeoutSeconds 30 | Out-Null
Invoke-CoreNative -Role 'Qwen GGML dependency' -FilePath git.exe -ProcessArguments @('-C', $source, 'submodule', 'update', '--init', '--recursive') -WorkingDirectory $root -TimeoutSeconds 180 | Out-Null
$ggmlCommit = (Invoke-CoreNative -Role 'Qwen GGML identity' -FilePath git.exe -ProcessArguments @('-C', (Join-Path $source 'ggml'), 'rev-parse', 'HEAD') -WorkingDirectory $root -TimeoutSeconds 30 | Select-Object -Last 1).Trim()
if ($ggmlCommit -cne [string]$qwen.runtime.ggmlCommit) { throw 'Unexpected Qwen GGML dependency commit.' }
$patch = Join-Path $root 'patches\qwen3-tts-windows-cli.patch'
Invoke-CoreNative -Role 'Qwen Windows CLI patch' -FilePath git.exe -ProcessArguments @('-C', $source, 'apply', '--recount', '--whitespace=error-all', $patch) -WorkingDirectory $root -TimeoutSeconds 30 | Out-Null
Invoke-CoreNative -Role 'Qwen CPU configuration' -FilePath cmake.exe -ProcessArguments @('-S', $source, '-B', $build, '-A', 'x64', '-DBUILD_SHARED_LIBS=OFF', '-DGGML_NATIVE=OFF', '-DGGML_CUDA=OFF', '-DGGML_VULKAN=OFF', '-DGGML_METAL=OFF', '-DQWEN3_TTS_COREML=OFF', '-DQWEN3_TTS_SERVER=OFF', "-DCMAKE_CXX_FLAGS=/D_USE_MATH_DEFINES /D_CRT_SECURE_NO_WARNINGS /utf-8 /EHsc /MP$([Environment]::ProcessorCount)") -WorkingDirectory $root -TimeoutSeconds 180 | Out-Null
Invoke-CoreNative -Role 'Qwen CPU build' -FilePath cmake.exe -ProcessArguments @('--build', $build, '--config', 'Release', '--target', 'qwen3-tts-cli', '--parallel', [string][Environment]::ProcessorCount) -WorkingDirectory $root -TimeoutSeconds 600 | Out-Null
