import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { cpus } from "node:os";
import { dirname, join, resolve } from "node:path";

const model = JSON.parse(readFileSync(new URL("../versions.json", import.meta.url), "utf8")).qwen3;
export const QWEN3_VOICES = ["ryan", "aiden", "uncle_fu", "dylan", "eric", "vivian", "serena", "ono_anna", "sohee"];
const languages = ["de", "en", "zh", "ja", "ko", "ru", "fr", "es", "it", "pt"];
let queue = Promise.resolve();

export function resolveQwen3Voice(voice) {
  const selected = (voice || "ryan").toLowerCase();
  if (!QWEN3_VOICES.includes(selected)) throw new Error(`Qwen CustomVoice preset must be one of: ${QWEN3_VOICES.join(", ")}`);
  return selected;
}

export function qwen3Available(env = process.env) {
  return Boolean(env.HF_QWEN3_TTS_CLI && existsSync(env.HF_QWEN3_TTS_CLI) &&
    env.HF_QWEN3_TTS_MODEL_DIR && existsSync(join(env.HF_QWEN3_TTS_MODEL_DIR, "admitted.json")));
}

function run(args) {
  return new Promise((done, reject) => {
    const child = execFile(process.env.HF_QWEN3_TTS_CLI, args, {
      windowsHide: true, timeout: 900000, killSignal: "SIGKILL", maxBuffer: 1024 * 1024,
      env: { ...process.env, QWEN3_TTS_USE_COREML: "0" },
    }, (error, stdout, stderr) => {
      process.removeListener("exit", stop);
      if (error) return reject(new Error(`Qwen CPU synthesis failed: ${error.message}\n${stderr.slice(-3000)}`));
      if (!stderr.includes("TTSTransformer backend: CPU") || !stderr.includes("AudioTokenizerDecoder backend: CPU")) {
        return reject(new Error("Qwen runtime did not confirm CPU for both model components"));
      }
      const timing = label => Number(stderr.match(new RegExp(`${label}:\\s+(\\d+) ms`))?.[1]) / 1000;
      done({ loadSeconds: Number(stderr.match(/All models loaded in (\d+) ms/)?.[1]) / 1000,
        generationSeconds: timing("Code generation"), decodeSeconds: timing("Vocoder decode"),
        synthesisSeconds: timing("Total"), duration: Number(stderr.match(/Audio duration:\s+([\d.]+) s/)?.[1]) });
    });
    const stop = () => child.kill("SIGKILL");
    process.once("exit", stop);
    child.stdin.end();
  });
}

async function synthesize({ text, voiceId, voiceDesign, lang = "de", speed = 1, wavAbs, hyperframesDir }) {
  let textFile, temporary;
  try {
    if (!qwen3Available()) throw new Error("Set HF_QWEN3_TTS_CLI and HF_QWEN3_TTS_MODEL_DIR to the CPU runtime and admitted CustomVoice model");
    if (typeof text !== "string" || !text.trim()) throw new Error("Text cannot be empty");
    if (voiceDesign != null) throw new Error("Qwen 0.6B CustomVoice uses built-in presets, not Voice Design");
    if (Number(speed) !== 1) throw new Error("Qwen CustomVoice supports speed=1 only");
    if (!languages.includes(lang)) throw new Error(`Unsupported Qwen language: ${lang}`);
    const voice = resolveQwen3Voice(voiceId);
    const threads = Number(process.env.HF_QWEN3_TTS_THREADS || Math.min(16, cpus().length));
    if (!Number.isInteger(threads) || threads < 1 || threads > cpus().length) throw new Error("HF_QWEN3_TTS_THREADS must fit the available logical CPUs");
    const modelDir = resolve(process.env.HF_QWEN3_TTS_MODEL_DIR);
    const admission = JSON.parse(readFileSync(join(modelDir, "admitted.json"), "utf8"));
    if (admission.repository !== model.repository || admission.revision !== model.revision ||
        JSON.stringify(admission.files) !== JSON.stringify(model.files)) throw new Error("Qwen model admission identity mismatch");
    const params = { temperature: 0.9, topK: 50, repetitionPenalty: 1.05, seed: 42, maxTokens: 2048 };
    const key = createHash("sha256").update(JSON.stringify({ schema: 1, model, voice, text, lang, params, threads })).digest("hex");
    const cache = resolve(process.env.HF_QWEN3_TTS_CACHE_DIR || join(hyperframesDir, ".media", "cache", "qwen3"));
    mkdirSync(cache, { recursive: true });
    const cached = join(cache, `${key}.wav`);
    let evidence = { cached: true, voice, threads };
    if (!existsSync(cached)) {
      textFile = `${cached}.${process.pid}.txt`;
      temporary = `${cached}.${process.pid}.tmp.wav`;
      writeFileSync(textFile, text, "utf8");
      evidence = { voice, threads, backend: "GGML CPU", ...await run([
        "-m", join(modelDir, model.files[0].name), "--vocoder", join(modelDir, model.files[1].name),
        "--text-file", textFile, "--speaker", voice, "--language", lang, "--threads", String(threads),
        "--temperature", String(params.temperature), "--top-k", String(params.topK),
        "--repetition-penalty", String(params.repetitionPenalty), "--seed", String(params.seed),
        "--max-tokens", String(params.maxTokens), "-o", temporary,
      ]) };
      const bytes = readFileSync(temporary);
      if (bytes.length <= 44 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WAVE") throw new Error("Qwen returned invalid WAV audio");
      renameSync(temporary, cached);
      temporary = null;
    }
    mkdirSync(dirname(wavAbs), { recursive: true });
    copyFileSync(cached, wavAbs);
    return { ok: true, words: [], evidence };
  } catch (error) {
    return { ok: false, words: [], error: error.message };
  } finally {
    if (textFile) rmSync(textFile, { force: true });
    if (temporary) rmSync(temporary, { force: true });
  }
}

export function synthesizeQwen3(args) {
  const result = queue.then(() => synthesize(args));
  queue = result.then(() => {});
  return result;
}
