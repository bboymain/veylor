import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  VisualBenchmarkConfig,
  VisualBenchmarkManifest,
  VisualProviderMetadata,
} from "./schema";

// Private persistence for visual item-memory benchmark runs.
//
// Stage 2A stores results ONLY in a private, untracked local directory (or in
// memory during tests). The Stage 31-35 Supabase benchmark tables cannot
// represent visual results (candidate similarities, threshold sweeps,
// embedding dimensions, confusion counts), and per the stage rules no new
// migration is created without approval — so no Supabase writes of any kind
// happen here. This module intentionally reuses the fashion-scan benchmark's
// idempotency scheme (sha256 -> deterministic UUID) so both suites behave the
// same way.

const UUID_VERSION_MASK = 0x50;
const UUID_VARIANT_MASK = 0x80;

export type VisualPersistedRunState = "completed" | null;

export type VisualBenchmarkPersistence = {
  getRunStatus(runId: string): Promise<VisualPersistedRunState>;
  saveRun(runId: string, payload: unknown): Promise<void>;
};

export type VisualPersistenceOutcome = {
  runId: string;
  idempotencyKey: string;
  dryRun: boolean;
  writesPerformed: number;
  alreadyCompleted: boolean;
};

function stableRunInput(
  manifest: VisualBenchmarkManifest,
  metadata: VisualProviderMetadata,
  config: VisualBenchmarkConfig,
  explicitKey?: string,
): string {
  if (explicitKey?.trim()) return `explicit:${explicitKey.trim()}`;
  return JSON.stringify({
    manifest: manifest.name,
    version: manifest.version,
    provider: metadata.provider.trim(),
    model: metadata.model.trim(),
    modelVersion: metadata.modelVersion.trim(),
    embeddingDimension: metadata.embeddingDimension,
    topK: config.topK,
    thresholds: config.thresholds,
    cases: manifest.cases.map((benchmarkCase) => benchmarkCase.id).sort(),
  });
}

/**
 * Stable run identity: the same manifest + provider + configuration always
 * produces the same idempotency key and run id, so duplicate submissions are
 * detected instead of recorded twice.
 */
export function createVisualBenchmarkIdempotency(
  manifest: VisualBenchmarkManifest,
  metadata: VisualProviderMetadata,
  config: VisualBenchmarkConfig,
  explicitKey?: string,
): { idempotencyKey: string; runId: string } {
  const digest = createHash("sha256")
    .update(stableRunInput(manifest, metadata, config, explicitKey))
    .digest();
  const idempotencyKey = digest.toString("hex");
  const uuidBytes = Buffer.from(digest.subarray(0, 16));
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | UUID_VERSION_MASK;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | UUID_VARIANT_MASK;
  const hex = uuidBytes.toString("hex");
  const runId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { idempotencyKey, runId };
}

export async function persistVisualBenchmarkRun(
  manifest: VisualBenchmarkManifest,
  metadata: VisualProviderMetadata,
  config: VisualBenchmarkConfig,
  payload: unknown,
  persistence: VisualBenchmarkPersistence,
  options: { dryRun: boolean; idempotencyKey?: string },
): Promise<VisualPersistenceOutcome> {
  if (!metadata.provider.trim() || !metadata.model.trim() || !metadata.modelVersion.trim()) {
    throw new Error("Provider, model, and model version metadata are required.");
  }
  const identity = createVisualBenchmarkIdempotency(
    manifest,
    metadata,
    config,
    options.idempotencyKey,
  );
  if (options.dryRun) {
    return { ...identity, dryRun: true, writesPerformed: 0, alreadyCompleted: false };
  }

  const existing = await persistence.getRunStatus(identity.runId);
  if (existing === "completed") {
    return { ...identity, dryRun: false, writesPerformed: 0, alreadyCompleted: true };
  }
  await persistence.saveRun(identity.runId, payload);
  return { ...identity, dryRun: false, writesPerformed: 1, alreadyCompleted: false };
}

/** In-memory persistence used by automated tests. Counts every write. */
export class InMemoryVisualBenchmarkPersistence implements VisualBenchmarkPersistence {
  readonly saved = new Map<string, unknown>();
  writeCalls = 0;
  statusCalls = 0;

  getRunStatus(runId: string): Promise<VisualPersistedRunState> {
    this.statusCalls += 1;
    return Promise.resolve(this.saved.has(runId) ? "completed" : null);
  }

  saveRun(runId: string, payload: unknown): Promise<void> {
    this.writeCalls += 1;
    this.saved.set(runId, payload);
    return Promise.resolve();
  }
}

const RUN_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Local JSON persistence writing one `<runId>.json` per run inside a private,
 * untracked results directory. Run ids are strictly validated so file names
 * can never traverse outside the base directory.
 */
export class LocalJsonVisualBenchmarkPersistence implements VisualBenchmarkPersistence {
  private readonly baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = resolve(baseDir);
  }

  private runPath(runId: string): string {
    if (!RUN_ID_PATTERN.test(runId)) {
      throw new Error("Run ids must be lowercase UUIDs.");
    }
    return join(this.baseDir, `${runId}.json`);
  }

  getRunStatus(runId: string): Promise<VisualPersistedRunState> {
    return Promise.resolve(existsSync(this.runPath(runId)) ? "completed" : null);
  }

  saveRun(runId: string, payload: unknown): Promise<void> {
    const path = this.runPath(runId);
    mkdirSync(this.baseDir, { recursive: true });
    writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return Promise.resolve();
  }

  readRun(runId: string): unknown {
    return JSON.parse(readFileSync(this.runPath(runId), "utf8")) as unknown;
  }
}
