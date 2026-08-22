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
import { cpus, tmpdir, totalmem } from "node:os";
import { dirname, join, resolve } from "node:path";

const RUNTIME_COMMIT = "09f5c3f1b484759f17b06fc63574f749c89c8761";
const MODEL_REVISION = "169f64d8b98bbaab1761e4ca3a83e6af653456cc";
const DEFAULT_ENDPOINT = "http://127.0.0.1:18765";
const DEFAULT_VOICE_DESIGN =
  "A deep, calm adult male narrator with a warm, grounded tone, speaking at a natural " +
  "conversational pace with brief pauses. Clear, confident software tutorial delivery, " +
  "focused and reassuring.";

let poolPromise = null;
let launchedServers = [];
let workerQueues = [];
let nextWorker = 0;

const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const numberFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? value : fallback;
};

function integerFromEnv(env, name, fallback, minimum, maximum) {
  if (env[name] === undefined || env[name] === "") return fallback;
  const value = Number(env[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} through ${maximum}`);
  }
  return value;
}

export function resolveVoxCPM2WorkerPlan(
  env = process.env,
  system = { logicalProcessors: cpus().length, totalMemoryBytes: totalmem() },
) {
  const logicalProcessors = Math.max(1, Math.floor(Number(system.logicalProcessors) || 1));
  const totalMemoryBytes = Math.max(0, Number(system.totalMemoryBytes) || 0);
  const canUseTwoWorkers =
    !env.HF_VOXCPM2_ENDPOINT && logicalProcessors >= 12 && totalMemoryBytes >= 24 * 1024 ** 3;
  const workers = integerFromEnv(env, "HF_VOXCPM2_WORKERS", canUseTwoWorkers ? 2 : 1, 1, 2);
  if (workers > 1 && env.HF_VOXCPM2_ENDPOINT) {
    throw new Error("HF_VOXCPM2_WORKERS=2 requires provider-managed local servers");
  }
  const automaticThreads =
    workers === 2
      ? Math.min(6, Math.max(1, Math.floor(logicalProcessors / workers)))
      : Math.min(8, logicalProcessors);
  const threadsPerWorker = integerFromEnv(
    env,
    "HF_VOXCPM2_THREADS",
    automaticThreads,
    1,
    logicalProcessors,
  );
  if (workers * threadsPerWorker > logicalProcessors) {
    throw new Error("HF_VOXCPM2_WORKERS multiplied by HF_VOXCPM2_THREADS must not exceed logical CPUs");
  }
  return { workers, threadsPerWorker };
}

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

export function resolveVoxCPM2Reference(userVoice, pathExists = existsSync, defaultVoice = null) {
  const selectedVoice = userVoice || defaultVoice;
  if (!selectedVoice) return null;
  if (!pathExists(selectedVoice)) {
    throw new Error("VoxCPM2 --voice must select an existing reference WAV");
  }
  return resolve(selectedVoice);
}

export function resolveVoxCPM2VoiceDesign(userDesign) {
  if (userDesign === undefined || userDesign === null) return DEFAULT_VOICE_DESIGN;
  if (typeof userDesign !== "string" || !userDesign.trim()) {
    throw new Error("VoxCPM2 Voice Design must be a nonempty string");
  }
  return userDesign.trim();
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

function workerEndpoint(baseEndpoint, index) {
  if (index === 0) return baseEndpoint;
  const endpoint = new URL(baseEndpoint);
  const port = Number(endpoint.port || 80) + index;
  if (port > 65535) throw new Error("VoxCPM2 worker pool exceeds the TCP port range");
  endpoint.port = String(port);
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

async function startServer({ executable, endpoint, baseLm, acoustic, stateDir, threads, workerIndex }) {
  const logBase = join(stateDir, workerIndex === 0 ? "server-cpu" : `server-cpu-${workerIndex + 1}`);
  const stdoutFd = openSync(`${logBase}.stdout.log`, "a");
  const stderrFd = openSync(`${logBase}.stderr.log`, "a");
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

async function ensureWorker(endpoint, workerIndex, plan, launcher) {
  const existing = await probeServer(endpoint);
  if (existing.ready) return { endpoint, child: null, workerIndex };
  if (existing.reachable) {
    throw new Error(`HF_VOXCPM2_ENDPOINT is occupied by an incompatible service: ${existing.detail}`);
  }
  if (!launcher) {
    throw new Error(
      "VoxCPM2 server is offline and launcher paths are incomplete (HF_VOXCPM2_BASE_LM, HF_VOXCPM2_ACOUSTIC, and HF_VOXCPM2_SERVER_CPU are required)",
    );
  }

  console.error(`· voxcpm2: starting CPU worker ${workerIndex + 1}/${plan.workers}`);
  const child = await startServer({
    executable: launcher.executable,
    endpoint,
    baseLm: launcher.baseLm,
    acoustic: launcher.acoustic,
    stateDir: launcher.stateDir,
    threads: plan.threadsPerWorker,
    workerIndex,
  });
  return { endpoint, child, workerIndex };
}

async function ensurePool(plan) {
  const baseEndpoint = localEndpoint();
  const launcher = requiredLauncherInputs()
    ? {
        baseLm: resolve(process.env.HF_VOXCPM2_BASE_LM),
        acoustic: resolve(process.env.HF_VOXCPM2_ACOUSTIC),
        executable: resolve(process.env.HF_VOXCPM2_SERVER_CPU),
        stateDir: resolve(process.env.HF_VOXCPM2_STATE_DIR || join(tmpdir(), "hyperframes-voxcpm2")),
      }
    : null;
  if (launcher) mkdirSync(launcher.stateDir, { recursive: true });
  const settled = await Promise.allSettled(
    Array.from({ length: plan.workers }, (_, index) =>
      ensureWorker(workerEndpoint(baseEndpoint, index), index, plan, launcher),
    ),
  );
  const workers = settled
    .filter((result) => result.status === "fulfilled")
    .map((result) => result.value);
  const failed = settled.find((result) => result.status === "rejected");
  if (failed) {
    await Promise.all(workers.map((worker) => stopChild(worker.child)));
    throw failed.reason;
  }
  launchedServers = workers.map((worker) => worker.child).filter(Boolean);
  return workers;
}

async function activePool(plan) {
  if (!poolPromise) poolPromise = ensurePool(plan);
  try {
    return await poolPromise;
  } catch (error) {
    poolPromise = null;
    throw error;
  }
}

function runOnWorker(task) {
  const plan = resolveVoxCPM2WorkerPlan();
  if (workerQueues.length !== plan.workers) {
    workerQueues = Array.from({ length: plan.workers }, () => Promise.resolve());
    nextWorker = 0;
  }
  const workerIndex = nextWorker++ % plan.workers;
  const current = workerQueues[workerIndex].then(async () => {
    const pool = await activePool(plan);
    return task(pool[workerIndex]);
  });
  workerQueues[workerIndex] = current.catch(() => {});
  return current;
}

export async function shutdownVoxCPM2Server() {
  const children = launchedServers;
  launchedServers = [];
  poolPromise = null;
  workerQueues = [];
  nextWorker = 0;
  await Promise.all(children.map((child) => stopChild(child)));
}

process.once("exit", () => {
  for (const child of launchedServers) {
    if (child.exitCode === null) child.kill();
  }
});

function validWav(bytes) {
  return (
    bytes.length > 44 &&
    bytes.subarray(0, 4).toString("ascii") === "RIFF" &&
    bytes.subarray(8, 12).toString("ascii") === "WAVE"
  );
}

async function synthesizeVoxCPM2Impl({
  text,
  voiceId,
  voiceDesign,
  lang,
  speed,
  wavAbs,
  hyperframesDir,
}) {
  try {
    if (Number(speed) !== 1) {
      return { ok: false, words: [], error: "VoxCPM2 currently supports speed=1 only" };
    }
    const defaultReference = voiceId || (voiceDesign !== undefined && voiceDesign !== null)
      ? null
      : process.env.HF_VOXCPM2_REFERENCE_AUDIO;
    const referencePath = resolveVoxCPM2Reference(voiceId, existsSync, defaultReference);
    if (referencePath && voiceDesign !== undefined && voiceDesign !== null) {
      return { ok: false, words: [], error: "VoxCPM2 --voice and Voice Design are mutually exclusive" };
    }
    const design = referencePath ? null : resolveVoxCPM2VoiceDesign(voiceDesign);
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
        : { mode: "design", description: design },
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

    const body = {
      model: "voxcpm2",
      input: reference ? text : `(${design})${text}`,
      voice: reference ? "reference" : "default",
      response_format: "wav",
      ...params,
    };
    if (reference) body.reference_audio = reference.toString("base64");
    return await runOnWorker(async ({ endpoint, workerIndex }) => {
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
      if (!validWav(bytes)) {
        return { ok: false, words: [], error: "VoxCPM2 returned an invalid WAV" };
      }

      mkdirSync(cacheDir, { recursive: true });
      const temporary = `${cachedWav}.${process.pid}.${workerIndex}.tmp`;
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
    });
  } catch (error) {
    return { ok: false, words: [], error: error?.message ? String(error.message) : String(error) };
  }
}

export function synthesizeVoxCPM2(args) {
  return synthesizeVoxCPM2Impl(args);
}
