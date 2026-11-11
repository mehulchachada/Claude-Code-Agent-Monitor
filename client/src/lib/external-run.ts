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

export interface ExternalRunInfo {
  run_id: string;
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
    return {
      run_id: ext.run_id,
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
