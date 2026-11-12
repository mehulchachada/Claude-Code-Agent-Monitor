/**
 * @file external-runs.js
 * @description Ingestion endpoint for external agent runs (for example a local
 * model driven by the user's own harness). A run is filed as a subagent of the
 * session that orchestrated it when that session is known to this dashboard,
 * and as a standalone session otherwise. Conversations are stored by the
 * dashboard from the message lines the harness sends.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */

const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const { stmts } = require("../db");
const { broadcast } = require("../websocket");
const hooksRouter = require("./hooks");
const {
  EXTERNAL_SUBAGENT_TYPE,
  appendExternalTranscript,
  externalAgentId,
  externalSessionId,
  isSafeId,
  isValidRunId,
  readExternalMeta,
} = require("../lib/external-runs");

const router = Router();

const EVENTS = new Set(["start", "tool", "message", "end"]);
const LINE_TYPES = new Set(["user", "assistant", "system"]);
const MAX_LINES_PER_REQUEST = 500;
const MAX_EVENT_TEXT = 4000;

function bad(res, message, code = "INVALID_INPUT") {
  return res.status(400).json({ error: { code, message } });
}

function text(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

function mergeMetadata(existing, patch) {
  let current = {};
  try {
    current = existing ? JSON.parse(existing) : {};
  } catch {
    current = {};
  }
  if (!current || typeof current !== "object" || Array.isArray(current)) current = {};
  return JSON.stringify({ ...current, ...patch });
}

const STATS_KEYS = [
  "wall_s",
  "turns",
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "tool_calls",
  "checks",
];

/** Keep the finite, non-negative numbers the harness reports about a run. */
function readStats(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out = {};
  for (const key of STATS_KEYS) {
    const n = value[key];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 1e12) continue;
    out[key] = key === "wall_s" ? n : Math.floor(n);
  }
  return Object.keys(out).length ? out : null;
}

/** The optional run extras (group, step, stats) that are present and valid. */
function runExtras(body) {
  const extras = {};
  const group = text(body.group, 80);
  if (group) extras.group = group;
  const step = text(body.step, 40);
  if (step) extras.step = step;
  const stats = readStats(body.stats);
  if (stats) extras.stats = stats;
  return extras;
}

/** Merge the run extras into the external block of the rows a run lives on. */
function applyRunExtras(loc, body) {
  const extras = runExtras(body);
  if (Object.keys(extras).length === 0) return;
  const mergeRow = (kind, id) => {
    const row = kind === "agent" ? stmts.getAgent.get(id) : stmts.getSession.get(id);
    if (!row) return;
    const current = readExternalMeta(row.metadata);
    if (!current) return;
    const metadata = mergeMetadata(row.metadata, { external: { ...current, ...extras } });
    if (kind === "agent") {
      stmts.setAgentMetadata.run(metadata, id);
      broadcast("agent_updated", stmts.getAgent.get(id));
    } else {
      stmts.setSessionMetadata.run(metadata, id);
      broadcast("session_updated", stmts.getSession.get(id));
    }
  };
  if (loc.mode === "child") {
    mergeRow("agent", loc.agentId);
  } else {
    mergeRow("session", loc.sessionId);
    mergeRow("agent", loc.agentId);
  }
}

/** Where a run already lives, or null when this dashboard has not seen it. */
function locateRun(runId) {
  const agent = stmts.getAgent.get(externalAgentId(runId));
  if (agent && readExternalMeta(agent.metadata)) {
    return {
      mode: "child",
      sessionId: agent.session_id,
      agentId: agent.id,
      transcriptId: agent.id,
    };
  }
  const sessionId = externalSessionId(runId);
  if (stmts.getSession.get(sessionId)) {
    return { mode: "standalone", sessionId, agentId: `${sessionId}-main`, transcriptId: "main" };
  }
  return null;
}

function describeRun(body) {
  const model = text(body.model, 120);
  const provider = text(body.provider, 60);
  const title = text(body.title, 200);
  return {
    runId: body.run_id,
    model,
    provider,
    origin: text(body.origin, 80),
    cwd: text(body.cwd, 500),
    prompt: text(body.prompt, 20000),
    name: title || (model ? `${model} run` : `External run ${body.run_id}`),
  };
}

/** Record one event against the external agent of a parent session. */
function recordChildEvent(loc, eventType, toolName, summary, data) {
  stmts.insertEvent.run(
    loc.sessionId,
    loc.agentId,
    eventType,
    toolName,
    summary,
    data ? JSON.stringify(data) : null
  );
  broadcast("new_event", {
    session_id: loc.sessionId,
    agent_id: loc.agentId,
    event_type: eventType,
    tool_name: toolName,
    summary,
    created_at: new Date().toISOString(),
  });
}

function startRun(body) {
  const run = describeRun(body);
  const parentId = isSafeId(body.parent_session_id) ? body.parent_session_id : null;
  const parent = parentId ? stmts.getSession.get(parentId) : null;
  const external = {
    run_id: run.runId,
    provider: run.provider,
    model: run.model,
    origin: run.origin,
    cwd: run.cwd,
  };

  if (parent) {
    // Filed under the orchestrating session, as a child of its main agent.
    const agentId = externalAgentId(run.runId);
    const mainAgent = stmts.getAgent.get(`${parent.id}-main`);
    stmts.insertAgent.run(
      agentId,
      parent.id,
      run.name.slice(0, 120),
      "subagent",
      EXTERNAL_SUBAGENT_TYPE,
      "working",
      run.prompt ? run.prompt.slice(0, 500) : null,
      mainAgent ? mainAgent.id : null,
      JSON.stringify({ model: run.model, external: { ...external, mode: "child" } })
    );
    broadcast("agent_created", stmts.getAgent.get(agentId));
    const loc = { mode: "child", sessionId: parent.id, agentId, transcriptId: agentId };
    recordChildEvent(loc, "Notification", null, `External run started: ${run.name}`, {
      message: `External run started: ${run.name}`,
      external_run_id: run.runId,
      model: run.model,
      origin: run.origin,
    });
    return loc;
  }

  // Nothing here orchestrated it: its own session. An unresolved parent id is
  // kept so the UI can say where the run was started from.
  const sessionId = externalSessionId(run.runId);
  const base = { session_id: sessionId, cwd: run.cwd, model: run.model };
  hooksRouter.processEvent("SessionStart", { ...base, source: "startup", session_name: run.name });
  if (run.prompt) hooksRouter.processEvent("UserPromptSubmit", { ...base, prompt: run.prompt });
  const meta = { ...external, mode: "standalone", parent_session_id: parentId };
  const session = stmts.getSession.get(sessionId);
  stmts.setSessionMetadata.run(mergeMetadata(session.metadata, { external: meta }), sessionId);
  const mainAgentId = `${sessionId}-main`;
  const mainAgent = stmts.getAgent.get(mainAgentId);
  if (mainAgent) {
    stmts.setAgentMetadata.run(
      mergeMetadata(mainAgent.metadata, { model: run.model, external: meta }),
      mainAgentId
    );
    broadcast("agent_updated", stmts.getAgent.get(mainAgentId));
  }
  broadcast("session_updated", stmts.getSession.get(sessionId));
  return { mode: "standalone", sessionId, agentId: mainAgentId, transcriptId: "main" };
}

function toolEvent(loc, body) {
  const toolName = text(body.tool_name, 120) || "tool";
  const post = body.phase !== "pre";
  const data = {
    tool_name: toolName,
    tool_input: body.tool_input && typeof body.tool_input === "object" ? body.tool_input : {},
  };
  if (post) {
    data.tool_response =
      typeof body.tool_response === "string" ? body.tool_response.slice(0, MAX_EVENT_TEXT) : null;
    if (body.is_error) data.is_error = true;
  }
  if (loc.mode === "standalone") {
    hooksRouter.processEvent(post ? "PostToolUse" : "PreToolUse", {
      session_id: loc.sessionId,
      ...data,
    });
    return;
  }
  const agent = stmts.getAgent.get(loc.agentId);
  // The parent session's own lifecycle sweeps may have closed this agent while
  // the run was still going; a fresh event proves it is alive.
  if (agent && agent.status !== "working") stmts.reactivateAgent.run(loc.agentId);
  stmts.updateAgent.run(null, "working", null, post ? null : toolName, null, null, loc.agentId);
  broadcast("agent_updated", stmts.getAgent.get(loc.agentId));
  recordChildEvent(
    loc,
    post ? "PostToolUse" : "PreToolUse",
    toolName,
    post ? `Tool completed: ${toolName}` : `Using tool: ${toolName}`,
    { ...data, external_run_id: body.run_id }
  );
}

function endRun(loc, body) {
  const failed = body.status === "error";
  const error = text(body.error, 500);
  if (loc.mode === "standalone") {
    const base = { session_id: loc.sessionId };
    hooksRouter.processEvent("Stop", { ...base, stop_reason: failed ? "error" : "end_turn" });
    hooksRouter.processEvent("SessionEnd", { ...base, reason: "other" });
    if (failed) {
      stmts.updateSession.run(null, "error", null, null, loc.sessionId);
      stmts.updateAgent.run(null, "error", null, null, null, null, loc.agentId);
      broadcast("agent_updated", stmts.getAgent.get(loc.agentId));
      broadcast("session_updated", stmts.getSession.get(loc.sessionId));
    }
    return;
  }
  const agent = stmts.getAgent.get(loc.agentId);
  stmts.updateAgent.run(
    null,
    failed ? "error" : "completed",
    null,
    null,
    new Date().toISOString(),
    null,
    loc.agentId
  );
  broadcast("agent_updated", stmts.getAgent.get(loc.agentId));
  const name = agent ? agent.name : body.run_id;
  recordChildEvent(
    loc,
    "SubagentStop",
    null,
    failed ? `External run failed: ${name}` : `External run completed: ${name}`,
    { external_run_id: body.run_id, status: failed ? "error" : "ok", error }
  );
}

/** Turn harness-supplied message lines into stored transcript lines. */
function normaliseLines(lines, loc, run) {
  const out = [];
  let previous = null;
  for (const line of lines) {
    if (!line || typeof line !== "object" || !LINE_TYPES.has(line.type)) continue;
    const message = line.message && typeof line.message === "object" ? { ...line.message } : null;
    if (line.type !== "system" && !message) continue;
    if (message) {
      message.role = line.type === "assistant" ? "assistant" : "user";
      if (line.type === "assistant" && !message.model && run.model) message.model = run.model;
    }
    const ts = typeof line.timestamp === "string" && !Number.isNaN(Date.parse(line.timestamp));
    const uuid = isSafeId(line.uuid) ? line.uuid : uuidv4();
    const entry = {
      type: line.type,
      uuid,
      parentUuid: previous,
      timestamp: ts ? new Date(line.timestamp).toISOString() : new Date().toISOString(),
      sessionId: loc.sessionId,
      isSidechain: loc.mode === "child",
      userType: "external",
      version: "external-run",
    };
    if (run.cwd) entry.cwd = run.cwd;
    if (message) entry.message = message;
    if (line.type === "system" && typeof line.content === "string") entry.content = line.content;
    out.push(entry);
    previous = uuid;
  }
  return out;
}

/**
 * POST /api/hooks/external-run
 * Body: { run_id, event: "start"|"tool"|"message"|"end", parent_session_id?,
 *         model?, provider?, title?, origin?, cwd?, prompt?,
 *         phase?, tool_name?, tool_input?, tool_response?, is_error?,
 *         status?, error?, transcript?: object[],
 *         group?, step?, stats?: object }
 */
router.post("/", (req, res) => {
  const body = req.body || {};
  if (!isValidRunId(body.run_id)) {
    return bad(res, "run_id is required: letters, digits, dot, underscore and dash, at most 80");
  }
  if (!EVENTS.has(body.event)) {
    return bad(res, "event must be one of: start, tool, message, end");
  }
  if (body.transcript !== undefined && !Array.isArray(body.transcript)) {
    return bad(res, "transcript must be an array of message lines");
  }
  if (Array.isArray(body.transcript) && body.transcript.length > MAX_LINES_PER_REQUEST) {
    return bad(res, `transcript accepts at most ${MAX_LINES_PER_REQUEST} lines per request`);
  }

  try {
    // A harness that attaches late (or whose start call was lost) still gets a
    // run: any event for an unknown run starts it first.
    let loc = locateRun(body.run_id);
    const started = !loc;
    if (!loc) loc = startRun(body);

    if (body.event === "tool") toolEvent(loc, body);
    if (body.event === "end") endRun(loc, body);
    applyRunExtras(loc, body);

    let appended = 0;
    if (Array.isArray(body.transcript) && body.transcript.length) {
      appended = appendExternalTranscript(
        loc.sessionId,
        loc.transcriptId,
        normaliseLines(body.transcript, loc, describeRun(body))
      );
    }

    return res.json({
      ok: true,
      started,
      mode: loc.mode,
      session_id: loc.sessionId,
      agent_id: loc.agentId,
      transcript_id: loc.transcriptId,
      appended,
    });
  } catch (err) {
    console.error(`[EXTERNAL-RUN] ${body.run_id}: ${err && err.message ? err.message : err}`);
    return res
      .status(500)
      .json({ error: { code: "INTERNAL_ERROR", message: "Failed to record the external run" } });
  }
});

/** GET /api/hooks/external-run/:runId - where a run was filed. */
router.get("/:runId", (req, res) => {
  if (!isValidRunId(req.params.runId)) return bad(res, "invalid run id");
  const loc = locateRun(req.params.runId);
  if (!loc) {
    return res
      .status(404)
      .json({ error: { code: "NOT_FOUND", message: "External run not found" } });
  }
  return res.json({
    mode: loc.mode,
    session_id: loc.sessionId,
    agent_id: loc.agentId,
    transcript_id: loc.transcriptId,
  });
});

module.exports = router;
