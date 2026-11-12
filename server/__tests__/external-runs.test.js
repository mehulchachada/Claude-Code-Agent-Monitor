/**
 * @file external-runs.test.js
 * @description Verifies external agent runs: filed as a subagent of the
 * orchestrating session when it is known, as a standalone session otherwise,
 * with conversations stored by the dashboard and readable through the normal
 * transcript endpoints.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "ccam-external-runs-"));
process.env.CLAUDE_HOME = path.join(root, "claude");
process.env.DASHBOARD_CODEX_HOME = path.join(root, "codex");
process.env.DASHBOARD_DATA_DIR = path.join(root, "data");
process.env.DASHBOARD_DB_PATH = path.join(root, "test.db");
process.env.DASHBOARD_REMOTE_SYNC_MS = "0";

const { createApp, startServer } = require("../index");
const { db, stmts } = require("../db");
const { externalSessionId, getExternalTranscriptDir } = require("../lib/external-runs");

let server;
let base;

async function post(pathname, body) {
  const res = await fetch(base + pathname, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function get(pathname) {
  const res = await fetch(base + pathname);
  return { status: res.status, body: await res.json() };
}

const run = (body) => post("/api/hooks/external-run", body);

const turn = (text) => [
  {
    type: "assistant",
    message: {
      content: [
        { type: "thinking", thinking: "look first" },
        { type: "tool_use", id: "toolu_1", name: "read_file", input: { path: "a.md" } },
      ],
    },
  },
  {
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "toolu_1", content: text }] },
  },
];

before(async () => {
  server = await startServer(createApp(), 0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  server.closeAllConnections();
  await once(server, "close");
  db.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("external runs", () => {
  it("rejects malformed requests", async () => {
    assert.equal((await run({ event: "start" })).status, 400);
    assert.equal((await run({ run_id: "../etc", event: "start" })).status, 400);
    assert.equal((await run({ run_id: "ok-1", event: "bogus" })).status, 400);
    assert.equal((await run({ run_id: "ok-1", event: "start", transcript: "nope" })).status, 400);
    assert.equal((await get("/api/hooks/external-run/never-seen")).status, 404);
  });

  it("files a run with no orchestrator as a standalone session", async () => {
    const started = await run({
      run_id: "solo-1",
      event: "start",
      model: "qwen3.8:27b",
      provider: "ollama",
      title: "Summarise the incident",
      origin: "ally",
      cwd: "X:\\jobs\\solo-1",
      prompt: "Summarise the incident note",
      transcript: [{ type: "user", message: { content: "Summarise the incident note" } }],
    });
    assert.equal(started.status, 200);
    assert.equal(started.body.mode, "standalone");
    assert.equal(started.body.session_id, externalSessionId("solo-1"));
    assert.equal(started.body.transcript_id, "main");

    const sid = started.body.session_id;
    const session = stmts.getSession.get(sid);
    assert.equal(session.name, "Summarise the incident");
    assert.equal(session.model, "qwen3.8:27b");
    const meta = JSON.parse(session.metadata).external;
    assert.equal(meta.mode, "standalone");
    assert.equal(meta.origin, "ally");
    assert.equal(meta.parent_session_id, null);

    await run({
      run_id: "solo-1",
      event: "tool",
      phase: "pre",
      tool_name: "read_file",
      tool_input: { path: "a.md" },
    });
    const posted = await run({
      run_id: "solo-1",
      event: "tool",
      phase: "post",
      tool_name: "read_file",
      tool_input: { path: "a.md" },
      tool_response: "contents",
      transcript: turn("contents"),
    });
    assert.equal(posted.body.appended, 2);

    const list = await get(`/api/sessions/${sid}/transcripts`);
    assert.deepEqual(
      list.body.transcripts.map((t) => t.id),
      ["main"]
    );
    const convo = await get(`/api/sessions/${sid}/transcript`);
    assert.equal(convo.status, 200);
    assert.ok(convo.body.messages.length >= 2, "conversation is readable");

    await run({ run_id: "solo-1", event: "end", status: "ok" });
    assert.equal(stmts.getSession.get(sid).status, "completed");
    const events = stmts.listEventsBySession.all(sid).map((e) => e.event_type);
    assert.ok(events.includes("PreToolUse") && events.includes("PostToolUse"));
  });

  it("files a run under the session that orchestrated it", async () => {
    const parent = "11111111-2222-4333-8444-555555555555";
    await post("/api/hooks/event", {
      hook_type: "SessionStart",
      data: { session_id: parent, cwd: "C:\\work", model: "claude-opus-5-5", source: "startup" },
    });
    const sessionsBefore = db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n;

    const started = await run({
      run_id: "child-1",
      event: "start",
      parent_session_id: parent,
      model: "qwen3.8:27b",
      title: "Draft the rules",
      prompt: "Draft the rules",
      transcript: [{ type: "user", message: { content: "Draft the rules" } }],
    });
    assert.equal(started.body.mode, "child");
    assert.equal(started.body.session_id, parent);
    assert.equal(started.body.agent_id, "ext-child-1");
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n,
      sessionsBefore,
      "no standalone session is created for an orchestrated run"
    );

    const agent = stmts.getAgent.get("ext-child-1");
    assert.equal(agent.session_id, parent);
    assert.equal(agent.type, "subagent");
    assert.equal(agent.subagent_type, "external");
    assert.equal(agent.parent_agent_id, `${parent}-main`);
    assert.equal(agent.status, "working");
    assert.equal(JSON.parse(agent.metadata).model, "qwen3.8:27b");

    // Starting twice must not duplicate the agent.
    const again = await run({ run_id: "child-1", event: "start", parent_session_id: parent });
    assert.equal(again.body.started, false);

    await run({
      run_id: "child-1",
      event: "tool",
      phase: "post",
      tool_name: "write_file",
      tool_input: { path: "out.xml" },
      tool_response: "wrote 10 chars",
      transcript: turn("wrote 10 chars"),
    });
    const toolEvent = stmts.listEventsBySession
      .all(parent)
      .find((e) => e.event_type === "PostToolUse" && e.tool_name === "write_file");
    assert.equal(
      toolEvent.agent_id,
      "ext-child-1",
      "tool events are attributed to the external agent"
    );

    // A CLI SubagentStop in the parent session must not close the external agent.
    await post("/api/hooks/event", { hook_type: "SubagentStop", data: { session_id: parent } });
    assert.equal(stmts.getAgent.get("ext-child-1").status, "working");

    const list = await get(`/api/sessions/${parent}/transcripts`);
    const entry = list.body.transcripts.find((t) => t.id === "ext-child-1");
    assert.ok(entry, "the external conversation is listed with the parent session");
    assert.equal(entry.db_agent_id, "ext-child-1");
    assert.equal(entry.subagent_type, "external");

    const convo = await get(`/api/sessions/${parent}/transcript?agent_id=ext-child-1`);
    assert.ok(convo.body.messages.length >= 2);

    await run({ run_id: "child-1", event: "end", status: "error", error: "ran out of context" });
    const ended = stmts.getAgent.get("ext-child-1");
    assert.equal(ended.status, "error");
    assert.ok(ended.ended_at);
    assert.notEqual(
      stmts.getSession.get(parent).status,
      "error",
      "the parent session is untouched"
    );

    const where = await get("/api/hooks/external-run/child-1");
    assert.deepEqual(where.body, {
      mode: "child",
      session_id: parent,
      agent_id: "ext-child-1",
      transcript_id: "ext-child-1",
    });
  });

  it("falls back to standalone when the orchestrating session is unknown here", async () => {
    const started = await run({
      run_id: "remote-1",
      event: "start",
      parent_session_id: "99999999-aaaa-4bbb-8ccc-dddddddddddd",
      model: "qwen3.8:27b",
      origin: "mac",
    });
    assert.equal(started.body.mode, "standalone");
    const meta = JSON.parse(stmts.getSession.get(started.body.session_id).metadata).external;
    assert.equal(meta.parent_session_id, "99999999-aaaa-4bbb-8ccc-dddddddddddd");
    assert.equal(meta.origin, "mac");
  });

  it("stores group, step and stats on a child run", async () => {
    const parent = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    await post("/api/hooks/event", {
      hook_type: "SessionStart",
      data: { session_id: parent, cwd: "C:\\work", model: "claude-opus-5-5", source: "startup" },
    });
    await run({
      run_id: "child-stats-1",
      event: "start",
      parent_session_id: parent,
      model: "qwen3.8:27b",
      group: "digest-v2",
      step: "1/3",
    });
    await run({
      run_id: "child-stats-1",
      event: "end",
      status: "ok",
      stats: {
        wall_s: 12.5,
        turns: 4,
        input_tokens: 1000.9,
        cached_input_tokens: 3000,
        output_tokens: 500,
        tool_calls: 7,
        checks: 2,
      },
    });
    const meta = JSON.parse(stmts.getAgent.get("ext-child-stats-1").metadata).external;
    assert.equal(meta.run_id, "child-stats-1");
    assert.equal(meta.mode, "child");
    assert.equal(meta.group, "digest-v2");
    assert.equal(meta.step, "1/3");
    assert.deepEqual(meta.stats, {
      wall_s: 12.5,
      turns: 4,
      input_tokens: 1000,
      cached_input_tokens: 3000,
      output_tokens: 500,
      tool_calls: 7,
      checks: 2,
    });
  });

  it("drops invalid stats and keeps earlier extras", async () => {
    const parent = "cccccccc-dddd-4eee-8fff-gggggggggggg";
    await post("/api/hooks/event", {
      hook_type: "SessionStart",
      data: { session_id: parent, cwd: "C:\\work", model: "claude-opus-5-5", source: "startup" },
    });
    await run({
      run_id: "child-stats-2",
      event: "start",
      parent_session_id: parent,
      group: "digest-v2",
      stats: { wall_s: -1, turns: "9", output_tokens: 5, junk: 1 },
    });
    let meta = JSON.parse(stmts.getAgent.get("ext-child-stats-2").metadata).external;
    assert.equal(meta.group, "digest-v2");
    assert.deepEqual(meta.stats, { output_tokens: 5 });

    await run({ run_id: "child-stats-2", event: "tool", phase: "pre", tool_name: "read_file" });
    meta = JSON.parse(stmts.getAgent.get("ext-child-stats-2").metadata).external;
    assert.equal(meta.group, "digest-v2", "a later event without group keeps the earlier one");

    await run({ run_id: "child-stats-2", event: "end", status: "ok", stats: [] });
    meta = JSON.parse(stmts.getAgent.get("ext-child-stats-2").metadata).external;
    assert.deepEqual(meta.stats, { output_tokens: 5 }, "stats: [] stores nothing");

    await run({ run_id: "child-stats-2", event: "end", status: "ok", stats: "x" });
    meta = JSON.parse(stmts.getAgent.get("ext-child-stats-2").metadata).external;
    assert.deepEqual(meta.stats, { output_tokens: 5 }, 'stats: "x" stores nothing');
  });

  it("stores stats on a standalone run", async () => {
    const started = await run({
      run_id: "solo-stats-1",
      event: "start",
      model: "qwen3.8:27b",
      group: "digest-v2",
      step: "2/3",
    });
    await run({
      run_id: "solo-stats-1",
      event: "end",
      status: "ok",
      stats: { wall_s: 3.25, turns: 2, output_tokens: 100 },
    });
    const meta = JSON.parse(stmts.getSession.get(started.body.session_id).metadata).external;
    assert.equal(meta.mode, "standalone");
    assert.equal(meta.group, "digest-v2");
    assert.equal(meta.step, "2/3");
    assert.deepEqual(meta.stats, { wall_s: 3.25, turns: 2, output_tokens: 100 });
  });

  it("stores conversations only inside the dashboard data directory", async () => {
    const dir = getExternalTranscriptDir();
    assert.ok(dir.startsWith(process.env.DASHBOARD_DATA_DIR));
    const files = fs
      .readdirSync(dir, { recursive: true })
      .filter((f) => String(f).endsWith(".jsonl"));
    assert.ok(files.length >= 2);
    assert.ok(
      !fs.existsSync(path.join(process.env.CLAUDE_HOME, "projects")),
      "nothing is written to the CLI home"
    );
  });
});
