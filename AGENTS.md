# hyperframes-voxcpm2 repository overlay

The global OpenCode working agreement owns reusable workflow. This file owns only this repository's build, model, and release contracts.

- `versions.json` is the canonical owner for every upstream source, model, and tool version used by a release.
- `src/voxcpm2.mjs` owns the local provider lifecycle, synthesis request, serialization, and audio cache behavior.
- `patches/` owns the smallest exact upstream integration patches. Do not fork or vendor upstream source.
- `scripts/build-release.ps1` owns the Windows x64 CPU-only release bundle.
- Never commit model weights, runtime binaries, generated archives, logs, credentials, or local synthesis output.
- A user-approved narrator reference promoted into `assets/` is product source; unselected audition output remains local and untracked.
- Models are external payloads. Consumers must require an explicit model directory and verify a model once while admitting it to that directory. Normal startup must not rehash the model.
- This repository publishes GitHub Release archives only. It has no installer, package-manager registration, or WinGet entry.
- Run `npm test` and `pwsh -NoProfile -File scripts/test-source.ps1` before committing. A release additionally requires real CPU synthesis outside CI or an explicitly reported native-boundary blocker.
