import assert from "node:assert/strict";
import { after, describe, test } from "node:test";
import { BatchStatus, TaskStatus, TaskType } from "@prisma/client";

import { prisma } from "../src/lib/prisma.js";
import { runScriptGenerationWorker } from "../src/workers/script-generation-worker.js";
import { QUIET_LOGGER } from "./helpers/logger.js";

const BATCH_ID = "00000000-0000-0000-0000-000000000001";
const REFERENCE_VIDEO_ID = "00000000-0000-0000-0000-000000000101";
const originalFetch = globalThis.fetch;
const originalTimeoutEnv = process.env.SCRIPT_GENERATION_TIMEOUT_MS;

async function clearActiveScriptTasks(batchId) {
  await prisma.generationTask.deleteMany({
    where: {
      batchId,
      taskType: TaskType.SCRIPT_GENERATION,
      status: {
        in: [TaskStatus.DRAFT, TaskStatus.QUEUED, TaskStatus.RUNNING],
      },
    },
  });
}

async function createQueuedScriptTask(batchId, { priority, desiredCount, triggerSource }) {
  return prisma.generationTask.create({
    data: {
      batchId,
      taskType: TaskType.SCRIPT_GENERATION,
      status: TaskStatus.QUEUED,
      priority,
      targetType: "batch",
      targetId: batchId,
      requestPayload: {
        desiredCount,
        triggerSource,
      },
      resultPayload: {
        generationMethod: "llm_mvp",
        workerStatus: "not_started",
      },
      retryCount: 0,
      maxRetries: 3,
      queuedAt: new Date(),
    },
  });
}

describe("Script generation worker integration", { concurrency: 1 }, () => {
  test("worker validates runtime config before claiming tasks", async () => {
    await clearActiveScriptTasks(BATCH_ID);

    delete process.env.SCRIPT_GENERATION_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.SCRIPT_GENERATION_PROVIDER = "openai";
    process.env.SCRIPT_GENERATION_MODEL = "test-model";
    process.env.SCRIPT_GENERATION_BASE_URL = "https://api.openai.test/v1";

    const task = await createQueuedScriptTask(BATCH_ID, {
      priority: 999,
      desiredCount: 2,
      triggerSource: "worker_runtime_config_check_test",
    });

    await assert.rejects(
      runScriptGenerationWorker({ limit: 1, log: QUIET_LOGGER }),
      /SCRIPT_GENERATION_API_KEY|OPENAI_API_KEY/i,
    );

    const untouchedTask = await prisma.generationTask.findUnique({
      where: {
        id: task.id,
      },
      select: {
        status: true,
        startedAt: true,
        retryCount: true,
      },
    });

    assert.ok(untouchedTask);
    assert.equal(untouchedTask.status, "QUEUED");
    assert.equal(untouchedTask.startedAt, null);
    assert.equal(untouchedTask.retryCount, 0);

    process.env.SCRIPT_GENERATION_API_KEY = "test-key";
  });

  test("worker consumes queued script task and marks it succeeded", async () => {
    await clearActiveScriptTasks(BATCH_ID);

    process.env.SCRIPT_GENERATION_API_KEY = "test-key";
    process.env.SCRIPT_GENERATION_PROVIDER = "openai";
    process.env.SCRIPT_GENERATION_MODEL = "test-model";
    process.env.SCRIPT_GENERATION_BASE_URL = "https://api.openai.test/v1";

    globalThis.fetch = async (url, options) => {
      assert.equal(url, "https://api.openai.test/v1/chat/completions");
      assert.equal(options.method, "POST");
      assert.equal(options.headers.Authorization, "Bearer test-key");

      const requestBody = JSON.parse(options.body);
      assert.equal(requestBody.model, "test-model");
      assert.equal(requestBody.response_format.type, "json_schema");

      return new Response(
        JSON.stringify({
          id: "chatcmpl-script-test-001",
          model: "test-model",
          choices: [
            {
              message: {
                content: JSON.stringify({
                  scripts: [
                    {
                      styleBase: "STABLE_CONVERSION",
                      title: "3秒回到清爽客厅",
                      hook: "刚进门就闻到异味？先别急着开窗。",
                      scriptText:
                        "刚进门就闻到异味？先别急着开窗。宠物家庭最怕味道挂在沙发和地毯上，这款除臭喷雾一喷就能快速改善空气感受。温和不刺鼻，客厅布艺、宠物窝周边都能日常辅助使用。收尾再给一个干净清爽的生活画面，让用户自然记住这瓶日常除味搭子。",
                      cta: "放在手边，日常异味冒头时随手喷一下。",
                      beatOutline: [
                        "开门闻到异味，立刻抛出痛点",
                        "展示喷洒动作和使用区域",
                        "给出温和不刺鼻的卖点反馈",
                        "收尾强调适合宠物家庭日常使用",
                      ],
                      sellingPointsUsed: ["快速中和宠物异味", "温和不刺鼻"],
                      generationTags: ["clean_home", "pet_family"],
                      complianceNotes: ["避免医疗级表达", "不承诺永久除味"],
                    },
                  ],
                }),
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    };

    const beforeBatch = await prisma.batch.findUnique({
      where: {
        id: BATCH_ID,
      },
      select: {
        status: true,
        scriptGeneratedCount: true,
      },
    });

    assert.ok(beforeBatch);

    const desiredCount = beforeBatch.scriptGeneratedCount + 1;
    const task = await createQueuedScriptTask(BATCH_ID, {
      priority: 999,
      desiredCount,
      triggerSource: "worker_success_test",
    });

    const result = await runScriptGenerationWorker({ limit: 1, log: QUIET_LOGGER });

    assert.equal(result.processed, 1);
    assert.equal(result.succeeded, 1);
    assert.equal(result.failed, 0);

    const updatedTask = await prisma.generationTask.findUnique({
      where: {
        id: task.id,
      },
      select: {
        status: true,
        resultPayload: true,
      },
    });

    assert.ok(updatedTask);
    assert.equal(updatedTask.status, "SUCCEEDED");
    assert.equal(updatedTask.resultPayload.workerStatus, "succeeded");
    assert.equal(updatedTask.resultPayload.executionMode, "llm-worker");
    assert.equal(updatedTask.resultPayload.provider, "openai");
    assert.equal(updatedTask.resultPayload.model, "test-model");

    const afterBatch = await prisma.batch.findUnique({
      where: {
        id: BATCH_ID,
      },
      select: {
        status: true,
        scriptGeneratedCount: true,
      },
    });

    assert.ok(afterBatch);
    assert.equal(afterBatch.status, "SCRIPTS_READY");
    assert.equal(afterBatch.scriptGeneratedCount, desiredCount);

    const createdScripts = await prisma.scriptVariant.findMany({
      where: {
        batchId: BATCH_ID,
      },
      orderBy: {
        sequenceNo: "asc",
      },
      select: {
        sequenceNo: true,
        title: true,
        styleBase: true,
        scriptText: true,
        generationTags: true,
        originType: true,
        scriptPayload: true,
      },
    });

    const createdScript = createdScripts.at(-1);
    assert.ok(createdScript);
    assert.equal(createdScript.sequenceNo, desiredCount);
    assert.equal(createdScript.styleBase, "STABLE_CONVERSION");
    assert.equal(createdScript.originType, "worker_llm");
    assert.match(createdScript.title, /清爽客厅/);
    assert.match(createdScript.scriptText, /宠物家庭/);
    assert.deepEqual(createdScript.scriptPayload.sellingPointsUsed, [
      "快速中和宠物异味",
      "温和不刺鼻",
    ]);
    assert.ok(createdScript.generationTags.includes("llm_generated"));
  });

  test("worker consumes queued script task with gemini provider", async () => {
    await clearActiveScriptTasks(BATCH_ID);

    delete process.env.SCRIPT_GENERATION_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.GEMINI_API_KEY = "gemini-test-key";
    process.env.SCRIPT_GENERATION_PROVIDER = "gemini";
    process.env.SCRIPT_GENERATION_MODEL = "gemini-2.0-flash-test";
    process.env.SCRIPT_GENERATION_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";

    try {
      globalThis.fetch = async (url, options) => {
        assert.equal(
          url,
          "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-test:generateContent?key=gemini-test-key",
        );
        assert.equal(options.method, "POST");

        const requestBody = JSON.parse(options.body);
        assert.equal(requestBody.generationConfig.responseMimeType, "application/json");
        assert.ok(requestBody.generationConfig.responseSchema?.properties?.scripts);

        return new Response(
          JSON.stringify({
            responseId: "gemini-response-001",
            modelVersion: "gemini-2.0-flash-test",
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        scripts: [
                          {
                            styleBase: "STRONG_HOOK",
                            title: "3秒抓住养宠家庭痛点",
                            hook: "家里一有异味，来客前就会手忙脚乱。",
                            scriptText:
                              "家里一有异味，来客前就会手忙脚乱。镜头先给沙发和宠物窝，再切到一喷即用的除味动作。强调温和不刺鼻、日常可持续使用，最后用客厅恢复清爽的画面做收尾，帮助用户快速记住产品价值。",
                            cta: "放在玄关，来客前30秒快速处理异味。",
                            beatOutline: [
                              "开场直击异味焦虑",
                              "展示喷洒前后场景变化",
                              "突出温和不刺鼻卖点",
                              "收尾强化日常便捷使用",
                            ],
                            sellingPointsUsed: ["快速中和宠物异味", "温和不刺鼻"],
                            generationTags: ["gemini", "pet-family"],
                            complianceNotes: ["避免绝对化承诺", "不涉及医疗功效"],
                          },
                        ],
                      }),
                    },
                  ],
                },
              },
            ],
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      };

      const beforeBatch = await prisma.batch.findUnique({
        where: {
          id: BATCH_ID,
        },
        select: {
          scriptGeneratedCount: true,
        },
      });

      assert.ok(beforeBatch);

      const desiredCount = beforeBatch.scriptGeneratedCount + 1;
      const task = await createQueuedScriptTask(BATCH_ID, {
        priority: 999,
        desiredCount,
        triggerSource: "worker_success_test_gemini",
      });

      const result = await runScriptGenerationWorker({ limit: 1, log: QUIET_LOGGER });
      assert.equal(result.processed, 1);
      assert.equal(result.succeeded, 1);
      assert.equal(result.failed, 0);

      const updatedTask = await prisma.generationTask.findUnique({
        where: {
          id: task.id,
        },
        select: {
          status: true,
          resultPayload: true,
        },
      });

      assert.ok(updatedTask);
      assert.equal(updatedTask.status, "SUCCEEDED");
      assert.equal(updatedTask.resultPayload.provider, "gemini");
      assert.equal(updatedTask.resultPayload.model, "gemini-2.0-flash-test");
    } finally {
      delete process.env.GEMINI_API_KEY;
      process.env.SCRIPT_GENERATION_PROVIDER = "openai";
      process.env.SCRIPT_GENERATION_API_KEY = "test-key";
    }
  });

  test("worker fails immediately for non-retryable provider auth error", async () => {
    await clearActiveScriptTasks(BATCH_ID);

    process.env.SCRIPT_GENERATION_API_KEY = "test-key";
    process.env.SCRIPT_GENERATION_PROVIDER = "openai";
    process.env.SCRIPT_GENERATION_MODEL = "test-model";
    process.env.SCRIPT_GENERATION_BASE_URL = "https://api.openai.test/v1";

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            type: "invalid_request_error",
            code: "invalid_api_key",
            message: "Incorrect API key provided.",
          },
        }),
        {
          status: 401,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

    const beforeBatch = await prisma.batch.findUnique({
      where: {
        id: BATCH_ID,
      },
      select: {
        scriptGeneratedCount: true,
      },
    });

    assert.ok(beforeBatch);

    const task = await createQueuedScriptTask(BATCH_ID, {
      priority: 998,
      desiredCount: beforeBatch.scriptGeneratedCount + 1,
      triggerSource: "worker_provider_auth_error_test",
    });

    const result = await runScriptGenerationWorker({ limit: 1, log: QUIET_LOGGER });

    assert.equal(result.processed, 1);
    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 1);

    const failedTask = await prisma.generationTask.findUnique({
      where: {
        id: task.id,
      },
      select: {
        status: true,
        errorCode: true,
        errorMessage: true,
        retryCount: true,
        resultPayload: true,
      },
    });

    assert.ok(failedTask);
    assert.equal(failedTask.status, "FAILED");
    assert.equal(failedTask.errorCode, "SCRIPT_PROVIDER_AUTH");
    assert.equal(failedTask.retryCount, 0);
    assert.equal(failedTask.resultPayload.workerStatus, "failed");
    assert.equal(failedTask.resultPayload.providerRetryable, false);
    assert.equal(failedTask.resultPayload.errorTelemetry.errorCode, "SCRIPT_PROVIDER_AUTH");
    assert.equal(failedTask.resultPayload.errorTelemetry.alertLevel, "HIGH");
    assert.equal(
      failedTask.resultPayload.errorTelemetry.metricKey,
      "script_generation.provider_auth",
    );
    assert.equal(failedTask.resultPayload.errorTelemetry.retryable, false);
    assert.equal(failedTask.resultPayload.errorTelemetry.willRetry, false);
    assert.match(failedTask.errorMessage, /status 401/i);

    await prisma.generationTask.delete({
      where: {
        id: task.id,
      },
    });
  });

  test("worker requeues task on provider rate limit error", async () => {
    await clearActiveScriptTasks(BATCH_ID);

    process.env.SCRIPT_GENERATION_API_KEY = "test-key";
    process.env.SCRIPT_GENERATION_PROVIDER = "openai";
    process.env.SCRIPT_GENERATION_MODEL = "test-model";
    process.env.SCRIPT_GENERATION_BASE_URL = "https://api.openai.test/v1";

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: {
            type: "rate_limit_error",
            code: "rate_limit_exceeded",
            message: "Too many requests.",
          },
        }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

    const beforeBatch = await prisma.batch.findUnique({
      where: {
        id: BATCH_ID,
      },
      select: {
        scriptGeneratedCount: true,
      },
    });

    assert.ok(beforeBatch);

    const task = await createQueuedScriptTask(BATCH_ID, {
      priority: 996,
      desiredCount: beforeBatch.scriptGeneratedCount + 1,
      triggerSource: "worker_provider_rate_limit_test",
    });

    const result = await runScriptGenerationWorker({ limit: 1, log: QUIET_LOGGER });
    assert.equal(result.processed, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.errorCodeCounts.SCRIPT_PROVIDER_RATE_LIMIT, 1);

    const failedTask = await prisma.generationTask.findUnique({
      where: { id: task.id },
      select: {
        status: true,
        errorCode: true,
        retryCount: true,
        resultPayload: true,
      },
    });

    assert.ok(failedTask);
    assert.equal(failedTask.status, "QUEUED");
    assert.equal(failedTask.errorCode, "SCRIPT_PROVIDER_RATE_LIMIT");
    assert.equal(failedTask.retryCount, 1);
    assert.equal(failedTask.resultPayload.providerRetryable, true);
    assert.equal(failedTask.resultPayload.errorTelemetry.retryable, true);
    assert.equal(failedTask.resultPayload.errorTelemetry.alertLevel, "MEDIUM");

    await prisma.generationTask.delete({
      where: { id: task.id },
    });
  });

  test("worker requeues task on provider timeout error", async () => {
    await clearActiveScriptTasks(BATCH_ID);

    process.env.SCRIPT_GENERATION_API_KEY = "test-key";
    process.env.SCRIPT_GENERATION_PROVIDER = "openai";
    process.env.SCRIPT_GENERATION_MODEL = "test-model";
    process.env.SCRIPT_GENERATION_BASE_URL = "https://api.openai.test/v1";
    process.env.SCRIPT_GENERATION_TIMEOUT_MS = "10";

    globalThis.fetch = async (_url, options) =>
      new Promise((_, reject) => {
        options.signal.addEventListener("abort", () => {
          const abortError = new Error("aborted");
          abortError.name = "AbortError";
          reject(abortError);
        });
      });

    const beforeBatch = await prisma.batch.findUnique({
      where: {
        id: BATCH_ID,
      },
      select: {
        scriptGeneratedCount: true,
      },
    });

    assert.ok(beforeBatch);

    const task = await createQueuedScriptTask(BATCH_ID, {
      priority: 995,
      desiredCount: beforeBatch.scriptGeneratedCount + 1,
      triggerSource: "worker_provider_timeout_test",
    });

    const result = await runScriptGenerationWorker({ limit: 1, log: QUIET_LOGGER });
    assert.equal(result.processed, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.errorCodeCounts.SCRIPT_PROVIDER_TIMEOUT, 1);

    const failedTask = await prisma.generationTask.findUnique({
      where: { id: task.id },
      select: {
        status: true,
        errorCode: true,
        retryCount: true,
        resultPayload: true,
      },
    });

    assert.ok(failedTask);
    assert.equal(failedTask.status, "QUEUED");
    assert.equal(failedTask.errorCode, "SCRIPT_PROVIDER_TIMEOUT");
    assert.equal(failedTask.retryCount, 1);
    assert.equal(failedTask.resultPayload.providerRetryable, true);
    assert.equal(failedTask.resultPayload.errorTelemetry.retryable, true);
    assert.equal(failedTask.resultPayload.errorTelemetry.alertLevel, "MEDIUM");

    await prisma.generationTask.delete({
      where: { id: task.id },
    });
  });

  test("worker requeues task on provider network error", async () => {
    await clearActiveScriptTasks(BATCH_ID);

    process.env.SCRIPT_GENERATION_API_KEY = "test-key";
    process.env.SCRIPT_GENERATION_PROVIDER = "openai";
    process.env.SCRIPT_GENERATION_MODEL = "test-model";
    process.env.SCRIPT_GENERATION_BASE_URL = "https://api.openai.test/v1";

    globalThis.fetch = async () => {
      throw new TypeError("network down");
    };

    const beforeBatch = await prisma.batch.findUnique({
      where: {
        id: BATCH_ID,
      },
      select: {
        scriptGeneratedCount: true,
      },
    });

    assert.ok(beforeBatch);

    const task = await createQueuedScriptTask(BATCH_ID, {
      priority: 994,
      desiredCount: beforeBatch.scriptGeneratedCount + 1,
      triggerSource: "worker_provider_network_test",
    });

    const result = await runScriptGenerationWorker({ limit: 1, log: QUIET_LOGGER });
    assert.equal(result.processed, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.errorCodeCounts.SCRIPT_PROVIDER_NETWORK, 1);

    const failedTask = await prisma.generationTask.findUnique({
      where: { id: task.id },
      select: {
        status: true,
        errorCode: true,
        retryCount: true,
        resultPayload: true,
      },
    });

    assert.ok(failedTask);
    assert.equal(failedTask.status, "QUEUED");
    assert.equal(failedTask.errorCode, "SCRIPT_PROVIDER_NETWORK");
    assert.equal(failedTask.retryCount, 1);
    assert.equal(failedTask.resultPayload.providerRetryable, true);
    assert.equal(failedTask.resultPayload.errorTelemetry.retryable, true);
    assert.equal(failedTask.resultPayload.errorTelemetry.alertLevel, "MEDIUM");

    await prisma.generationTask.delete({
      where: { id: task.id },
    });
  });

  test("worker fails immediately for non-retryable provider invalid response", async () => {
    await clearActiveScriptTasks(BATCH_ID);

    process.env.SCRIPT_GENERATION_API_KEY = "test-key";
    process.env.SCRIPT_GENERATION_PROVIDER = "openai";
    process.env.SCRIPT_GENERATION_MODEL = "test-model";
    process.env.SCRIPT_GENERATION_BASE_URL = "https://api.openai.test/v1";

    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          id: "chatcmpl-invalid-response",
          model: "test-model",
          choices: [
            {
              message: {
                content: "this is not json",
              },
            },
          ],
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
          },
        },
      );

    const beforeBatch = await prisma.batch.findUnique({
      where: {
        id: BATCH_ID,
      },
      select: {
        scriptGeneratedCount: true,
      },
    });

    assert.ok(beforeBatch);

    const task = await createQueuedScriptTask(BATCH_ID, {
      priority: 997,
      desiredCount: beforeBatch.scriptGeneratedCount + 1,
      triggerSource: "worker_provider_invalid_response_test",
    });

    const result = await runScriptGenerationWorker({ limit: 1, log: QUIET_LOGGER });

    assert.equal(result.processed, 1);
    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 1);
    assert.equal(result.errorCodeCounts.SCRIPT_PROVIDER_INVALID_RESPONSE, 1);

    const failedTask = await prisma.generationTask.findUnique({
      where: {
        id: task.id,
      },
      select: {
        status: true,
        errorCode: true,
        errorMessage: true,
        retryCount: true,
        resultPayload: true,
      },
    });

    assert.ok(failedTask);
    assert.equal(failedTask.status, "FAILED");
    assert.equal(failedTask.errorCode, "SCRIPT_PROVIDER_INVALID_RESPONSE");
    assert.equal(failedTask.retryCount, 0);
    assert.equal(failedTask.resultPayload.workerStatus, "failed");
    assert.equal(failedTask.resultPayload.providerRetryable, false);
    assert.equal(
      failedTask.resultPayload.errorTelemetry.errorCode,
      "SCRIPT_PROVIDER_INVALID_RESPONSE",
    );
    assert.equal(failedTask.resultPayload.errorTelemetry.alertLevel, "HIGH");
    assert.equal(
      failedTask.resultPayload.errorTelemetry.metricKey,
      "script_generation.provider_invalid_response",
    );
    assert.equal(failedTask.resultPayload.errorTelemetry.retryable, false);
    assert.equal(failedTask.resultPayload.errorTelemetry.willRetry, false);
    assert.match(failedTask.errorMessage, /not valid json/i);

    await prisma.generationTask.delete({
      where: {
        id: task.id,
      },
    });
  });

  test("worker requeues task when batch prerequisites are missing but retries remain", async () => {
    const missingProfileBatch = await prisma.batch.create({
      data: {
        name: `worker-fail-batch-${Date.now()}`,
        description: "worker failure test",
        status: BatchStatus.GENERATING_SCRIPTS,
        scriptTargetCount: 1,
      },
      select: {
        id: true,
      },
    });

    await prisma.referenceVideo.findUniqueOrThrow({
      where: {
        id: REFERENCE_VIDEO_ID,
      },
    });

    const task = await createQueuedScriptTask(missingProfileBatch.id, {
      priority: 998,
      desiredCount: 1,
      triggerSource: "worker_failure_test",
    });

    const result = await runScriptGenerationWorker({ limit: 1, log: QUIET_LOGGER });

    assert.equal(result.processed, 1);
    assert.equal(result.succeeded, 0);
    assert.equal(result.failed, 1);

    const failedTask = await prisma.generationTask.findUnique({
      where: {
        id: task.id,
      },
      select: {
        status: true,
        errorCode: true,
        errorMessage: true,
        retryCount: true,
        resultPayload: true,
      },
    });

    assert.ok(failedTask);
    assert.equal(failedTask.status, "QUEUED");
    assert.equal(failedTask.errorCode, "WORKER_ERROR");
    assert.equal(failedTask.retryCount, 1);
    assert.equal(failedTask.resultPayload.workerStatus, "retry_scheduled");
    assert.match(failedTask.errorMessage, /productProfile/i);

    const failedBatch = await prisma.batch.findUnique({
      where: {
        id: missingProfileBatch.id,
      },
      select: {
        status: true,
        failedTaskCount: true,
        lastError: true,
      },
    });

    assert.ok(failedBatch);
    assert.equal(failedBatch.status, "GENERATING_SCRIPTS");
    assert.equal(failedBatch.failedTaskCount, 0);
    assert.match(failedBatch.lastError, /productProfile/i);

    await prisma.generationTask.delete({
      where: {
        id: task.id,
      },
    });

    await prisma.batch.delete({
      where: {
        id: missingProfileBatch.id,
      },
    });
  });

  test("worker marks task failed after retry limit is exhausted", async () => {
    const missingProfileBatch = await prisma.batch.create({
      data: {
        name: `worker-fail-final-batch-${Date.now()}`,
        description: "worker final failure test",
        status: BatchStatus.GENERATING_SCRIPTS,
        scriptTargetCount: 1,
      },
      select: {
        id: true,
      },
    });

    const task = await createQueuedScriptTask(missingProfileBatch.id, {
      priority: 997,
      desiredCount: 1,
      triggerSource: "worker_final_failure_test",
    });

    await prisma.generationTask.update({
      where: {
        id: task.id,
      },
      data: {
        maxRetries: 1,
      },
    });

    const firstRun = await runScriptGenerationWorker({ limit: 1, log: QUIET_LOGGER });
    assert.equal(firstRun.processed, 1);
    assert.equal(firstRun.failed, 1);

    const secondRun = await runScriptGenerationWorker({ limit: 1, log: QUIET_LOGGER });
    assert.equal(secondRun.processed, 1);
    assert.equal(secondRun.failed, 1);

    const failedTask = await prisma.generationTask.findUnique({
      where: {
        id: task.id,
      },
      select: {
        status: true,
        errorCode: true,
        errorMessage: true,
        retryCount: true,
        resultPayload: true,
      },
    });

    assert.ok(failedTask);
    assert.equal(failedTask.status, "FAILED");
    assert.equal(failedTask.errorCode, "WORKER_ERROR");
    assert.equal(failedTask.retryCount, 1);
    assert.equal(failedTask.resultPayload.workerStatus, "failed");
    assert.match(failedTask.errorMessage, /productProfile/i);

    const failedBatch = await prisma.batch.findUnique({
      where: {
        id: missingProfileBatch.id,
      },
      select: {
        status: true,
        failedTaskCount: true,
        lastError: true,
      },
    });

    assert.ok(failedBatch);
    assert.equal(failedBatch.status, "PARTIAL_SUCCESS");
    assert.equal(failedBatch.failedTaskCount, 1);
    assert.match(failedBatch.lastError, /productProfile/i);
  });
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (originalTimeoutEnv === undefined) {
    delete process.env.SCRIPT_GENERATION_TIMEOUT_MS;
  } else {
    process.env.SCRIPT_GENERATION_TIMEOUT_MS = originalTimeoutEnv;
  }
  delete process.env.SCRIPT_GENERATION_API_KEY;
  delete process.env.OPENAI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.SCRIPT_GENERATION_PROVIDER;
  delete process.env.SCRIPT_GENERATION_MODEL;
  delete process.env.SCRIPT_GENERATION_BASE_URL;
  await prisma.$disconnect();
});
