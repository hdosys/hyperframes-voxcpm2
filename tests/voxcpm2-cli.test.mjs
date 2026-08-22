import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import test from "node:test";
import { parseVoxCPM2CLIArguments } from "../src/voxcpm2-cli.mjs";

test("CLI maps one design or reference selection into the provider contract", () => {
  const cwd = join("workspace", "voice-tests");
  assert.deepEqual(
    parseVoxCPM2CLIArguments(
      [
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
