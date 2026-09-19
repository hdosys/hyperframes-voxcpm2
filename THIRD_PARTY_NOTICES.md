# Third-party notices

Release bundles contain derived or built material from these upstream projects:

- [HyperFrames](https://github.com/heygen-com/hyperframes), Apache License 2.0.
- [llama.cpp-omni](https://github.com/tc-mb/llama.cpp-omni), MIT License.
- [VoxCPM2 GGUF](https://huggingface.co/DennisHuang648/VoxCPM2-GGUF), Apache License 2.0.
- [VoxCPM](https://github.com/OpenBMB/VoxCPM), Apache License 2.0.

The release build copies the exact upstream license files beside the corresponding payloads. Model weights and reference audio are not bundled.

## Supertonic 3

The optional Python dependency `supertonic` is the official Supertone SDK, licensed under MIT. ONNX Runtime is MIT-licensed. Their wheel distributions retain their own license files.

The default external model and preset voices come from `supertone-oss-archive/supertonic-3`, revision `aafc6e32416a594460b32413efc49d7fe4ce6d46`, copyright 2026 Supertone Inc. They are governed by BigScience Open RAIL-M, including use restrictions and disclosure of machine-generated output. The model admission command downloads the exact license alongside the original ONNX files. Weights are not redistributed in this source repository or bundle. No reference voice is cloned by the Supertonic provider.
