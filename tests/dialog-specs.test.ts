import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { buildBot } from "../src/bot";
import { formatSuiteResult, parseBotSpecs, runSpecs } from "../src/toolkit/harness/run-specs";
import { resetStore } from "../src/store";

// THE PUBLISH GATE replays every tests/specs/*.json against your built bot via the
// toolkit harness, and fails the build on any mismatch. This test runs the SAME
// replay locally so `npm test` catches handler-reply-vs-spec drift BEFORE the gate
// does — the single most common reason a green build still fails to publish.
//
// If this fails, a handler's reply text doesn't match its spec's expected text:
// the report names the spec + the exact step + expected-vs-actual call. Make one
// match the other. (Do NOT delete this file — it is your local mirror of the gate.)
//
// The persistent store (note/invite IDs) is a module-level singleton. Specs within
// a single JSON file are designed to run sequentially with a shared store (e.g.
// hardcoded note IDs like note:edit:7 assume the first 6 notes were created by
// earlier specs in the SAME file). Reset the store before EACH file so IDs always
// start fresh, matching the per-file isolation in handler-loader.test.ts.
const SPECS_DIR = join(process.cwd(), "tests", "specs");

describe("dialog specs (the publish gate replays these)", () => {
  it("every tests/specs/*.json spec passes against the real bot", async () => {
    if (!existsSync(SPECS_DIR)) return; // no specs authored yet
    const files = readdirSync(SPECS_DIR).filter((f) => f.endsWith(".json"));
    if (files.length === 0) return;
    let totalFailed = 0;
    const lines: string[] = [];
    for (const file of files.sort()) {
      resetStore();
      const specs = parseBotSpecs(JSON.parse(readFileSync(join(SPECS_DIR, file), "utf8")));
      const suite = await runSpecs(() => buildBot("123456:TEST"), specs);
      totalFailed += suite.failed;
      lines.push(formatSuiteResult(suite));
    }
    expect(totalFailed, "\n" + lines.join("\n")).toBe(0);
  });
});
