# HyperFrames VoxCPM2

Local voice-designed speech and explicit reference-voice cloning for HyperFrames on Windows. The release bundle supplies a versioned HyperFrames audio-engine override plus one CPU-only build of `llama-tts-server`.

## What it provides

- Local VoxCPM2 synthesis through HyperFrames' supported `HF_MEDIA_ENGINE` seam.
- CPU-only synthesis with GPU layers explicitly disabled.
- CPU inference uses a bounded pool of one or two workers. Systems with at least 12 logical CPUs and 24 GB RAM automatically use two six-thread workers; smaller systems use one worker with at most eight threads.
- A selected German Herdr narrator reference that keeps the default voice stable across segments.
- Per-project Voice Design overrides through `voice_design` in `audio_request.json` or `--voice-design` on the audio engine.
- Explicit `--voice <wav>` reference-voice cloning when a specific speaker is selected.
- A direct `tts.ps1` command for quick Voice Design and reference-clone experiments without the HyperFrames CLI.
- One synthesis request at a time.
- Real WAV duration readback by HyperFrames.
- `words: []`, which intentionally avoids a Whisper transcription pass.
- Deterministic segment caching keyed by text, voice mode, model identity, and generation settings.

Models are not included in releases. A consuming application must require the user to choose a model directory before downloading them. Model integrity is checked once while streaming a download into that directory, then recorded in a completion manifest. Normal startup does not read and hash the complete model again.

## Release contents

```text
bin/tts.ps1                 Direct PowerShell CLI
engine/audio/                 Patched HyperFrames 0.8.8 audio engine
reference/herdr-narrator-de.wav  Default narrator reference
runtime/cpu/                  Generic x64 CPU server
licenses/                     Upstream licenses
manifest.json                 Source, model, and payload identities
```

The project publishes GitHub Release archives. It deliberately has no installer and no WinGet package. Consuming products verify an archive and provide their own configuration and deployment experience.

## Direct CLI

The consuming environment supplies the verified paths in `HF_VOXCPM2_BASE_LM`, `HF_VOXCPM2_ACOUSTIC`, `HF_VOXCPM2_SERVER_CPU`, and `HF_VOXCPM2_REFERENCE_AUDIO`. Synthesize with the selected default narrator, override it with Voice Design for one request, or select another explicit reference WAV:

```powershell
tts.ps1 --text "Your workspace is ready." --output .\default.wav
tts.ps1 --text "Your workspace is ready." --design "A concise, energetic technical narrator." --output .\custom.wav
tts.ps1 --text "Your workspace is ready." --voice .\speaker.wav --output .\clone.wav
```

`--design` and `--voice` are mutually exclusive. The release ships no web UI or long-lived service; the command reuses the same bounded provider and local server lifecycle as HyperFrames.

## CPU worker configuration

HyperFrames already submits independent narration lines concurrently. The provider accepts at most two at once and preserves one request per runtime. Override automatic selection when a system needs another balance:

```powershell
$env:HF_VOXCPM2_WORKERS = '2'
$env:HF_VOXCPM2_THREADS = '6'
$env:HYPERFRAMES_TTS_CONCURRENCY = '2'
```

`HF_VOXCPM2_WORKERS` accepts `1` or `2`. `HF_VOXCPM2_THREADS` is the thread count per worker, and total configured worker threads must not exceed the logical CPU count. An externally managed `HF_VOXCPM2_ENDPOINT` supports one worker. The direct `tts.ps1` command selects one worker unless the user explicitly overrides it.

## Development

Requirements:

- Windows x64
- Node.js 22 or newer
- PowerShell 7
- Visual Studio 2022 Build Tools
- CMake

Run source tests:

```powershell
npm test
pwsh -NoProfile -File scripts/test-source.ps1
```

Build a release archive:

```powershell
pwsh -NoProfile -File scripts/build-release.ps1 -Version 0.1.11
pwsh -NoProfile -File scripts/test-release.ps1 -Archive dist/hyperframes-voxcpm2-v0.1.11-windows-x64.zip
```

All upstream revisions and model metadata are pinned in [`versions.json`](versions.json).
