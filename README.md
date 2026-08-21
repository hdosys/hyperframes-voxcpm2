# HyperFrames VoxCPM2

Local reference-voice speech for HyperFrames on Windows. The release bundle supplies a versioned HyperFrames audio-engine override plus CPU and Vulkan builds of `llama-tts-server`.

## What it provides

- Local VoxCPM2 synthesis through HyperFrames' supported `HF_MEDIA_ENGINE` seam.
- Automatic Vulkan selection with a CPU fallback when Vulkan cannot start.
- One synthesis request at a time.
- Real WAV duration readback by HyperFrames.
- `words: []`, which intentionally avoids a Whisper transcription pass.
- Deterministic segment caching keyed by text, reference audio, model identity, backend, and generation settings.

Models are not included in releases. A consuming application must require the user to choose a model directory before downloading them. Model integrity is checked once while streaming a download into that directory, then recorded in a completion manifest. Normal startup does not read and hash the complete model again.

## Release contents

```text
engine/audio/                 Patched HyperFrames 0.8.6 audio engine
runtime/cpu/                  Generic x64 CPU server
runtime/vulkan/               Generic x64 Vulkan server
licenses/                     Upstream licenses
manifest.json                 Source, model, and payload identities
```

The project publishes GitHub Release archives. It deliberately has no installer and no WinGet package. Consuming products verify an archive and provide their own configuration and deployment experience.

## Development

Requirements:

- Windows x64
- Node.js 22 or newer
- PowerShell 7
- Visual Studio 2022 Build Tools
- CMake
- Vulkan SDK 1.4.309.0

Run source tests:

```powershell
npm test
pwsh -NoProfile -File scripts/test-source.ps1
```

Build a release archive:

```powershell
pwsh -NoProfile -File scripts/build-release.ps1 -Version 0.1.1
pwsh -NoProfile -File scripts/test-release.ps1 -Archive dist/hyperframes-voxcpm2-v0.1.1-windows-x64.zip
```

All upstream revisions and model metadata are pinned in [`versions.json`](versions.json).
