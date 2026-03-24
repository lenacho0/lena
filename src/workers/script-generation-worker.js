import { BatchStatus, TaskStatus, TaskType } from "@prisma/client";
import { pathToFileURL } from "node:url";

import { prisma } from "../lib/prisma.js";
import { buildScriptGenerationErrorTelemetry } from "../services/script-generation/error-observability.js";
import { isScriptGenerationError } from "../services/script-generation/errors.js";
import {
  generateScriptVariantsForTask,
  validateScriptGenerationRuntimeConfig,
} from "../services/script-generation/service.js";

function parseCliArgs(argv) {
  let limit = 20;
  let checkConfig = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--check-config") {
      checkConfig = true;
      continue;
    }

    if (arg === "--limit") {
      const value = Number.parseInt(String(argv[i + 1] ?? ""), 10);
      if (!Number.isNaN(value) && value > 0) {
        limit = value;
      }
      i += 1;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      const value = Number.parseInt(arg.slice("--limit=".length), 10);
      if (!Number.isNaN(value) && value > 0) {
        limit = value;
      }
    }
  }

  return { limit, checkConfig };
}

function ensureObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  return {};
}

function omitUndefinedEntries(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function parseDesiredCount(requestPayload, fallback) {
  const payload = ensureObject(requestPayload);
  const raw = payload.desiredCount ?? fallback;
  const parsed = Number.parseInt(String(raw), 10);

  if (Number.isNaN(parsed)) {
    return fallback;
  }

  return Math.min(Math.max(parsed, 1), 50);
}

function resolveWorkerErrorCode(error) {
  if (
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string" &&
    error.code.trim() !== ""
  ) {
    return error.code.slice(0, 64);
  }

  return "WORKER_ERROR";
}

function emitWorkerLog(level, event, payload = {}) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    service: "script-generation-worker",
    level,
    event,
    ...payload,
  });

  if (level === "ERROR") {
    console.error(line);
    return;
  }

  if (level === "WARN") {
    console.warn(line);
    return;
  }

  console.log(line);
}

async function claimNextScriptTask() {
  const pendingTask = await prisma.generationTask.findFirst({
    where: {
      taskType: TaskType.SCRIPT_GENERATION,
      status: TaskStatus.QUEUED,
    },
    orderBy: [{ priority: "desc" }, { queuedAt: "asc" }, { createdAt: "asc" }],
  });

  if (!pendingTask) {
    return null;
  }

  const startedAt = new Date();
  const claimResult = await prisma.generationTask.updateMany({
    where: {
      id: pendingTask.id,
      status: TaskStatus.QUEUED,
    },
    data: {
      status: TaskStatus.RUNNING,
      startedAt,
      resultPayload: {
        ...ensureObject(pendingTask.resultPayload),
        workerStatus: "running",
        claimedAt: startedAt.toISOString(),
      },
    },
  });

  if (claimResult.count === 0) {
    return claimNextScriptTask();
  }

  return prisma.generationTask.findUnique({
    where: {
      id: pendingTask.id,
    },
  });
}

async function processScriptTask(task) {
  const finishedAt = new Date();

  try {
    const batch = await prisma.batch.findUnique({
      where: {
        id: task.batchId,
      },
      include: {
        productProfile: true,
        referenceSynthesisResult: true,
        batchReferenceVideos: {
          where: {
            isSelected: true,
          },
          include: {
            referenceVideo: true,
          },
          take: 1,
        },
        scriptVariants: {
          select: {
            id: true,
            sequenceNo: true,
          },
        },
      },
    });

    if (!batch) {
      throw new Error(`Batch ${task.batchId} not found.`);
    }

    if (!batch.productProfile) {
      throw new Error("Batch has no productProfile.");
    }

    const selectedReference = batch.batchReferenceVideos[0] ?? null;
    if (!selectedReference) {
      throw new Error("Batch has no selected reference video.");
    }

    const desiredCount = parseDesiredCount(task.requestPayload, batch.scriptTargetCount);
    const generationResult = await generateScriptVariantsForTask({
      batch,
      task,
      selectedReference,
      desiredCount,
    });
    const scriptData = generationResult.scripts.map((script, index) => ({
      batchId: batch.id,
      productProfileId: batch.productProfile.id,
      referenceSynthesisResultId: batch.referenceSynthesisResult?.id ?? null,
      sequenceNo: generationResult.targets[index].sequenceNo,
      styleBase: script.styleBase,
      title: script.title,
      scriptText: script.scriptText,
      scriptPayload: {
        generatedBy: "script-generation-worker",
        generationMethod: "llm_mvp",
        provider: generationResult.providerMetadata.provider,
        model: generationResult.providerMetadata.model,
        desiredCount,
        sequenceNo: generationResult.targets[index].sequenceNo,
        hook: script.hook,
        cta: script.cta,
        beatOutline: script.beatOutline,
        sellingPointsUsed: script.sellingPointsUsed,
        complianceNotes: script.complianceNotes,
      },
      generationTags: Array.from(new Set([...script.generationTags, "llm_generated", "worker_generated"])),
      sourceTrace: {
        taskId: task.id,
        selectedReferenceVideoId: selectedReference.referenceVideo.id,
        llmProvider: generationResult.providerMetadata.provider,
        llmModel: generationResult.providerMetadata.model,
        llmResponseId: generationResult.providerMetadata.responseId,
      },
      originType: "worker_llm",
      isSelected: false,
    }));

    await prisma.$transaction(async (tx) => {
      if (scriptData.length > 0) {
        await tx.scriptVariant.createMany({
          data: scriptData,
        });
      }

      const totalScriptCount = await tx.scriptVariant.count({
        where: {
          batchId: batch.id,
        },
      });

      await tx.batch.update({
        where: {
          id: batch.id,
        },
        data: {
          status: BatchStatus.SCRIPTS_READY,
          scriptGeneratedCount: totalScriptCount,
        },
      });

      await tx.generationTask.update({
        where: {
          id: task.id,
        },
        data: {
          status: TaskStatus.SUCCEEDED,
          finishedAt,
          errorCode: null,
          errorMessage: null,
          resultPayload: {
            ...ensureObject(task.resultPayload),
            workerStatus: "succeeded",
            executionMode: "llm-worker",
            provider: generationResult.providerMetadata.provider,
            model: generationResult.providerMetadata.model,
            responseId: generationResult.providerMetadata.responseId,
            desiredCount,
            generatedCount: scriptData.length,
            totalScriptCount,
            attemptsUsed: task.retryCount + 1,
          },
        },
      });
    });

    return { ok: true, taskId: task.id, generatedCount: scriptData.length };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorCode = resolveWorkerErrorCode(error);
    const providerRetryable =
      isScriptGenerationError(error) && typeof error.retryable === "boolean"
        ? error.retryable
        : undefined;
    const retryBudgetAvailable = task.retryCount < task.maxRetries;
    const shouldRetry = providerRetryable === false ? false : retryBudgetAvailable;
    const nextRetryCount = shouldRetry ? task.retryCount + 1 : task.retryCount;
    const errorTelemetry = buildScriptGenerationErrorTelemetry({
      errorCode,
      providerRetryable,
      willRetry: shouldRetry,
    });

    await prisma.$transaction(async (tx) => {
      await tx.generationTask.update({
        where: {
          id: task.id,
        },
        data: {
          status: shouldRetry ? TaskStatus.QUEUED : TaskStatus.FAILED,
          queuedAt: shouldRetry ? finishedAt : task.queuedAt,
          startedAt: null,
          finishedAt: shouldRetry ? null : finishedAt,
          errorCode,
          errorMessage: message,
          retryCount: nextRetryCount,
          resultPayload: {
            ...ensureObject(task.resultPayload),
            ...omitUndefinedEntries({
              retryScheduledAt: shouldRetry ? finishedAt.toISOString() : undefined,
              providerRetryable,
            }),
            errorTelemetry,
            workerStatus: shouldRetry ? "retry_scheduled" : "failed",
            failedAt: finishedAt.toISOString(),
            lastError: message,
            attemptsUsed: task.retryCount + 1,
            retryCount: nextRetryCount,
            maxRetries: task.maxRetries,
          },
        },
      });

      if (shouldRetry) {
        await tx.batch.update({
          where: {
            id: task.batchId,
          },
          data: {
            status: BatchStatus.GENERATING_SCRIPTS,
            lastError: message,
          },
        });
      } else {
        await tx.batch.update({
          where: {
            id: task.batchId,
          },
          data: {
            status: BatchStatus.PARTIAL_SUCCESS,
            failedTaskCount: {
              increment: 1,
            },
            lastError: message,
          },
        });
      }
    });

    return {
      ok: false,
      taskId: task.id,
      error: message,
      errorCode,
      errorTelemetry,
      willRetry: shouldRetry,
      retryCount: nextRetryCount,
      maxRetries: task.maxRetries,
    };
  }
}

export async function runScriptGenerationWorker({ limit = 20, log = emitWorkerLog } = {}) {
  const logger = typeof log === "function" ? log : emitWorkerLog;
  const runtimeConfig = validateScriptGenerationRuntimeConfig();
  logger("INFO", "worker_runtime_validated", {
    provider: runtimeConfig.provider,
    model: runtimeConfig.model,
    baseUrl: runtimeConfig.baseUrl,
  });

  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errorCodeCounts: {},
  };

  while (results.processed < limit) {
    const task = await claimNextScriptTask();

    if (!task) {
      break;
    }

    results.processed += 1;
    const outcome = await processScriptTask(task);

    if (outcome.ok) {
      results.succeeded += 1;
      logger("INFO", "task_succeeded", {
        taskId: outcome.taskId,
        generatedCount: outcome.generatedCount,
      });
    } else {
      results.failed += 1;
      if (outcome.errorCode) {
        results.errorCodeCounts[outcome.errorCode] =
          (results.errorCodeCounts[outcome.errorCode] ?? 0) + 1;
      }
      if (outcome.willRetry) {
        logger("WARN", "task_failed_retry_scheduled", {
          taskId: outcome.taskId,
          errorCode: outcome.errorCode ?? "UNKNOWN",
          errorMessage: outcome.error,
          retryCount: outcome.retryCount,
          maxRetries: outcome.maxRetries,
          alertLevel: outcome.errorTelemetry?.alertLevel ?? "UNKNOWN",
          metricKey: outcome.errorTelemetry?.metricKey ?? null,
          retryable: outcome.errorTelemetry?.retryable ?? null,
        });
      } else {
        logger("ERROR", "task_failed", {
          taskId: outcome.taskId,
          errorCode: outcome.errorCode ?? "UNKNOWN",
          errorMessage: outcome.error,
          alertLevel: outcome.errorTelemetry?.alertLevel ?? "UNKNOWN",
          metricKey: outcome.errorTelemetry?.metricKey ?? null,
          retryable: outcome.errorTelemetry?.retryable ?? null,
        });
      }
    }
  }

  logger("INFO", "worker_run_completed", {
    processed: results.processed,
    succeeded: results.succeeded,
    failed: results.failed,
    errorCodeCounts: results.errorCodeCounts,
  });

  return results;
}

export function checkScriptGenerationWorkerRuntime({ log = emitWorkerLog } = {}) {
  const logger = typeof log === "function" ? log : emitWorkerLog;
  const runtimeConfig = validateScriptGenerationRuntimeConfig();
  logger("INFO", "worker_runtime_check_ok", {
    provider: runtimeConfig.provider,
    model: runtimeConfig.model,
    baseUrl: runtimeConfig.baseUrl,
  });

  return runtimeConfig;
}

function isDirectRun() {
  if (!process.argv[1]) {
    return false;
  }

  return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isDirectRun()) {
  const { limit, checkConfig } = parseCliArgs(process.argv.slice(2));

  const runPromise = checkConfig
    ? Promise.resolve(checkScriptGenerationWorkerRuntime())
    : runScriptGenerationWorker({ limit });

  runPromise
    .catch((error) => {
      emitWorkerLog("ERROR", "worker_fatal_error", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
