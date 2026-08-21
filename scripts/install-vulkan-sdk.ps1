#requires -Version 7.0
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'common.ps1')

$versions = Get-CoreVersions
$version = [string]$versions.vulkanSdk.version
$expectedRoot = "C:\VulkanSDK\$version"
$glslc = Join-Path $expectedRoot 'Bin\glslc.exe'
if (-not (Test-Path -LiteralPath $glslc -PathType Leaf)) {
    $stage = New-CoreTemporaryDirectory
    try {
        $installer = Join-Path $stage 'vulkan-sdk.exe'
        $download = [Diagnostics.Stopwatch]::StartNew()
        try {
            Invoke-WebRequest -Uri ([string]$versions.vulkanSdk.url) -OutFile $installer -TimeoutSec 1800
        } finally {
            $download.Stop()
            Write-Host ("TIMING Vulkan SDK download: {0:N3} s" -f $download.Elapsed.TotalSeconds)
        }
        $actual = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($actual -cne [string]$versions.vulkanSdk.sha256) {
            throw "Vulkan SDK installer SHA-256 mismatch: $actual"
        }
        Invoke-CoreNative -Role 'Vulkan SDK installation' -FilePath $installer `
            -ProcessArguments @('--accept-licenses', '--default-answer', '--confirm-command', 'install') `
            -WorkingDirectory $stage -TimeoutSeconds 1200 | Out-Null
    } finally {
        Remove-CoreTemporaryDirectory -Path $stage
    }
}

if (-not (Test-Path -LiteralPath $glslc -PathType Leaf)) {
    throw "Vulkan SDK $version did not provide glslc.exe at $glslc"
}
$env:VULKAN_SDK = $expectedRoot
$env:Path = (Join-Path $expectedRoot 'Bin') + ';' + $env:Path
if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_ENV)) {
    Add-Content -LiteralPath $env:GITHUB_ENV -Value "VULKAN_SDK=$expectedRoot"
}
if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_PATH)) {
    Add-Content -LiteralPath $env:GITHUB_PATH -Value (Join-Path $expectedRoot 'Bin')
}
Invoke-CoreNative -Role 'Vulkan glslc version check' -FilePath $glslc `
    -ProcessArguments @('--version') -WorkingDirectory $expectedRoot -TimeoutSeconds 30 | Out-Null
Write-Host "Vulkan SDK ready: $version"
