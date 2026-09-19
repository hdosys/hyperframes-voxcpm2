# hyperframes-voxcpm2 repository overlay

The global OpenCode working agreement owns reusable workflow. This file owns only this repository's build, model, and release contracts.

- `versions.json` is the canonical owner for every upstream source, model, and tool version used by a release.
- `src/voxcpm2.mjs` owns the local provider lifecycle, synthesis request, serialization, and audio cache behavior.
- `src/qwen3.mjs` owns the default Qwen CustomVoice provider and bounded native CLI/cache path. The exact Q8_0 community model uses the standalone GGML runtime, not llama.cpp. Presets only, German/Ryan defaults, CPU-only. `patches/qwen3-tts-windows-cli.patch` owns Windows memory reporting and UTF-8 text/preset CLI integration.
- The pinned Qwen runtime fork has no confirmed redistribution license. Only local evaluation builds are allowed; the public-release builder fails closed. Do not relabel the fork MIT merely because GGML or another upstream repository is MIT.
- `src/supertonic.mjs` owns the selectable Supertonic provider and serialized subprocess/cache boundary. `src/supertonic-runner.py` adapts the official SDK without vendoring inference code. Supertonic uses original ONNX weights, CPU only, 16 threads, ten steps, no batching, and chunks of at most 300 characters.
- `scripts/download-supertonic.py` admits the selected Qwen or Supertonic model from `versions.json` to an explicit external directory. `requirements.txt` locks the Supertonic Python SDK and CPU runtime dependencies tested on Python 3.13 Windows x64. Qwen synthesis uses no Python dependencies.
- `patches/` owns the smallest exact upstream integration patches. Do not fork or vendor upstream source.
- Each release uses the current latest stable HyperFrames version and adapts the provider at its stable audio-engine seam. `versions.json` records the selected tag and commit only so that published bytes remain reproducible; never retain an older version merely to avoid a provider compatibility change.
- `scripts/build-release.ps1` owns the Windows x64 CPU-only release bundle.
- Never commit model weights, runtime binaries, generated archives, logs, credentials, or local synthesis output.
- A user-approved narrator reference promoted into `assets/` is product source; unselected audition output remains local and untracked.
- Models are external payloads. Consumers must require an explicit model directory and verify a model once while admitting it to that directory. Normal startup must not rehash the model.
- This repository publishes GitHub Release archives only. It has no installer, package-manager registration, or WinGet entry.
- GitHub Release publication has one path: dispatch `.github/workflows/release.yml` from `main` with the next version. That workflow builds from pinned source, verifies the archive, creates the tag, and publishes those exact bytes. Never precreate the tag or release and never package a prebuilt runtime.
- Run `npm test` and `pwsh -NoProfile -File scripts/test-source.ps1` before committing. A release additionally requires real CPU synthesis outside CI or an explicitly reported native-boundary blocker.
