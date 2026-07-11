import type { BenchmarkManifest, CaseBenchmarkResult } from "./schema";
import type { BenchmarkPersistence, PersistedRunState } from "./persistence";

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type SupabaseServerCredentials = {
  url: string;
  serviceRoleKey: string;
};

function requiredServerValue(name: "SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY"): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for benchmark persistence.`);
  return value;
}

export function loadSupabaseServerCredentials(): SupabaseServerCredentials {
  return {
    url: requiredServerValue("SUPABASE_URL").replace(/\/$/, ""),
    serviceRoleKey: requiredServerValue("SUPABASE_SERVICE_ROLE_KEY"),
  };
}

function failureCode(result: CaseBenchmarkResult): string | null {
  if (result.status === "scored") return null;
  return result.status === "invalid_output" ? "invalid_output" : "provider_error";
}

export class SupabaseBenchmarkPersistence implements BenchmarkPersistence {
  constructor(
    private readonly credentials: SupabaseServerCredentials,
    private readonly fetchImpl: FetchLike = fetch,
  ) {
    if (!credentials.url.startsWith("https://")) throw new Error("SUPABASE_URL must use HTTPS.");
    if (!credentials.serviceRoleKey.trim())
      throw new Error("A server-only service role key is required.");
  }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    const response = await this.fetchImpl(`${this.credentials.url}${path}`, {
      ...init,
      headers: {
        apikey: this.credentials.serviceRoleKey,
        authorization: `Bearer ${this.credentials.serviceRoleKey}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    if (!response.ok) {
      throw new Error(`Supabase benchmark persistence failed (${response.status}).`);
    }
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  }

  private async rpc(name: string, body: Record<string, unknown>): Promise<unknown> {
    return this.request(`/rest/v1/rpc/${name}`, { method: "POST", body: JSON.stringify(body) });
  }

  async ensureCases(manifest: BenchmarkManifest): Promise<void> {
    for (const benchmarkCase of manifest.cases) {
      const accepted = await this.rpc("upsert_fashion_benchmark_case", {
        p_case_id: benchmarkCase.id,
        p_image_storage_path: benchmarkCase.imagePath,
        p_expected_items: benchmarkCase.expectedItems,
        p_notes: benchmarkCase.description ?? null,
        p_active: true,
      });
      if (accepted !== true) throw new Error("Supabase rejected a private benchmark case.");
    }
  }

  async getRunStatus(runId: string): Promise<PersistedRunState | null> {
    const value = await this.request(
      `/rest/v1/fashion_benchmark_runs?id=eq.${encodeURIComponent(runId)}&select=status&limit=1`,
      { method: "GET" },
    );
    if (!Array.isArray(value) || value.length === 0) return null;
    const status = (value[0] as { status?: unknown }).status;
    return status === "running" || status === "completed" || status === "failed" ? status : null;
  }

  async startRun(input: Parameters<BenchmarkPersistence["startRun"]>[0]): Promise<void> {
    await this.request("/rest/v1/fashion_benchmark_runs?on_conflict=id", {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({
        id: input.runId,
        provider: input.metadata.provider,
        model: input.metadata.model,
        status: "running",
        case_count: input.caseCount,
        started_at: input.startedAt,
      }),
    });
  }

  async recordResult(runId: string, result: CaseBenchmarkResult): Promise<void> {
    const scores = result.fieldScores;
    const accepted = await this.rpc("record_fashion_benchmark_result", {
      p_run_id: runId,
      p_case_id: result.caseId,
      p_status: result.status === "scored" ? "completed" : "failed",
      p_category_score: scores?.category ?? null,
      p_color_score: scores?.colors ?? null,
      p_pattern_score: scores?.pattern ?? null,
      p_material_score: scores?.material ?? null,
      p_style_score: scores?.styles ?? null,
      p_visible_brand_score: scores?.visibleBrand ?? null,
      p_overall_score: result.overallScore,
      p_response_time_ms: result.responseTimeMs,
      p_invalid_json: result.status === "invalid_output",
      p_hallucinated_brand: scores?.brandHallucination === 0,
      p_failure_code: failureCode(result),
    });
    if (accepted !== true) throw new Error("Supabase rejected a benchmark case result.");
  }

  async completeRun(runId: string): Promise<void> {
    const accepted = await this.rpc("complete_fashion_benchmark_run", { p_run_id: runId });
    if (accepted !== true) throw new Error("Supabase rejected benchmark run completion.");
  }
}
