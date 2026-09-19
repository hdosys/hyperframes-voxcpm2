"""Local, non-batched Supertonic 3 synthesis through the official SDK."""

import json
import os
from pathlib import Path
import sys
import textwrap
import time


def split_text(text):
    from supertonic.utils import chunk_text

    # The SDK groups sentences but does not split a sentence longer than its limit.
    return [part for sentence in chunk_text(text, 300)
            for part in textwrap.wrap(sentence, width=300, break_long_words=True,
                                      break_on_hyphens=False)]


def main():
    # The pinned SDK uses CPU exclusively; verify its actual sessions below.
    os.environ["HF_HUB_OFFLINE"] = "1"
    import numpy as np
    from supertonic import TTS

    request = json.load(sys.stdin)
    started = time.perf_counter()
    tts = TTS(model="supertonic-3", model_dir=Path(request["modelDir"]),
              auto_download=False, intra_op_num_threads=16, inter_op_num_threads=1)
    sessions = [tts.model.dp_ort, tts.model.text_enc_ort,
                tts.model.vector_est_ort, tts.model.vocoder_ort]
    if any(session.get_providers() != ["CPUExecutionProvider"] for session in sessions):
        raise RuntimeError("Supertonic requires CPUExecutionProvider exclusively")
    style = tts.get_voice_style(request["voice"])
    chunks = split_text(request["text"])
    if not chunks:
        raise ValueError("Text cannot be empty")
    loaded = time.perf_counter()
    audio = []
    for chunk in chunks:
        wav, _ = tts.synthesize(chunk, voice_style=style, lang=request["lang"],
                                total_steps=10, max_chunk_length=300,
                                speed=request["speed"], silence_duration=0.3)
        if audio:
            audio.append(np.zeros((1, int(tts.sample_rate * 0.3)), dtype=np.float32))
        audio.append(wav)
    wav = np.concatenate(audio, axis=1)
    if not np.isfinite(wav).all() or not np.any(wav):
        raise RuntimeError("Supertonic produced invalid or silent audio")
    tts.save_audio(wav, request["output"])
    print(json.dumps({"sampleRate": tts.sample_rate, "duration": wav.shape[1] / tts.sample_rate,
                      "chunks": [len(chunk) for chunk in chunks], "steps": 10,
                      "batch": False, "threads": 16, "provider": "CPUExecutionProvider",
                      "loadSeconds": loaded - started,
                      "synthesisSeconds": time.perf_counter() - loaded}))


if __name__ == "__main__":
    main()
