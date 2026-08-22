import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { cpus, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const RUNTIME_COMMIT = "09f5c3f1b484759f17b06fc63574f749c89c8761";
const MODEL_REVISION = "169f64d8b98bbaab1761e4ca3a83e6af653456cc";
const DEFAULT_ENDPOINT = "http://127.0.0.1:18765";
const DEFAULT_VOICE_DESIGN =
  "A deep, calm adult male narrator with a warm, grounded tone, speaking slowly and clearly " +
  "with natural pauses. Professional software tutorial delivery, restrained and reassuring.";

let serverPromise = null;
let launchedServer = null;
let synthesisQueue = Promise.resolve();

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

function requiredLauncherInputs(env = process.env, pathExists = existsSync) {
  const baseLm = env.HF_VOXCPM2_BASE_LM;
  const acoustic = env.HF_VOXCPM2_ACOUSTIC;
  const cpuServer = env.HF_VOXCPM2_SERVER_CPU;
  return Boolean(
    baseLm &&
      acoustic &&
      pathExists(baseLm) &&
      pathExists(acoustic) &&
      cpuServer &&
      pathExists(cpuServer),
  );
}

export function voxcpm2Available(env = process.env, pathExists = existsSync) {
  return Boolean(env.HF_VOXCPM2_ENDPOINT || requiredLauncherInputs(env, pathExists));
}

export function resolveVoxCPM2Reference(userVoice, pathExists = existsSync) {
  if (!userVoice) return null;
  if (!pathExists(userVoice)) {
    throw new Error("VoxCPM2 --voice must select an existing reference WAV");
  }
  return resolve(userVoice);
}

function localEndpoint() {
  const endpoint = new URL(process.env.HF_VOXCPM2_ENDPOINT || DEFAULT_ENDPOINT);
  if (endpoint.protocol !== "http:") throw new Error("HF_VOXCPM2_ENDPOINT must use http");
  if (!["127.0.0.1", "localhost", "[::1]"].includes(endpoint.hostname)) {
    throw new Error("HF_VOXCPM2_ENDPOINT must remain on loopback");
  }
  if (endpoint.pathname !== "/" || endpoint.search || endpoint.hash) {
    throw new Error("HF_VOXCPM2_ENDPOINT must contain only scheme, loopback host, and port");
  }
  return endpoint;
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function probeServer(endpoint) {
  try {
    const response = await fetchWithTimeout(
      new URL("/v1/audio/speech/models", endpoint),
      {},
      1500,
    );
    if (!response.ok) return { reachable: true, ready: false, detail: `HTTP ${response.status}` };
    const payload = await response.json();
    const ready = Array.isArray(payload?.data) && payload.data.some((model) => model?.id === "voxcpm");
    return { reachable: true, ready, detail: ready ? null : "model list does not contain voxcpm" };
  } catch {
    return { reachable: false, ready: false, detail: "connection unavailable" };
  }
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise((done) => child.once("exit", done));
  child.kill();
  await Promise.race([exited, delay(5000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function startServer({ executable, endpoint, baseLm, acoustic, stateDir }) {
  const logBase = join(stateDir, "server-cpu");
  const stdoutFd = openSync(`${logBase}.stdout.log`, "a");
  const stderrFd = openSync(`${logBase}.stderr.log`, "a");
  const threads = Math.max(1, numberFromEnv("HF_VOXCPM2_THREADS", Math.min(8, cpus().length)));
  const args = [
    "--voxcpm2-base-lm",
    baseLm,
    "--voxcpm2-acoustic",
    acoustic,
    "--voxcpm2-n-gpu-layers",
    "0",
    "--host",
    endpoint.hostname === "[::1]" ? "::1" : endpoint.hostname,
    "--port",
    endpoint.port || "80",
    "--threads",
    String(threads),
    "--threads-http",
    "1",
  ];
  let spawnError = null;
  let child;
  try {
    child = spawn(executable, args, {
      cwd: stateDir,
      windowsHide: true,
      stdio: ["ignore", stdoutFd, stderrFd],
    });
    child.once("error", (error) => {
      spawnError = error;
    });
  } finally {
    closeSync(stdoutFd);
    closeSync(stderrFd);
  }

  const timeoutMs = Math.max(1000, numberFromEnv("HF_VOXCPM2_STARTUP_TIMEOUT_MS", 180000));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (spawnError) throw spawnError;
    if (child.exitCode !== null) {
      throw new Error(`CPU server exited with status ${child.exitCode}; log: ${logBase}.stderr.log`);
    }
    const probe = await probeServer(endpoint);
    if (probe.ready) return child;
    if (probe.reachable) {
      await stopChild(child);
      throw new Error(`endpoint became incompatible: ${probe.detail}`);
    }
    await delay(500);
  }
  await stopChild(child);
  throw new Error(`CPU server startup exceeded ${timeoutMs}ms; log: ${logBase}.stderr.log`);
}

async function ensureServer() {
  const endpoint = localEndpoint();
  const existing = await probeServer(endpoint);
  if (existing.ready) return { endpoint };
  if (existing.reachable) {
    throw new Error(`HF_VOXCPM2_ENDPOINT is occupied by an incompatible service: ${existing.detail}`);
  }
  if (!requiredLauncherInputs()) {
    throw new Error(
      "VoxCPM2 server is offline and launcher paths are incomplete (HF_VOXCPM2_BASE_LM, HF_VOXCPM2_ACOUSTIC, and HF_VOXCPM2_SERVER_CPU are required)",
    );
  }

  const baseLm = resolve(process.env.HF_VOXCPM2_BASE_LM);
  const acoustic = resolve(process.env.HF_VOXCPM2_ACOUSTIC);
  const stateDir = resolve(process.env.HF_VOXCPM2_STATE_DIR || join(tmpdir(), "hyperframes-voxcpm2"));
  mkdirSync(stateDir, { recursive: true });
  const cpuServer = process.env.HF_VOXCPM2_SERVER_CPU;
  console.error("· voxcpm2: starting CPU server");
  launchedServer = await startServer({
    executable: resolve(cpuServer),
    endpoint,
    baseLm,
    acoustic,
    stateDir,
  });
  return { endpoint };
}

async function activeServer() {
  if (!serverPromise) serverPromise = ensureServer();
  try {
    return await serverPromise;
  } catch (error) {
    serverPromise = null;
    throw error;
  }
}

export async function shutdownVoxCPM2Server() {
  const child = launchedServer;
  launchedServer = null;
  serverPromise = null;
  await stopChild(child);
}

process.once("exit", () => {
  if (launchedServer?.exitCode === null) launchedServer.kill();
});

function validWav(bytes) {
  return (
    bytes.length > 44 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WAVE"
  );
}

async function synthesizeVoxCPM2Impl({ text, voiceId, lang, speed, wavAbs, hyperframesDir }) {
  try {
    if (Number(speed) !== 1) {
      return { ok: false, words: [], error: "VoxCPM2 currently supports speed=1 only" };
    }
    const referencePath = resolveVoxCPM2Reference(voiceId);
    const reference = referencePath ? readFileSync(referencePath) : null;
    if (reference && !validWav(reference)) {
      return { ok: false, words: [], error: `VoxCPM2 reference is not a WAV: ${referencePath}` };
    }
    const params = {
      seed: numberFromEnv("HF_VOXCPM2_SEED", 42),
      cfg_value: numberFromEnv("HF_VOXCPM2_CFG_VALUE", 2),
      inference_timesteps: numberFromEnv("HF_VOXCPM2_INFERENCE_TIMESTEPS", 10),
      max_steps: numberFromEnv("HF_VOXCPM2_MAX_STEPS", 200),
      temperature: numberFromEnv("HF_VOXCPM2_TEMPERATURE", 1),
    };
    const cacheIdentity = JSON.stringify({
      schema: 2,
      runtime: RUNTIME_COMMIT,
      model_id: process.env.HF_VOXCPM2_MODEL_ID || `DennisHuang648/VoxCPM2-GGUF@${MODEL_REVISION}`,
      voice: reference
        ? { mode: "reference", sha256: createHash("sha256").update(reference).digest("hex") }
        : { mode: "design", description: DEFAULT_VOICE_DESIGN },
      text,
      lang,
      speed,
      params,
    });
    const cacheKey = createHash("sha256").update(cacheIdentity).digest("hex");
    const cacheDir = resolve(
      process.env.HF_VOXCPM2_CACHE_DIR || join(hyperframesDir, ".media", "cache", "voxcpm2"),
    );
    const cachedWav = join(cacheDir, `${cacheKey}.wav`);
    if (existsSync(cachedWav)) {
      const cached = readFileSync(cachedWav);
      if (validWav(cached)) {
        mkdirSync(dirname(wavAbs), { recursive: true });
        copyFileSync(cachedWav, wavAbs);
        return { ok: true, words: [] };
      }
      rmSync(cachedWav, { force: true });
    }

    const { endpoint } = await activeServer();
    const body = {
      model: "voxcpm2",
      input: reference ? text : `(${DEFAULT_VOICE_DESIGN})${text}`,
      voice: reference ? "reference" : "default",
      response_format: "wav",
      ...params,
    };
    if (reference) body.reference_audio = reference.toString("base64");
    const response = await fetchWithTimeout(
      new URL("/v1/audio/speech", endpoint),
      { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
      Math.max(1000, numberFromEnv("HF_VOXCPM2_SYNTH_TIMEOUT_MS", 900000)),
    );
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) {
      return {
        ok: false,
        words: [],
        error: `VoxCPM2 HTTP ${response.status}: ${bytes.toString("utf8").slice(0, 500)}`,
      };
    }
    if (!validWav(bytes)) return { ok: false, words: [], error: "VoxCPM2 returned an invalid WAV" };

    mkdirSync(cacheDir, { recursive: true });
    const temporary = `${cachedWav}.${process.pid}.tmp`;
    writeFileSync(temporary, bytes);
    try {
      renameSync(temporary, cachedWav);
    } catch (error) {
      rmSync(temporary, { force: true });
      if (!existsSync(cachedWav)) throw error;
    }
    mkdirSync(dirname(wavAbs), { recursive: true });
    copyFileSync(cachedWav, wavAbs);
    return { ok: true, words: [] };
  } catch (error) {
    return { ok: false, words: [], error: error?.message ? String(error.message) : String(error) };
  }
}

export function synthesizeVoxCPM2(args) {
  const current = synthesisQueue.then(() => synthesizeVoxCPM2Impl(args));
  synthesisQueue = current.catch(() => {});
  return current;
}
