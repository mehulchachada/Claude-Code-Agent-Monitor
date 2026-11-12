/**
 * @file external-run.ts
 * @description Reads the `external` block the server stamps on the metadata of
 * a session or agent that represents an external agent run (for example a local
 * model driven by the user's own harness), so the UI can label such runs and
 * say where they came from.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

/** Subagent type the server gives every external run filed under a session. */
export const EXTERNAL_SUBAGENT_TYPE = "external";

export interface ExternalRunStats {
  wall_s: number | null;
  turns: number | null;
  input_tokens: number | null;
  cached_input_tokens: number | null;
  output_tokens: number | null;
  tool_calls: number | null;
  checks: number | null;
}

export interface ExternalRunInfo {
  run_id: string;
  /** The larger piece of work this run is a step of, when the harness reported one. */
  group: string | null;
  /** Position of the run within its group (e.g. `"2/3"`), when reported. */
  step: string | null;
  /** Usage/timing stats the local harness reported; null for old or in-flight runs. */
  stats: ExternalRunStats | null;
  provider: string | null;
  model: string | null;
  /** Machine or tool that started the run, when the harness reported one. */
  origin: string | null;
  cwd: string | null;
  /** `child`: filed under its orchestrating session. `standalone`: its own session. */
  mode: "child" | "standalone";
  /**
   * Set only on standalone runs: the session that started the run when that
   * session is not known to this dashboard (for example one on another machine).
   */
  parent_session_id?: string | null;
}

/** A stats field is kept only when it is a finite number >= 0; anything else is null. */
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function parseStats(raw: Record<string, unknown>): ExternalRunStats {
  return {
    wall_s: num(raw.wall_s),
    turns: num(raw.turns),
    input_tokens: num(raw.input_tokens),
    cached_input_tokens: num(raw.cached_input_tokens),
    output_tokens: num(raw.output_tokens),
    tool_calls: num(raw.tool_calls),
    checks: num(raw.checks),
  };
}

/**
 * Parse a session's or agent's metadata JSON and return its external-run
 * block, or null when the row is not an external run (or the JSON is invalid).
 */
export function externalRunInfo(metadata: string | null | undefined): ExternalRunInfo | null {
  if (!metadata) return null;
  try {
    const parsed = JSON.parse(metadata) as { external?: Partial<ExternalRunInfo> | null };
    const ext = parsed?.external;
    if (!ext || typeof ext !== "object" || typeof ext.run_id !== "string") return null;
    const rawStats = (ext as { stats?: unknown }).stats;
    return {
      run_id: ext.run_id,
      group: typeof ext.group === "string" ? ext.group : null,
      step: typeof ext.step === "string" ? ext.step : null,
      stats:
        rawStats && typeof rawStats === "object"
          ? parseStats(rawStats as Record<string, unknown>)
          : null,
      provider: typeof ext.provider === "string" ? ext.provider : null,
      model: typeof ext.model === "string" ? ext.model : null,
      origin: typeof ext.origin === "string" ? ext.origin : null,
      cwd: typeof ext.cwd === "string" ? ext.cwd : null,
      mode: ext.mode === "child" ? "child" : "standalone",
      parent_session_id: typeof ext.parent_session_id === "string" ? ext.parent_session_id : null,
    };
  } catch {
    return null;
  }
}
