import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { app } from "../src/app.js";
import { prisma } from "../src/lib/prisma.js";

const BATCH_ID = "00000000-0000-0000-0000-000000000001";
const REFERENCE_VIDEO_ID = "00000000-0000-0000-0000-000000000101";

function buildUrl(path) {
  return `http://localhost${path}`;
}

function assertScriptTaskContract(task, { batchId, expectedStatus, expectErrorFields = false } = {}) {
  assert.ok(task);
  assert.equal(typeof task.id, "string");
  assert.equal(task.taskType, "SCRIPT_GENERATION");

  if (batchId) {
    assert.equal(task.batchId, batchId);
  }

  if (expectedStatus) {
    assert.equal(task.status, expectedStatus);
  }

  assert.ok("requestPayload" in task);
  assert.ok("resultPayload" in task);
  if (expectErrorFields) {
    assert.ok("errorCode" in task);
    assert.ok("errorMessage" in task);
  }
  assert.ok("retryCount" in task);
  assert.ok("maxRetries" in task);
  assert.ok("queuedAt" in task);
  assert.ok("startedAt" in task);
  assert.ok("finishedAt" in task);
  assert.ok("createdAt" in task);
  assert.ok("updatedAt" in task);
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

describe("Batches API integration", { concurrency: 1 }, () => {
  test("PATCH /api/batches/:id updates batch fields", async () => {
    const { status, json } = await requestJson("PATCH", `/api/batches/${BATCH_ID}`, {
      name: "测试批次-PATCH",
      description: "integration test patch",
      status: "scripts_ready",
      scriptTargetCount: 11,
      settings: {
        testFlag: "patch-ok",
      },
      productProfile: {
        productSummary: "integration test summary",
        notes: "integration-note",
      },
    });

    assert.equal(status, 200);
    assert.equal(json.data.id, BATCH_ID);
    assert.equal(json.data.name, "测试批次-PATCH");
    assert.equal(json.data.scriptTargetCount, 11);
    assert.equal(json.data.status, "SCRIPTS_READY");
    assert.equal(json.data.settings.testFlag, "patch-ok");
    assert.equal(json.data.productProfile.productSummary, "integration test summary");
  });

  test("PATCH /api/batches/:id rejects empty updates", async () => {
    const { status, json } = await requestJson("PATCH", `/api/batches/${BATCH_ID}`, {});

    assert.equal(status, 400);
    assert.equal(json.error.message, "No updatable fields were provided.");
  });

  test("POST /api/batches/:id/reference-videos/select updates selected reference", async () => {
    const { status, json } = await requestJson(
      "POST",
      `/api/batches/${BATCH_ID}/reference-videos/select`,
      {
        referenceVideoId: REFERENCE_VIDEO_ID,
        querySnapshot: {
          keyword: "integration-test",
          sortBy: "play_count_desc",
        },
        notes: "integration-select",
      },
    );

    assert.equal(status, 200);
    assert.equal(json.data.id, BATCH_ID);
    const selected = json.data.referenceVideos.find((item) => item.isSelected);
    assert.ok(selected);
    assert.equal(selected.referenceVideo.id, REFERENCE_VIDEO_ID);
    assert.equal(selected.notes, "integration-select");
    assert.equal(selected.querySnapshot.keyword, "integration-test");
  });

  test("POST /api/batches/:id/script-generation-tasks creates queued task", async () => {
    await clearScriptGenerationTasks(BATCH_ID);

    const { status, json } = await requestJson(
      "POST",
      `/api/batches/${BATCH_ID}/script-generation-tasks`,
      {
        desiredCount: 2,
        priority: 123,
        maxRetries: 3,
        triggerSource: "integration_test",
        requestPayload: {
          operator: "node-test",
        },
      },
    );

    assert.equal(status, 202);
    assert.equal(json.data.batch.id, BATCH_ID);
    assert.equal(json.data.batch.status, "GENERATING_SCRIPTS");
    assert.equal(json.data.task.status, "QUEUED");
    assert.equal(json.data.task.priority, 123);
    assert.equal(json.data.executionMode, "llm_mvp");
    assert.equal(json.data.deduplicated, false);
    assert.equal(json.data.task.requestPayload.executionMode, "llm_mvp");
    assert.equal(json.data.task.resultPayload.workerStatus, "not_started");
    assertScriptTaskContract(json.data.task, {
      batchId: BATCH_ID,
      expectedStatus: "QUEUED",
    });

    const dbTask = await prisma.generationTask.findUnique({
      where: {
        id: json.data.task.id,
      },
    });

    assert.ok(dbTask);
    assert.equal(dbTask.status, "QUEUED");
    assert.equal(dbTask.taskType, "SCRIPT_GENERATION");
    assert.equal(dbTask.requestPayload.desiredCount, 2);
    assert.equal(dbTask.requestPayload.triggerSource, "integration_test");
  });

  test("GET /api/batches/:id exposes task polling contract fields", async () => {
    await clearScriptGenerationTasks(BATCH_ID);

    const created = await requestJson("POST", `/api/batches/${BATCH_ID}/script-generation-tasks`, {
      desiredCount: 3,
      priority: 111,
      maxRetries: 3,
      triggerSource: "integration_task_contract",
      requestPayload: {
        operator: "contract-test",
      },
    });

    assert.equal(created.status, 202);
    const taskId = created.json.data.task.id;

    const detail = await requestJson("GET", `/api/batches/${BATCH_ID}`);
    assert.equal(detail.status, 200);

    const task = detail.json.data.tasks.find((item) => item.id === taskId);
    assert.ok(task);
    assert.equal(task.batchId, BATCH_ID);
    assert.equal(task.taskType, "SCRIPT_GENERATION");
    assert.equal(task.status, "QUEUED");
    assert.equal(task.errorCode, null);
    assert.equal(task.errorMessage, null);
    assert.equal(task.requestPayload.executionMode, "llm_mvp");
    assert.equal(task.resultPayload.workerStatus, "not_started");
    assert.ok(task.createdAt);
    assert.ok(task.updatedAt);
  });

  test("POST /api/batches/:id/script-generation-tasks reuses the active task for duplicate requests", async () => {
    await clearScriptGenerationTasks(BATCH_ID);

    const payload = {
      desiredCount: 2,
      priority: 123,
      maxRetries: 3,
      triggerSource: "integration_test_duplicate",
      requestPayload: {
        operator: "node-test",
      },
    };

    const firstResponse = await requestJson(
      "POST",
      `/api/batches/${BATCH_ID}/script-generation-tasks`,
      payload,
    );
    const secondResponse = await requestJson(
      "POST",
      `/api/batches/${BATCH_ID}/script-generation-tasks`,
      payload,
    );

    assert.equal(firstResponse.status, 202);
    assert.equal(firstResponse.json.data.deduplicated, false);
    assert.equal(secondResponse.status, 202);
    assert.equal(secondResponse.json.data.deduplicated, true);
    assert.equal(secondResponse.json.data.executionMode, "llm_mvp");
    assert.equal(secondResponse.json.data.task.id, firstResponse.json.data.task.id);
    assert.equal(secondResponse.json.data.task.batchId, BATCH_ID);
    assert.equal(secondResponse.json.data.task.status, "QUEUED");
    assert.equal(secondResponse.json.data.task.requestPayload.desiredCount, 2);
    assert.equal(
      secondResponse.json.data.task.requestPayload.triggerSource,
      "integration_test_duplicate",
    );
    assert.equal(secondResponse.json.data.task.requestPayload.executionMode, "llm_mvp");
    assert.equal(secondResponse.json.data.task.resultPayload.workerStatus, "not_started");
    assertScriptTaskContract(secondResponse.json.data.task, {
      batchId: BATCH_ID,
      expectedStatus: "QUEUED",
    });

    const tasks = await prisma.generationTask.findMany({
      where: {
        batchId: BATCH_ID,
        taskType: "SCRIPT_GENERATION",
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    assert.equal(tasks.length, 1);
  });

  test("POST /api/batches/:id/script-generation-tasks rejects a different payload when an active task already exists", async () => {
    await clearScriptGenerationTasks(BATCH_ID);

    const firstResponse = await requestJson(
      "POST",
      `/api/batches/${BATCH_ID}/script-generation-tasks`,
      {
        desiredCount: 2,
        priority: 123,
        maxRetries: 3,
        triggerSource: "integration_test_conflict",
      },
    );

    const secondResponse = await requestJson(
      "POST",
      `/api/batches/${BATCH_ID}/script-generation-tasks`,
      {
        desiredCount: 3,
        priority: 456,
        maxRetries: 5,
        triggerSource: "integration_test_conflict_changed",
      },
    );

    assert.equal(firstResponse.status, 202);
    assert.equal(secondResponse.status, 409);
    assert.deepEqual(Object.keys(secondResponse.json), ["error"]);
    assert.equal(typeof secondResponse.json.error.message, "string");
    assert.match(secondResponse.json.error.message, /active script generation task/i);

    const tasks = await prisma.generationTask.findMany({
      where: {
        batchId: BATCH_ID,
        taskType: "SCRIPT_GENERATION",
      },
    });
    assert.equal(tasks.length, 1);
  });
});

after(async () => {
  await prisma.$disconnect();
});
