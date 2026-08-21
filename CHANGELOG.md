# Changelog

## 0.1.4 - 2026-08-21

- Removed Vulkan compilation, packaging, runtime selection, and fallback behavior.
- Releases now contain one generic Windows x64 CPU server and always launch it with GPU layers disabled.

## 0.1.3 - 2026-08-21

- Added local VoxCPM2 reference-voice synthesis for HyperFrames 0.8.6.
- Added generic Windows x64 CPU and Vulkan runtime builds.
- Added bounded server startup, CPU fallback, serialized synthesis, real WAV duration ownership, and deterministic caching without Whisper.
- Added immutable model metadata for consumer-managed model directories.
