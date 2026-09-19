# HyperFrames VoxCPM2

Local German speech for HyperFrames on Windows. Supertonic 3 is the default CPU engine, with ten built-in voices. VoxCPM2 remains explicitly selectable for voice design and reference-voice cloning. The bundle supplies a versioned HyperFrames audio-engine override and the optional VoxCPM2 CPU server.

## Engineering approach

Reuse HyperFrames' existing audio-engine seam and the official Supertonic Python SDK. Do not fork inference code or add a network service. Model assets are verified once at admission, then inference runs offline.

## How it works

The Node provider serializes requests to a bounded Python process using ONNX Runtime's CPU provider with 16 threads. It uses the original, unquantized ONNX models, ten inference steps and sequential chunks of at most 300 characters, including overlong sentences. Batch mode is off. Built-in presets are M1, M2, M3, M4, M5, F1, F2, F3, F4 and F5. M1 is the default. Identical requests reuse the project audio cache.

## Supertonic setup and first use

Requirements: Windows x64, Node.js 22+, PowerShell 7, Python 3.13 and `uv`. Extract the verified bundle, then run from its root, choosing an empty model directory:

```powershell
uv venv .venv --python 3.13
uv pip sync requirements.txt --python .venv\Scripts\python.exe --require-hashes --only-binary :all:
python bin\download-supertonic.py --model-dir C:\Models\supertonic-3
$env:HF_SUPERTONIC_PYTHON = (Resolve-Path .venv\Scripts\python.exe).Path
$env:HF_SUPERTONIC_MODEL_DIR = 'C:\Models\supertonic-3'
.\bin\tts.ps1 --text "Willkommen. Dein Arbeitsbereich ist bereit." --output .\welcome.wav
.\bin\tts.ps1 --text "Diese Stimme wurde künstlich erzeugt." --voice F1 --lang de --output .\female.wav
```

The exact model is `supertone-oss-archive/supertonic-3` at `aafc6e32416a594460b32413efc49d7fe4ce6d46`. No alternate revision, SDK auto-download, quantization or voice cloning is used by this engine. Model files and all ten preset styles are admitted using their upstream content identities. A failed/incomplete admission has no completion marker; preserve it and choose a new empty directory rather than overwriting uncertain files.

**Model terms:** Supertonic's weights and presets use OpenRAIL-M, not the source-code license. Read the downloaded `LICENSE`. Clearly disclose that generated speech is machine-generated wherever it is used or distributed, and comply with its use restrictions, including the prohibition on nonconsensual impersonation. The presets do not reuse the VoxCPM2 narrator reference.

For HyperFrames, set `HF_MEDIA_ENGINE` to the extracted `engine` directory. Select `--provider supertonic --voice M1 --lang de` or use `provider`, `voice` and `lang` in the audio request. No provider selection defaults to Supertonic; missing setup fails with an actionable error rather than silently using another engine. `HF_SUPERTONIC_CACHE_DIR` optionally selects another audio-cache directory.

## VoxCPM2 alternative

- Explicit `--provider voxcpm2` synthesis through the same audio-engine seam.
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
bin/tts.ps1                    Direct PowerShell CLI
bin/download-supertonic.py      Verified model admission
requirements.txt               Hashed Python dependency lock
versions.json                  Exact model/source identities
engine/audio/                 Integrated HyperFrames audio engine
reference/herdr-narrator-de.wav  Default narrator reference
runtime/cpu/                  Generic x64 CPU server
licenses/                     Upstream licenses
manifest.json                 Source, model, and payload identities
```

The project publishes GitHub Release archives. It deliberately has no installer and no WinGet package. Consuming products verify an archive and provide their own configuration and deployment experience.

## Direct CLI

For VoxCPM2, the consuming environment supplies the verified paths in `HF_VOXCPM2_BASE_LM`, `HF_VOXCPM2_ACOUSTIC`, `HF_VOXCPM2_SERVER_CPU`, and `HF_VOXCPM2_REFERENCE_AUDIO`. Synthesize with the selected narrator, override it with Voice Design for one request, or select another explicit reference WAV:

```powershell
tts.ps1 --provider voxcpm2 --text "Your workspace is ready." --output .\default.wav
tts.ps1 --provider voxcpm2 --text "Your workspace is ready." --design "A concise, energetic technical narrator." --output .\custom.wav
tts.ps1 --provider voxcpm2 --text "Your workspace is ready." --voice .\speaker.wav --output .\clone.wav
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
- Current stable Visual Studio Build Tools with the C++ workload
- CMake

Run source tests:

```powershell
npm test
pwsh -NoProfile -File scripts/test-source.ps1
```

Build the canonical local archive from a clean commit (no release publication):

```powershell
pwsh -NoProfile -File scripts/build-release.ps1 -Version 0.1.12 -Local
pwsh -NoProfile -File scripts/test-release.ps1 -Archive dist/hyperframes-voxcpm2-local-windows-x64.zip
```

All upstream revisions and model metadata are pinned in [`versions.json`](versions.json).
The local archive's manifest carries a UTC freshness label. Public release versions remain separate. Supertonic's Python environment is installed from the lock by the consumer, not copied from a developer's virtual environment. The bundle does not include model weights.
