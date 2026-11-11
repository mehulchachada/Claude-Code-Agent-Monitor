/**
 * @file external-runs.js
 * @description Storage and identity helpers for external agent runs: work done
 * by an agent the dashboard does not natively integrate with (typically a local
 * model driven by the user's own harness), filed either under the session that
 * orchestrated it or as a standalone session.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

/*
 * An "external run" is work done by an agent the dashboard does not natively
 * integrate with - typically a local model (Ollama, llama.cpp, ...) driven by
 * the user's own harness. The harness reports the run over HTTP
 * (`POST /api/hooks/external-run`, see `routes/external-runs.js`) and the
 * dashboard files it in one of two places:
 *
 *   - child:      under the session that orchestrated it, as a subagent. This
 *                 is the normal case when a Claude Code / Codex session hands
 *                 work to a local model.
 *   - standalone: as its own session, when nothing orchestrated it (or the
 *                 orchestrating session is not known to this dashboard).
 *
 * Conversations for external runs are stored by the dashboard itself, as
 * Claude-style JSONL under `<data dir>/external-transcripts/<session id>/`.
 * The harness sends message lines; it never hands the dashboard a file path,
 * so this feature cannot be used to make the dashboard read arbitrary files,
 * and nothing is written into the CLI's own transcript directories.
 */

const fs = require("fs");
const path = require("path");
const { v5: uuidv5 } = require("uuid");
const { getDataDir } = require("./claude-home");

/** Subagent type stamped on every external run filed under a parent session. */
const EXTERNAL_SUBAGENT_TYPE = "external";

/** Namespace for deriving a stable standalone session id from a run id. */
const EXTERNAL_RUN_NAMESPACE = "6f1c6b0e-6a55-5a51-9d0e-2f5b1f0a9c11";

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SAFE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;

/** A run id becomes part of an agent id and a file name, so keep it boring. */
function isValidRunId(runId) {
  return typeof runId === "string" && RUN_ID_RE.test(runId) && !runId.includes("..");
}

/** Session and agent ids reach the file system here; reject anything path-like. */
function isSafeId(id) {
  return typeof id === "string" && SAFE_ID_RE.test(id) && !id.includes("..");
}

/** Agent row id for a run filed under a parent session. */
function externalAgentId(runId) {
  return `ext-${runId}`;
}

/** Stable session id for a standalone run (same run id -> same session). */
function externalSessionId(runId) {
  return uuidv5(`external-run:${runId}`, EXTERNAL_RUN_NAMESPACE);
}

function getExternalTranscriptDir() {
  return path.join(getDataDir(), "external-transcripts");
}

/**
 * Path of the stored conversation for a session's main agent (`agentId` empty
 * or "main") or for one external agent. Returns null for unsafe ids.
 */
function externalTranscriptFile(sessionId, agentId) {
  if (!isSafeId(sessionId)) return null;
  const name = !agentId || agentId === "main" ? "main" : agentId;
  if (!isSafeId(name)) return null;
  return path.join(getExternalTranscriptDir(), sessionId, `${name}.jsonl`);
}

/** Same as externalTranscriptFile, but only when the file exists. */
function findExternalTranscript(sessionId, agentId) {
  const file = externalTranscriptFile(sessionId, agentId);
  try {
    return file && fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/** Ids of the external agents that have a stored conversation in this session. */
function listExternalAgentTranscripts(sessionId) {
  if (!isSafeId(sessionId)) return [];
  try {
    return fs
      .readdirSync(path.join(getExternalTranscriptDir(), sessionId))
      .filter((f) => f.endsWith(".jsonl") && f !== "main.jsonl")
      .map((f) => f.slice(0, -".jsonl".length))
      .filter(isSafeId);
  } catch {
    return [];
  }
}

/**
 * Append already-normalised transcript lines (plain objects) to a stored
 * conversation. Returns the number of lines written.
 */
function appendExternalTranscript(sessionId, agentId, lines) {
  const file = externalTranscriptFile(sessionId, agentId);
  if (!file || !Array.isArray(lines) || lines.length === 0) return 0;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf8");
  return lines.length;
}

/** Parse the `external` block out of a session's or agent's metadata JSON. */
function readExternalMeta(metadata) {
  if (!metadata) return null;
  try {
    const parsed = typeof metadata === "string" ? JSON.parse(metadata) : metadata;
    return parsed && typeof parsed.external === "object" && parsed.external
      ? parsed.external
      : null;
  } catch {
    return null;
  }
}

module.exports = {
  EXTERNAL_SUBAGENT_TYPE,
  appendExternalTranscript,
  externalAgentId,
  externalSessionId,
  externalTranscriptFile,
  findExternalTranscript,
  getExternalTranscriptDir,
  isSafeId,
  isValidRunId,
  listExternalAgentTranscripts,
  readExternalMeta,
};
