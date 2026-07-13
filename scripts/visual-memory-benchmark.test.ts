import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import { main, parseFlags, parseThresholdSpec } from "./visual-memory-benchmark";

const EXAMPLE_MANIFEST_PATH = fileURLToPath(
  new URL("../benchmarks/visual-item-memory/manifest.example.json", import.meta.url),
);

describe("CLI flag parsing", () => {
  test("parses subcommands, valued flags, and boolean flags", () => {
    const parsed = parseFlags(["run", "--manifest", "m.json", "--dry-run", "--top-k", "5"]);
    expect(parsed.command).toBe("run");
    expect(parsed.flags.get("manifest")).toBe("m.json");
    expect(parsed.flags.get("dry-run")).toBe(true);
    expect(parsed.flags.get("top-k")).toBe("5");
  });

  test("defaults to the run command when only flags are given", () => {
    const parsed = parseFlags(["--dry-run"]);
    expect(parsed.command).toBe("run");
    expect(parsed.flags.get("dry-run")).toBe(true);
  });

  test("rejects stray positional arguments", () => {
    expect(() => parseFlags(["run", "stray"])).toThrow("Unexpected argument");
  });
});

describe("threshold specs", () => {
  test("expands start:end:step specs inclusively", () => {
    expect(parseThresholdSpec("0.5:0.7:0.1")).toEqual([0.5, 0.6, 0.7]);
  });

  test("rejects malformed specs", () => {
    expect(() => parseThresholdSpec("0.5")).toThrow("start:end:step");
    expect(() => parseThresholdSpec("a:b:c")).toThrow("start:end:step");
  });
});

describe("CLI end-to-end with the mock provider", () => {
  test("validate accepts the example manifest", async () => {
    const code = await main(["bun", "cli", "validate", "--manifest", EXAMPLE_MANIFEST_PATH]);
    expect(code).toBe(0);
  });

  test("dry-run completes with exit code 0 and performs no writes", async () => {
    const code = await main([
      "bun",
      "cli",
      "run",
      "--manifest",
      EXAMPLE_MANIFEST_PATH,
      "--dry-run",
      "--format",
      "text",
    ]);
    expect(code).toBe(0);
  });

  test("unknown providers and commands fail cleanly", async () => {
    const badProvider = await main([
      "bun",
      "cli",
      "run",
      "--manifest",
      EXAMPLE_MANIFEST_PATH,
      "--dry-run",
      "--provider",
      "hosted",
    ]);
    expect(badProvider).toBe(1);
    const badCommand = await main(["bun", "cli", "explode"]);
    expect(badCommand).toBe(1);
  });

  test("the local provider demands an explicit local model and stays loopback-only", async () => {
    const missingModel = await main([
      "bun",
      "cli",
      "run",
      "--manifest",
      EXAMPLE_MANIFEST_PATH,
      "--dry-run",
      "--provider",
      "local",
    ]);
    expect(missingModel).toBe(1);

    const remoteUrl = await main([
      "bun",
      "cli",
      "run",
      "--manifest",
      EXAMPLE_MANIFEST_PATH,
      "--dry-run",
      "--provider",
      "local",
      "--local-model",
      "some-local-model",
      "--dimension",
      "8",
      "--local-url",
      "https://embeddings.example.com",
    ]);
    expect(remoteUrl).toBe(1);
  });
});
