import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const model = JSON.parse(readFileSync(new URL("../versions.json", import.meta.url), "utf8")).supertonic;
const runner = fileURLToPath(new URL("./supertonic-runner.py", import.meta.url));
export const SUPERTONIC_VOICES = ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"];
let queue = Promise.resolve();

export function resolveSupertonicVoice(voice) {
  const selected = voice || "M1";
  if (!SUPERTONIC_VOICES.includes(selected)) throw new Error("Supertonic voice must be M1-M5 or F1-F5");
  return selected;
}

export function supertonicAvailable(env = process.env) {
  return Boolean(env.HF_SUPERTONIC_PYTHON && existsSync(env.HF_SUPERTONIC_PYTHON) &&
    env.HF_SUPERTONIC_MODEL_DIR && existsSync(join(env.HF_SUPERTONIC_MODEL_DIR, "admitted.json")));
}

function run(request) {
  return new Promise((done, reject) => {
    const child = spawn(process.env.HF_SUPERTONIC_PYTHON, ["-B", runner], {
      windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONIOENCODING: "utf-8", HF_HUB_OFFLINE: "1" },
    });
    let stdout = "", stderr = "", timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 900000);
    const stop = () => child.kill();
    process.once("exit", stop);
    child.stdout.on("data", data => { stdout += data; });
    child.stderr.on("data", data => { stderr = (stderr + data).slice(-8000); });
    child.stdin.on("error", () => {}); // Exit/error below owns a failed child, including early stdin close.
    child.once("error", error => { clearTimeout(timer); process.removeListener("exit", stop); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      process.removeListener("exit", stop);
      if (timedOut) return reject(new Error("Supertonic CPU synthesis exceeded 15 minutes"));
      if (code !== 0) return reject(new Error(`Supertonic exited ${code}: ${stderr}`));
      try { done(JSON.parse(stdout)); } catch { reject(new Error("Invalid Supertonic result")); }
    });
    child.stdin.end(JSON.stringify(request));
  });
}

async function synthesize({ text, voiceId, voiceDesign, lang = "de", speed = 1, wavAbs, hyperframesDir }) {
  let temporary;
  try {
    if (!supertonicAvailable()) throw new Error("Set HF_SUPERTONIC_PYTHON and HF_SUPERTONIC_MODEL_DIR to the installed SDK and admitted model");
    if (voiceDesign != null) throw new Error("Supertonic uses built-in presets; Voice Design requires --provider voxcpm2");
    if (typeof text !== "string" || !text.trim()) throw new Error("Text cannot be empty");
    if (!Number.isFinite(Number(speed)) || Number(speed) < 0.7 || Number(speed) > 2) throw new Error("Supertonic speed must be between 0.7 and 2");
    const voice = resolveSupertonicVoice(voiceId);
    const modelDir = resolve(process.env.HF_SUPERTONIC_MODEL_DIR);
    const admission = JSON.parse(readFileSync(join(modelDir, "admitted.json"), "utf8"));
    if (admission.repository !== model.repository || admission.revision !== model.revision ||
        JSON.stringify(admission.files) !== JSON.stringify(model.files)) throw new Error("Supertonic model admission identity mismatch");
    const key = createHash("sha256").update(JSON.stringify({ model, voice, text, lang, speed,
      steps: 10, chunkLength: 300, batch: false, schema: 1 })).digest("hex");
    const cache = resolve(process.env.HF_SUPERTONIC_CACHE_DIR || join(hyperframesDir, ".media", "cache", "supertonic"));
    mkdirSync(cache, { recursive: true });
    const cached = join(cache, `${key}.wav`);
    let evidence = { cached: true };
    if (!existsSync(cached)) {
      temporary = `${cached}.${process.pid}.tmp.wav`;
      evidence = await run({ text, voice, lang, speed: Number(speed), modelDir, output: temporary });
      renameSync(temporary, cached);
      temporary = null;
    }
    mkdirSync(dirname(wavAbs), { recursive: true });
    copyFileSync(cached, wavAbs);
    return { ok: true, words: [], evidence };
  } catch (error) {
    return { ok: false, words: [], error: error.message };
  } finally {
    if (temporary) rmSync(temporary, { force: true });
  }
}

export function synthesizeSupertonic(args) {
  const result = queue.then(() => synthesize(args));
  queue = result.then(() => {});
  return result;
}
