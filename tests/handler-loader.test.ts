import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "node:fs";
import { buildBot } from "../src/bot.js";
import { runSpecs, parseBotSpec, formatSuiteResult } from "../src/toolkit/index.js";
import { resetStore } from "../src/store.js";

async function runSpecFile(name: string): Promise<void> {
  resetStore();
  const raw = JSON.parse(
    readFileSync(new URL(`./specs/${name}.json`, import.meta.url), "utf8"),
  ) as unknown[];
  const specs = raw.map(parseBotSpec);
  const suite = await runSpecs(() => buildBot("test-token"), specs);
  if (suite.failed > 0) {
    console.error(formatSuiteResult(suite));
  }
  expect(suite.failed).toBe(0);
}

describe("buildBot handler loader", () => {
  it("loads src/handlers/start.ts so /start replies via the harness", async () => {
    const raw = JSON.parse(
      readFileSync(new URL("./specs/start.json", import.meta.url), "utf8"),
    ) as unknown[];
    const specs = raw.map(parseBotSpec);
    const suite = await runSpecs(() => buildBot("test-token"), specs);
    expect(suite.failed).toBe(0);
    expect(suite.passed).toBeGreaterThan(0);
  });

  it("unknown input falls through to the global fallback", async () => {
    const suite = await runSpecs(() => buildBot("test-token"), [
      parseBotSpec({
        name: "unknown text hits the fallback",
        steps: [
          { send: { text: "qwerty" },
            expect: [{ method: "sendMessage", payload: { text: "Sorry, I didn't understand that. Try /help." } }] },
        ],
      }),
    ]);
    expect(suite.failed).toBe(0);
  });

  it("loads notes handler specs", async () => {
    await runSpecFile("notes");
  });

  it("loads invite handler specs", async () => {
    await runSpecFile("invite");
  });

  it("loads members handler specs", async () => {
    await runSpecFile("members");
  });
});