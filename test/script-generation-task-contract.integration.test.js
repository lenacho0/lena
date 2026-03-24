import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const BATCH_ID = "00000000-0000-0000-0000-000000000001";

function buildUrl(path) {
  return `http://localhost${path}`;
}

async function clearScriptGenerationTasks(batchId) {
  await prisma.generationTask.deleteMany({
    where: {
      batchId,
      taskType: "SCRIPT_GENERATION",
    },
  });
}

async function requestJson(method, path, body) {
  const response = await app.request(buildUrl(path), {
    method,
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  return {
    status: response.status,
    json: await response.json(),
  };
}

function assertTaskSummaryContract(task, { expectedStatus } = {}) {
  assert.ok(task);
  assert.equal(typeof task.id, "string");
  assert.equal(task.batchId, BATCH_ID);
  assert.equal(task.taskType, "SCRIPT_GENERATION");
  if (expectedStatus) {
    assert.equal(task.status, expectedStatus);
  }
  assert.ok("requestPayload" in task);
  assert.ok("resultPayload" in task);
  assert.ok("retryCount" in task);
  assert.ok("maxRetries" in task);
  assert.ok("queuedAt" in task);
  assert.ok("startedAt" in task);
  assert.ok("finishedAt" in task);
  assert.ok("createdAt" in task);
  assert.ok("updatedAt" in task);
}

function assertTaskPollingContract(task, { expectedStatus } = {}) {
  assertTaskSummaryContract(task, { expectedStatus });
  assert.ok("errorCode" in task);
  assert.ok("errorMessage" in task);
}

describe("Script Generation Task Contract", { concurrency: 1 }, () => {
  test("POST same payload returns deduplicated=true and reuses task id", async () => {
    await clearScriptGenerationTasks(BATCH_ID);

    const payload = {
      desiredCount: 2,
      priority: 120,
      maxRetries: 3,
      triggerSource: "contract_duplicate",
      requestPayload: {
        operator: "contract-suite",
      },
    };

    const first = await requestJson("POST", `/api/batches/${BATCH_ID}/script-generation-tasks`, payload);
    const second = await requestJson("POST", `/api/batches/${BATCH_ID}/script-generation-tasks`, payload);

    assert.equal(first.status, 202);
    assert.equal(first.json.data.deduplicated, false);
    assert.equal(first.json.data.executionMode, "llm_mvp");
    assertTaskSummaryContract(first.json.data.task, { expectedStatus: "QUEUED" });

    assert.equal(second.status, 202);
    assert.equal(second.json.data.deduplicated, true);
    assert.equal(second.json.data.executionMode, "llm_mvp");
    assert.equal(second.json.data.task.id, first.json.data.task.id);
    assert.equal(second.json.data.task.requestPayload.executionMode, "llm_mvp");
    assert.equal(second.json.data.task.resultPayload.workerStatus, "not_started");
    assertTaskSummaryContract(second.json.data.task, { expectedStatus: "QUEUED" });
  });

  test("POST different payload with active task returns 409 and error contract", async () => {
    await clearScriptGenerationTasks(BATCH_ID);

    const first = await requestJson("POST", `/api/batches/${BATCH_ID}/script-generation-tasks`, {
      desiredCount: 2,
      priority: 120,
      maxRetries: 3,
      triggerSource: "contract_conflict_base",
    });

    const second = await requestJson("POST", `/api/batches/${BATCH_ID}/script-generation-tasks`, {
      desiredCount: 3,
      priority: 150,
      maxRetries: 5,
      triggerSource: "contract_conflict_changed",
    });

    assert.equal(first.status, 202);
    assert.equal(second.status, 409);
    assert.deepEqual(Object.keys(second.json), ["error"]);
    assert.equal(typeof second.json.error.message, "string");
    assert.match(second.json.error.message, /active script generation task/i);

    const tasks = await prisma.generationTask.findMany({
      where: {
        batchId: BATCH_ID,
        taskType: "SCRIPT_GENERATION",
      },
    });
    assert.equal(tasks.length, 1);
  });

  test("GET /api/batches/:id task list includes polling contract fields", async () => {
    await clearScriptGenerationTasks(BATCH_ID);

    const created = await requestJson("POST", `/api/batches/${BATCH_ID}/script-generation-tasks`, {
      desiredCount: 3,
      priority: 111,
      maxRetries: 3,
      triggerSource: "contract_polling_fields",
      requestPayload: {
        operator: "contract-suite",
      },
    });

    assert.equal(created.status, 202);
    const taskId = created.json.data.task.id;

    const detail = await requestJson("GET", `/api/batches/${BATCH_ID}`);
    assert.equal(detail.status, 200);

    const task = detail.json.data.tasks.find((item) => item.id === taskId);
    assertTaskPollingContract(task, { expectedStatus: "QUEUED" });
    assert.equal(task.requestPayload.executionMode, "llm_mvp");
    assert.equal(task.resultPayload.workerStatus, "not_started");
    assert.equal(task.errorCode, null);
    assert.equal(task.errorMessage, null);
  });
});

after(async () => {
  await prisma.$disconnect();
});
