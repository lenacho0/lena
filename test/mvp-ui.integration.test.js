import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

function buildUrl(path) {
  return `http://localhost${path}`;
}

describe("MVP UI integration", () => {
  test("GET /mvp returns HTML page", async () => {
    const response = await app.request(buildUrl("/mvp"));
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/html/i);
    assert.match(text, /批次脚本生成 MVP/);
    assert.match(text, /\/mvp\/app\.js/);
    assert.match(text, /id="taskHistory"/);
    assert.match(text, /id="taskHistoryFilter"/);
  });

  test("GET /mvp/styles.css returns stylesheet", async () => {
    const response = await app.request(buildUrl("/mvp/styles.css"));
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /text\/css/i);
    assert.match(text, /\.layout/);
    assert.match(text, /status-badge/);
    assert.match(text, /highlight-retrying/);
  });

  test("GET /mvp/app.js returns script", async () => {
    const response = await app.request(buildUrl("/mvp/app.js"));
    const text = await response.text();

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") || "", /javascript/i);
    assert.match(text, /loadBatches/);
    assert.match(text, /triggerScriptGeneration/);
    assert.match(text, /executionMode:\s*"llm_mvp"/);
    assert.match(text, /renderTaskHistory/);
    assert.match(text, /filterTaskHistory/);
    assert.match(text, /isRetryingTask/);
  });
});

after(async () => {
  await prisma.$disconnect();
});
