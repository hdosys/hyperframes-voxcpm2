# Changelog

## 0.1.10 - 2026-08-22

- Applied the configured CPU thread count to both VoxCPM2 inference backends, reducing default synthesis time without changing generated audio.

## 0.1.9 - 2026-08-22

- Added the selected German Herdr narrator reference as the stable default voice across segments.
- Explicit Voice Design and `--voice` selections continue to override the default narrator.

## 0.1.8 - 2026-08-22

- Renamed the direct synthesis command to `tts.ps1` and removed the previous command name.

## 0.1.7 - 2026-08-22

- Updated the default calm male Voice Design to a natural conversational pace with brief pauses.
- Added per-project Voice Design overrides and a direct `voxcpm2.ps1` CLI for rapid design or reference-clone synthesis.

## 0.1.6 - 2026-08-22

- Updated the bundled audio engine integration to HyperFrames 0.8.8.

## 0.1.5 - 2026-08-22

- Default narration now uses a deep, calm male Voice Design with measured tutorial pacing and natural pauses.
- Explicit `--voice` WAV selections continue to use reference-voice cloning.

## 0.1.4 - 2026-08-21

- Removed Vulkan compilation, packaging, runtime selection, and fallback behavior.
- Releases now contain one generic Windows x64 CPU server and always launch it with GPU layers disabled.

## 0.1.3 - 2026-08-21

- Added local VoxCPM2 reference-voice synthesis for HyperFrames 0.8.6.
- Added generic Windows x64 CPU and Vulkan runtime builds.
- Added bounded server startup, CPU fallback, serialized synthesis, real WAV duration ownership, and deterministic caching without Whisper.
- Added immutable model metadata for consumer-managed model directories.
