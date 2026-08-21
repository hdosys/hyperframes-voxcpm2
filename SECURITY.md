# Security

Report vulnerabilities through GitHub private vulnerability reporting for this repository. Do not include credentials, private voice samples, generated audio, or model payloads in a public issue.

Release bundles pin every upstream source revision. Models remain external and are admitted to a user-selected directory through a streaming size and SHA-256 check. Normal startup trusts that completed admission record and does not rehash the complete model.

The bundled server is configured with `GGML_VULKAN=OFF`, the release contains no Vulkan runtime, and the provider always launches the CPU server with zero GPU layers.
