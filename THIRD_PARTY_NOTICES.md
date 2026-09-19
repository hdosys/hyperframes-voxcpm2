# Third-party notices

Release bundles contain derived or built material from these upstream projects:

- [HyperFrames](https://github.com/heygen-com/hyperframes), Apache License 2.0.
- [llama.cpp-omni](https://github.com/tc-mb/llama.cpp-omni), MIT License.
- [VoxCPM2 GGUF](https://huggingface.co/DennisHuang648/VoxCPM2-GGUF), Apache License 2.0.
- [VoxCPM](https://github.com/OpenBMB/VoxCPM), Apache License 2.0.

The release build copies the exact upstream license files beside the corresponding payloads. Model weights and reference audio are not bundled.

## Supertonic 3

The optional Python dependency `supertonic` is the official Supertone SDK, licensed under MIT. ONNX Runtime is MIT-licensed. Their wheel distributions retain their own license files.

The Supertonic external model and preset voices come from `supertone-oss-archive/supertonic-3`, revision `aafc6e32416a594460b32413efc49d7fe4ce6d46`, copyright 2026 Supertone Inc. They are governed by BigScience Open RAIL-M, including use restrictions and disclosure of machine-generated output. The model admission command downloads the exact license alongside the original ONNX files. Weights are not redistributed in this source repository or bundle. No reference voice is cloned by the Supertonic provider.

## Qwen CustomVoice local evaluation

The Qwen3-TTS-12Hz-0.6B-CustomVoice model is by the Qwen team at Alibaba Cloud, with Apache-2.0 model metadata. The pinned Q8_0 GGUF conversion and F16 codec are published by khimaros; exact file identities and remaining precision are recorded in `versions.json`. Model weights are external and are not bundled.

The native runtime is `khimaros/qwen3-tts.cpp` at `0c8b2ba0e7c57a2741852f4305a92996258a71a0`. That revision has no license file or established redistribution grant. This is not assumed to inherit a license from another project's current branch. Its binary is restricted to the user's local evaluation bundle; public release is blocked until rights are established. GGML at `d4fcfe88a8bcf5c9840be14be6c2fbf1f5b3b2db` is MIT-licensed and its license accompanies the local build. The local Windows/preset/UTF-8 CLI modifications are identified by the manifest's patch hash.
