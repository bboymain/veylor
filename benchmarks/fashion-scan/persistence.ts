import { createHash } from "node:crypto";
import type {
  BenchmarkManifest,
  BenchmarkProviderMetadata,
  BenchmarkRunResult,
  CaseBenchmarkResult,
} from "./schema";

const UUID_VERSION_MASK = 0x50;
const UUID_VARIANT_MASK = 0x80;

export type PersistedRunState = "running" | "completed" | "failed";

export type BenchmarkPersistence = {
  ensureCases(manifest: BenchmarkManifest): Promise<void>;
  getRunStatus(runId: string): Promise<PersistedRunState | null>;
  startRun(input: {
    runId: string;
    metadata: BenchmarkProviderMetadata;
    caseCount: number;
    startedAt: string;
  }): Promise<void>;
  recordResult(runId: string, result: CaseBenchmarkResult): Promise<void>;
  completeRun(runId: string): Promise<void>;
};

export type PersistenceOutcome = {
  runId: string;
  idempotencyKey: string;
  dryRun: boolean;
  writesPerformed: number;
  alreadyCompleted: boolean;
};

function stableRunInput(
  manifest: BenchmarkManifest,
  metadata: BenchmarkProviderMetadata,
  explicitKey?: string,
): string {
  if (explicitKey?.trim()) return `explicit:${explicitKey.trim()}`;
  return JSON.stringify({
    manifest: manifest.name,
    version: manifest.version,
    provider: metadata.provider.trim(),
    model: metadata.model.trim(),
    cases: manifest.cases.map((benchmarkCase) => benchmarkCase.id).sort(),
  });
}

export function createBenchmarkIdempotency(
  manifest: BenchmarkManifest,
  metadata: BenchmarkProviderMetadata,
  explicitKey?: string,
): { idempotencyKey: string; runId: string } {
  const digest = createHash("sha256")
    .update(stableRunInput(manifest, metadata, explicitKey))
    .digest();
  const idempotencyKey = digest.toString("hex");
  const uuidBytes = Buffer.from(digest.subarray(0, 16));
  uuidBytes[6] = (uuidBytes[6] & 0x0f) | UUID_VERSION_MASK;
  uuidBytes[8] = (uuidBytes[8] & 0x3f) | UUID_VARIANT_MASK;
  const hex = uuidBytes.toString("hex");
  const runId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return { idempotencyKey, runId };
}

export async function persistBenchmarkRun(
  manifest: BenchmarkManifest,
  metadata: BenchmarkProviderMetadata,
  run: BenchmarkRunResult,
  persistence: BenchmarkPersistence,
  options: { dryRun: boolean; idempotencyKey?: string },
): Promise<PersistenceOutcome> {
  const provider = metadata.provider.trim();
  const model = metadata.model.trim();
  if (!provider || !model) throw new Error("Provider and model metadata are required.");

  const identity = createBenchmarkIdempotency(
    manifest,
    { provider, model },
    options.idempotencyKey,
  );
  if (options.dryRun) {
    return { ...identity, dryRun: true, writesPerformed: 0, alreadyCompleted: false };
  }

  await persistence.ensureCases(manifest);
  let writesPerformed = 1;
  const existingStatus = await persistence.getRunStatus(identity.runId);
  if (existingStatus === "completed") {
    return { ...identity, dryRun: false, writesPerformed, alreadyCompleted: true };
  }

  if (existingStatus === null) {
    await persistence.startRun({
      runId: identity.runId,
      metadata: { provider, model },
      caseCount: manifest.cases.length,
      startedAt: run.startedAt,
    });
    writesPerformed += 1;
  }

  for (const result of run.caseResults) {
    await persistence.recordResult(identity.runId, result);
    writesPerformed += 1;
  }
  await persistence.completeRun(identity.runId);
  writesPerformed += 1;

  return { ...identity, dryRun: false, writesPerformed, alreadyCompleted: false };
}
