import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  resolveVoxCPM2Reference,
  resolveVoxCPM2VoiceDesign,
  resolveVoxCPM2WorkerPlan,
  shutdownVoxCPM2Server,
  synthesizeVoxCPM2,
  voxcpm2Available,
} from "../src/voxcpm2.mjs";

const ENV_KEYS = [
  "HF_VOXCPM2_ENDPOINT",
  "HF_VOXCPM2_REFERENCE_AUDIO",
  "HF_VOXCPM2_CACHE_DIR",
  "HF_VOXCPM2_MODEL_ID",
  "HF_VOXCPM2_INFERENCE_TIMESTEPS",
  "HF_VOXCPM2_MAX_STEPS",
  "HF_VOXCPM2_THREADS",
  "HF_VOXCPM2_WORKERS",
];

function wavBytes(payload = "voice") {
  const data = Buffer.from(payload);
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(48000, 24);
  wav.writeUInt32LE(96000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
}

function preserveEnvironment() {
  const saved = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));
  return () => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

async function startFakeServer({ responseDelayMs = 0 } = {}) {
  let posts = 0;
  let active = 0;
  let maximumActive = 0;
  const requests = [];
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/v1/audio/speech/models") {
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify({ data: [{ id: "voxcpm" }] }));
      return;
    }
    if (request.method === "POST" && request.url === "/v1/audio/speech") {
      posts += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      requests.push(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (responseDelayMs) await new Promise((done) => setTimeout(done, responseDelayMs));
      active -= 1;
      response.setHeader("content-type", "audio/wav");
      response.end(wavBytes(`voice-${posts}`));
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  return {
    endpoint: `http://127.0.0.1:${port}`,
    posts: () => posts,
    requests: () => requests,
    maximumActive: () => maximumActive,
    close: async () => {
      server.close();
      await once(server, "close");
    },
  };
}

test("availability requires a complete launcher or endpoint without a reference voice", () => {
  const paths = new Set(["reference.wav", "base.gguf", "acoustic.gguf", "cpu.exe"]);
  const exists = (path) => paths.has(path);
  assert.equal(voxcpm2Available({}, exists), false);
  assert.equal(
    voxcpm2Available(
      {
        HF_VOXCPM2_BASE_LM: "base.gguf",
        HF_VOXCPM2_ACOUSTIC: "acoustic.gguf",
        HF_VOXCPM2_SERVER_CPU: "cpu.exe",
      },
      exists,
    ),
    true,
  );
  assert.equal(
    voxcpm2Available({ HF_VOXCPM2_ENDPOINT: "http://127.0.0.1:1" }, exists),
    true,
  );
});

test("worker plan selects the bounded resource-aware default and honors safe overrides", () => {
  const gib = 1024 ** 3;
  assert.deepEqual(
    resolveVoxCPM2WorkerPlan({}, { logicalProcessors: 16, totalMemoryBytes: 32 * gib }),
    { workers: 2, threadsPerWorker: 6 },
  );
  assert.deepEqual(
    resolveVoxCPM2WorkerPlan({}, { logicalProcessors: 8, totalMemoryBytes: 32 * gib }),
    { workers: 1, threadsPerWorker: 8 },
  );
  assert.deepEqual(
    resolveVoxCPM2WorkerPlan({}, { logicalProcessors: 16, totalMemoryBytes: 16 * gib }),
    { workers: 1, threadsPerWorker: 8 },
  );
  assert.deepEqual(
    resolveVoxCPM2WorkerPlan(
      { HF_VOXCPM2_WORKERS: "2", HF_VOXCPM2_THREADS: "4" },
      { logicalProcessors: 8, totalMemoryBytes: 16 * gib },
    ),
    { workers: 2, threadsPerWorker: 4 },
  );
  assert.throws(
    () =>
      resolveVoxCPM2WorkerPlan(
        { HF_VOXCPM2_ENDPOINT: "http://127.0.0.1:18765", HF_VOXCPM2_WORKERS: "2" },
        { logicalProcessors: 16, totalMemoryBytes: 32 * gib },
      ),
    /requires provider-managed local servers/,
  );
  assert.throws(
    () =>
      resolveVoxCPM2WorkerPlan(
        { HF_VOXCPM2_WORKERS: "2", HF_VOXCPM2_THREADS: "9" },
        { logicalProcessors: 16, totalMemoryBytes: 32 * gib },
      ),
    /must not exceed logical CPUs/,
  );
});

test("reference resolution accepts one configured default and validates an explicit WAV", () => {
  assert.equal(resolveVoxCPM2Reference(null, () => false), null);
  assert.equal(
    resolveVoxCPM2Reference(null, (path) => path === "default.wav", "default.wav"),
    resolve("default.wav"),
  );
  assert.match(resolveVoxCPM2VoiceDesign(null), /natural conversational pace/);
  assert.equal(resolveVoxCPM2VoiceDesign("  A brighter narrator.  "), "A brighter narrator.");
  assert.throws(() => resolveVoxCPM2VoiceDesign("  "), /nonempty string/);
  assert.throws(
    () => resolveVoxCPM2Reference("missing.wav", () => false),
    /must select an existing reference WAV/,
  );
});

test("default synthesis clones the configured narrator reference", async () => {
  const restore = preserveEnvironment();
  const root = mkdtempSync(join(tmpdir(), "voxcpm2-design-test-"));
  const server = await startFakeServer();
  try {
    process.env.HF_VOXCPM2_ENDPOINT = server.endpoint;
    const reference = join(root, "herdr-narrator-de.wav");
    writeFileSync(reference, wavBytes("selected narrator"));
    process.env.HF_VOXCPM2_REFERENCE_AUDIO = reference;
    process.env.HF_VOXCPM2_CACHE_DIR = join(root, "cache");
    process.env.HF_VOXCPM2_MODEL_ID = "design-fixture-model";

    const result = await synthesizeVoxCPM2({
      text: "Explain the isolated workspace.",
      voiceId: null,
      lang: "en",
      speed: 1,
      wavAbs: join(root, "design.wav"),
      hyperframesDir: root,
    });

    assert.deepEqual(result, { ok: true, words: [] });
    assert.equal(server.posts(), 1);
    const [request] = server.requests();
    assert.equal(request.voice, "reference");
    assert.equal(typeof request.reference_audio, "string");
    assert.equal(request.input, "Explain the isolated workspace.");
  } finally {
    await shutdownVoxCPM2Server();
    await server.close();
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("an explicit Voice Design overrides the default and owns its cache identity", async () => {
  const restore = preserveEnvironment();
  const root = mkdtempSync(join(tmpdir(), "voxcpm2-design-override-test-"));
  const server = await startFakeServer();
  try {
    process.env.HF_VOXCPM2_ENDPOINT = server.endpoint;
    process.env.HF_VOXCPM2_CACHE_DIR = join(root, "cache");
    process.env.HF_VOXCPM2_MODEL_ID = "design-override-fixture-model";
    const reference = join(root, "herdr-narrator-de.wav");
    writeFileSync(reference, wavBytes("selected narrator"));
    process.env.HF_VOXCPM2_REFERENCE_AUDIO = reference;
    const common = {
      text: "Compare this sentence.",
      voiceId: null,
      lang: "en",
      speed: 1,
      hyperframesDir: root,
    };

    const custom = await synthesizeVoxCPM2({
      ...common,
      voiceDesign: "A concise, energetic technical narrator.",
      wavAbs: join(root, "custom.wav"),
    });
    const fallback = await synthesizeVoxCPM2({ ...common, wavAbs: join(root, "default.wav") });

    assert.equal(custom.ok, true);
    assert.equal(fallback.ok, true);
    assert.equal(server.posts(), 2);
    assert.match(server.requests()[0].input, /^\(A concise, energetic technical narrator\.\)/);
    assert.equal("reference_audio" in server.requests()[0], false);
    assert.equal(server.requests()[1].input, "Compare this sentence.");
    assert.equal(typeof server.requests()[1].reference_audio, "string");
  } finally {
    await shutdownVoxCPM2Server();
    await server.close();
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("synthesis returns words empty and reuses the deterministic WAV cache", async () => {
  const restore = preserveEnvironment();
  const root = mkdtempSync(join(tmpdir(), "voxcpm2-test-"));
  const server = await startFakeServer();
  try {
    const reference = join(root, "reference.wav");
    const first = join(root, "first.wav");
    const second = join(root, "second.wav");
    writeFileSync(reference, wavBytes("reference"));
    process.env.HF_VOXCPM2_ENDPOINT = server.endpoint;
    process.env.HF_VOXCPM2_CACHE_DIR = join(root, "cache");
    process.env.HF_VOXCPM2_MODEL_ID = "fixture-model";

    const request = {
      text: "Cache this sentence.",
      voiceId: reference,
      lang: "en",
      speed: 1,
      hyperframesDir: root,
    };
    const firstResult = await synthesizeVoxCPM2({ ...request, wavAbs: first });
    const secondResult = await synthesizeVoxCPM2({ ...request, wavAbs: second });

    assert.deepEqual(firstResult, { ok: true, words: [] });
    assert.deepEqual(secondResult, { ok: true, words: [] });
    assert.equal(server.posts(), 1);
    assert.equal(typeof server.requests()[0].reference_audio, "string");
    assert.equal(server.requests()[0].input, request.text);
    assert.deepEqual(readFileSync(second), readFileSync(first));
    const ambiguous = await synthesizeVoxCPM2({
      ...request,
      voiceDesign: "A conflicting design.",
      wavAbs: join(root, "ambiguous.wav"),
    });
    assert.equal(ambiguous.ok, false);
    assert.match(ambiguous.error, /mutually exclusive/);
    assert.equal(server.posts(), 1);
  } finally {
    await shutdownVoxCPM2Server();
    await server.close();
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("one external endpoint keeps concurrent caller work serialized", async () => {
  const restore = preserveEnvironment();
  const root = mkdtempSync(join(tmpdir(), "voxcpm2-serial-test-"));
  const server = await startFakeServer({ responseDelayMs: 40 });
  try {
    const reference = join(root, "reference.wav");
    writeFileSync(reference, wavBytes("reference"));
    process.env.HF_VOXCPM2_ENDPOINT = server.endpoint;
    process.env.HF_VOXCPM2_CACHE_DIR = join(root, "cache");
    process.env.HF_VOXCPM2_MODEL_ID = "serial-fixture-model";

    const common = { voiceId: reference, lang: "en", speed: 1, hyperframesDir: root };
    const results = await Promise.all([
      synthesizeVoxCPM2({ ...common, text: "First.", wavAbs: join(root, "first.wav") }),
      synthesizeVoxCPM2({ ...common, text: "Second.", wavAbs: join(root, "second.wav") }),
    ]);
    assert.equal(results.every((result) => result.ok), true);
    assert.equal(server.posts(), 2);
    assert.equal(server.maximumActive(), 1);
  } finally {
    await shutdownVoxCPM2Server();
    await server.close();
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});

test("non-loopback synthesis endpoints are rejected before sending voice data", async () => {
  const restore = preserveEnvironment();
  const root = mkdtempSync(join(tmpdir(), "voxcpm2-loopback-test-"));
  try {
    const reference = join(root, "reference.wav");
    writeFileSync(reference, wavBytes("reference"));
    process.env.HF_VOXCPM2_ENDPOINT = "https://example.com";
    process.env.HF_VOXCPM2_CACHE_DIR = join(root, "cache");
    process.env.HF_VOXCPM2_MODEL_ID = "loopback-fixture-model";
    const result = await synthesizeVoxCPM2({
      text: "Do not send this.",
      voiceId: reference,
      lang: "en",
      speed: 1,
      wavAbs: join(root, "out.wav"),
      hyperframesDir: root,
    });
    assert.equal(result.ok, false);
    assert.match(result.error, /must use http|must remain on loopback/);
  } finally {
    await shutdownVoxCPM2Server();
    restore();
    rmSync(root, { recursive: true, force: true });
  }
});
