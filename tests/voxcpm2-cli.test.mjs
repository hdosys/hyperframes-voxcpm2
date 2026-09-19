import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseVoxCPM2CLIArguments } from "../src/voxcpm2-cli.mjs";

test("CLI maps one design or reference selection into the provider contract", () => {
  const cwd = join("workspace", "voice-tests");
  assert.deepEqual(
    parseVoxCPM2CLIArguments(
      [
        "--provider", "voxcpm2",
        "--text",
        "Hello there.",
        "--output",
        "sample.wav",
        "--design",
        "  A concise narrator.  ",
        "--lang",
        "en",
      ],
      cwd,
    ),
    {
      help: false,
      provider: "voxcpm2",
      text: "Hello there.",
      output: resolve(cwd, "sample.wav"),
      voiceId: null,
      voiceDesign: "A concise narrator.",
      lang: "en",
    },
  );
  assert.throws(
    () =>
      parseVoxCPM2CLIArguments(
        [
          "--text",
          "Hello.",
          "--output",
          "sample.wav",
          "--design",
          "A narrator.",
          "--voice",
          "speaker.wav",
        ],
        cwd,
      ),
    /mutually exclusive/,
  );
  assert.throws(
    () => parseVoxCPM2CLIArguments(["--text", "Hello.", "--output", "sample.mp3"], cwd),
    /\.wav file/,
  );
});

test("CLI defaults to German Qwen and preserves explicit Supertonic presets", () => {
  const defaults = parseVoxCPM2CLIArguments(["--text", "Grüße!", "--output", "sample.wav"]);
  assert.equal(defaults.provider, "qwen3");
  assert.equal(defaults.voiceId, "ryan");
  assert.equal(defaults.lang, "de");
  for (const voice of ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"]) {
    assert.equal(parseVoxCPM2CLIArguments(["--provider", "supertonic", "--text", "Hallo", "--output", "sample.wav", "--voice", voice]).voiceId, voice);
  }
  assert.throws(() => parseVoxCPM2CLIArguments(["--text", "Hallo", "--output", "sample.wav", "--voice", "speaker.wav"]), /CustomVoice preset/);
  assert.throws(() => parseVoxCPM2CLIArguments(["--text", "Hallo", "--output", "sample.wav", "--design", "Narrator"]), /requires --provider voxcpm2/);
});
