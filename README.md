# HyperFrames VoxCPM2

Local German speech for HyperFrames on Windows. Qwen3-TTS-12Hz-0.6B-CustomVoice Q8_0 is the default CPU engine, with nine built-in voices. Supertonic 3 and VoxCPM2 remain explicitly selectable. The current Qwen bundle is for local evaluation only; public release is blocked pending confirmation of the runtime fork's redistribution license.

## Engineering approach

Reuse HyperFrames' existing audio-engine seam, the Qwen runtime's existing preset API and the official Supertonic Python SDK. Small upstream patches own Windows/UTF-8 CLI integration; inference code is not vendored. Model assets are verified once at admission, then inference runs offline.

## How it works

The default provider serializes requests to a bounded native Qwen process. UTF-8 text is passed through a file, preserving German characters without console-codepage conversion. Ryan is the default preset, German the direct CLI default language. Identical requests reuse a cache keyed by model/runtime identity, text, voice, language and generation settings. No voice cloning is used by Qwen CustomVoice.

## Qwen setup and first use

Requirements: Windows x64, Node.js 22+, PowerShell 7, and Python for the one-time model download. Synthesis needs no Python, PyTorch or GPU. Extract the local bundle, then select an empty model directory:

```powershell
python bin\download-supertonic.py --engine qwen3 --model-dir C:\Models\qwen3-customvoice-q8
$env:HF_QWEN3_TTS_CLI = (Resolve-Path runtime\qwen3\qwen3-tts-cli.exe).Path
$env:HF_QWEN3_TTS_MODEL_DIR = 'C:\Models\qwen3-customvoice-q8'
.\bin\tts.ps1 --text "Dein Arbeitsbereich ist bereit." --output .\ryan.wav
.\bin\tts.ps1 --text-file .\text.txt --voice aiden --lang de --output .\aiden.wav
```

Presets: `ryan`, `aiden`, `uncle_fu`, `dylan`, `eric`, `vivian`, `serena`, `ono_anna`, `sohee`. The English-native Ryan and Aiden presets can synthesize German, but pronunciation and voice quality remain listening decisions. This 0.6B model does not support the 1.7B model's instruction-based voice design. Playback speed is 1. CPU threads default to at most 16; `HF_QWEN3_TTS_THREADS` permits a positive count within the available logical CPUs. `HF_QWEN3_TTS_CACHE_DIR` optionally relocates the cache. Each request has a 15-minute deadline.

**Model and precision:** community conversion `khimaros/Qwen3-TTS-12Hz-0.6B-CustomVoice-GGUF` at `317e89450001324287f4b46e52b4807145b8c46a`, derived from the official Qwen CustomVoice checkpoint, not Base or 1.7B. The model contains 233 Q8_0, 33 FP16 and 136 FP32 tensors. The separate tokenizer/vocoder at `6895fdd9384847f4b37ea56fe385f4b7e0ee2f5f` contains 216 FP16 and 232 FP32 tensors, including encoder tensors unused for preset synthesis. This is not an all-INT8 pipeline. Model metadata, hashes and runtime identities are in `versions.json`.

**Backend and licensing:** native `khimaros/qwen3-tts.cpp` with GGML, not upstream llama.cpp or ONNX. Qwen model metadata declares Apache-2.0; GGML is MIT. The pinned runtime fork contains no license grant, so the build explicitly rejects public release and includes an evaluation notice rather than inventing a runtime license. Do not redistribute its binary or the local bundle without permission.

For HyperFrames, set `HF_MEDIA_ENGINE` to the extracted `engine` directory and use `--voice ryan --lang de`, or `voice` and `lang` in the audio request. The default provider is `qwen3`. Missing setup fails rather than silently switching engines.

## Supertonic alternative

Select `--provider supertonic`. Its existing path remains ONNX Runtime CPU, 16 threads, original unquantized ONNX weights, ten steps, sequential chunks of at most 300 characters and no batching. Presets remain M1-M5/F1-F5, default M1.

This alternative requires a working Python installation and `uv` (validated with Python 3.13). Run from the bundle root, choosing an empty model directory:

```powershell
uv venv .venv --python python
uv pip sync requirements.txt --python .venv\Scripts\python.exe --require-hashes --only-binary :all:
python bin\download-supertonic.py --model-dir C:\Models\supertonic-3
$env:HF_SUPERTONIC_PYTHON = (Resolve-Path .venv\Scripts\python.exe).Path
$env:HF_SUPERTONIC_MODEL_DIR = 'C:\Models\supertonic-3'
.\bin\tts.ps1 --provider supertonic --text "Willkommen. Dein Arbeitsbereich ist bereit." --output .\welcome.wav
.\bin\tts.ps1 --provider supertonic --text "Diese Stimme wurde künstlich erzeugt." --voice F1 --lang de --output .\female.wav
```

The exact model is `supertone-oss-archive/supertonic-3` at `aafc6e32416a594460b32413efc49d7fe4ce6d46`. No alternate revision, SDK auto-download, quantization or voice cloning is used by this engine. Model files and all ten preset styles are admitted using their upstream content identities. A failed/incomplete admission has no completion marker; preserve it and choose a new empty directory rather than overwriting uncertain files.

**Model terms:** Supertonic's weights and presets use OpenRAIL-M, not the source-code license. Read the downloaded `LICENSE`. Clearly disclose that generated speech is machine-generated wherever it is used or distributed, and comply with its use restrictions, including the prohibition on nonconsensual impersonation. The presets do not reuse the VoxCPM2 narrator reference.

Select `--provider supertonic --voice M1 --lang de` in HyperFrames, or use `provider`, `voice` and `lang` in the audio request. `HF_SUPERTONIC_CACHE_DIR` optionally selects another audio-cache directory.

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
bin/download-supertonic.py      Verified Qwen/Supertonic model admission
requirements.txt               Hashed Python dependency lock
versions.json                  Exact model/source identities
engine/audio/                 Integrated HyperFrames audio engine
reference/herdr-narrator-de.wav  Default narrator reference
runtime/cpu/                  Generic x64 CPU server
runtime/qwen3/                 Local evaluation Qwen CustomVoice CPU CLI
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
