/**
 * @file external-run.test.ts
 * @description Verifies that the external-run block is read from session and
 * agent metadata, and that rows which are not external runs yield null.
 * @author Son Nguyen <hoangson091104@gmail.com>
 */
import { describe, expect, it } from "vitest";
import { externalRunInfo } from "../external-run";

describe("externalRunInfo", () => {
  it("returns null for rows that are not external runs", () => {
    expect(externalRunInfo(null)).toBeNull();
    expect(externalRunInfo("")).toBeNull();
    expect(externalRunInfo("not json")).toBeNull();
    expect(externalRunInfo(JSON.stringify({ model: "claude-opus-5-5" }))).toBeNull();
    expect(externalRunInfo(JSON.stringify({ external: { provider: "ollama" } }))).toBeNull();
  });

  it("reads a run filed under its orchestrating session", () => {
    const info = externalRunInfo(
      JSON.stringify({
        model: "qwen3.8:27b",
        external: {
          run_id: "job-1",
          provider: "ollama",
          model: "qwen3.8:27b",
          origin: "mac",
          mode: "child",
        },
      })
    );
    expect(info).toMatchObject({
      run_id: "job-1",
      provider: "ollama",
      origin: "mac",
      mode: "child",
    });
    expect(info?.parent_session_id).toBeNull();
  });

  it("keeps the untracked parent of a standalone run and defaults the mode", () => {
    const info = externalRunInfo(
      JSON.stringify({ external: { run_id: "job-2", parent_session_id: "abc", origin: 7 } })
    );
    expect(info?.mode).toBe("standalone");
    expect(info?.parent_session_id).toBe("abc");
    expect(info?.origin).toBeNull();
  });
});
