import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";
import { shutdownVoxCPM2Server, synthesizeVoxCPM2 } from "./voxcpm2.mjs";
import { resolveSupertonicVoice, synthesizeSupertonic } from "./supertonic.mjs";
import { resolveQwen3Voice, synthesizeQwen3 } from "./qwen3.mjs";

const USAGE = `Usage:
  tts.ps1 --text TEXT --output FILE [--voice M1] [--lang de]
  tts.ps1 --text-file INPUT.txt --output FILE [--provider qwen3 | supertonic | voxcpm2]
  tts.ps1 --provider voxcpm2 --text TEXT --output FILE [--design DESCRIPTION | --voice REFERENCE.wav]

Options:
  --text TEXT          Text to synthesize.
  --text-file FILE     Read UTF-8 text instead of --text.
  --output FILE        Destination WAV file.
  --provider ENGINE    supertonic (default), qwen3 or voxcpm2.
  --design DESCRIPTION VoxCPM2 Voice Design override.
  --voice VOICE        Supertonic M1-M5/F1-F5 (default M1), Qwen preset, or VoxCPM2 WAV.
  --lang LANGUAGE      Language code (default de; VoxCPM2 default en).
  --version            Show the bundle version.
  --help               Show this help.
`;

export function parseVoxCPM2CLIArguments(argv, cwd = process.cwd()) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--version") {
      if (argv.length !== 1) throw new Error("--version accepts no other arguments");
      return { version: true };
    }
    if (token === "--help") {
      if (argv.length !== 1) throw new Error("--help accepts no other arguments");
      return { help: true };
    }
    if (!["--text", "--text-file", "--output", "--design", "--voice", "--lang", "--provider"].includes(token)) {
      throw new Error(`unknown argument: ${token}`);
    }
    if (values.has(token)) throw new Error(`duplicate argument: ${token}`);
    const value = argv[index + 1];
    if (value === undefined || !String(value).trim()) throw new Error(`${token} requires a value`);
    values.set(token, String(value).trim());
    index += 1;
  }

  if (values.has("--text") && values.has("--text-file")) throw new Error("--text and --text-file are mutually exclusive");
  const text = values.has("--text-file")
    ? readFileSync(resolve(cwd, values.get("--text-file")), "utf8").replace(/^\uFEFF/, "").trim()
    : values.get("--text");
  const output = values.get("--output");
  const design = values.get("--design");
  const voice = values.get("--voice");
  if (!text) throw new Error("--text is required");
  if (!output) throw new Error("--output is required");
  if (design && voice) throw new Error("--design and --voice are mutually exclusive");
  if (!output.toLowerCase().endsWith(".wav")) throw new Error("--output must name a .wav file");
  const provider = values.get("--provider") ?? "supertonic";
  if (!["qwen3", "supertonic", "voxcpm2"].includes(provider)) throw new Error("--provider must be qwen3, supertonic or voxcpm2");
  if (provider !== "voxcpm2" && design) throw new Error("--design requires --provider voxcpm2");

  return {
    help: false,
    provider,
    text,
    output: resolve(cwd, output),
    voiceId: provider === "qwen3" ? resolveQwen3Voice(voice) : provider === "supertonic" ? resolveSupertonicVoice(voice) : voice ? resolve(cwd, voice) : null,
    voiceDesign: design ?? null,
    lang: values.get("--lang") ?? (provider === "voxcpm2" ? "en" : "de"),
  };
}

export async function runVoxCPM2CLI(argv) {
  let options;
  try {
    options = parseVoxCPM2CLIArguments(argv);
  } catch (error) {
    console.error(`tts: ${error.message}`);
    console.error(USAGE);
    return 2;
  }
  if (options.help) {
    console.log(USAGE);
    return 0;
  }
  if (options.version) {
    console.log(JSON.parse(readFileSync(new URL("../versions.json", import.meta.url), "utf8")).releaseVersion);
    return 0;
  }

  try {
    process.env.HF_VOXCPM2_WORKERS ??= "1";
    const synthesize = options.provider === "qwen3" ? synthesizeQwen3 : options.provider === "supertonic" ? synthesizeSupertonic : synthesizeVoxCPM2;
    const result = await synthesize({
      text: options.text,
      voiceId: options.voiceId,
      voiceDesign: options.voiceDesign,
      lang: options.lang,
      speed: 1,
      wavAbs: options.output,
      hyperframesDir: process.cwd(),
    });
    if (!result.ok) {
      console.error(`tts: ${result.error || "synthesis failed"}`);
      return 1;
    }
    console.log(options.output);
    if (result.evidence) console.error(JSON.stringify(result.evidence));
    return 0;
  } finally {
    await shutdownVoxCPM2Server();
  }
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (entry === import.meta.url) process.exitCode = await runVoxCPM2CLI(process.argv.slice(2));
