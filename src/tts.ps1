$ErrorActionPreference = 'Stop'
$node = (Get-Command 'node.exe' -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$cli = Join-Path $PSScriptRoot '..\engine\audio\scripts\lib\voxcpm2-cli.mjs'
if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) {
    throw "TTS CLI module is missing: $cli"
}
& $node $cli @args
exit $LASTEXITCODE
