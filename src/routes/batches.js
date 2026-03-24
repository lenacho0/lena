import { Hono } from "hono";
import { BatchStatus, Prisma, TaskStatus, TaskType } from "@prisma/client";

import { prisma } from "../lib/prisma.js";
import { badRequest, clamp, conflict, notFound, parsePositiveInt } from "../lib/http.js";

const batches = new Hono();
const ACTIVE_TASK_STATUSES = [TaskStatus.DRAFT, TaskStatus.QUEUED, TaskStatus.RUNNING];
const ACTIVE_SCRIPT_TASK_CONFLICT_MESSAGE =
  "An active script generation task already exists for this batch. Wait for it to finish before submitting a different request.";

const BATCH_LIST_INCLUDE = {
  productProfile: true,
  batchReferenceVideos: {
    where: {
      isSelected: true,
    },
    include: {
      referenceVideo: true,
    },
    take: 1,
  },
};

const BATCH_DETAIL_INCLUDE = {
  productProfile: true,
  referenceSynthesisResult: true,
  batchReferenceVideos: {
    orderBy: [{ isSelected: "desc" }, { selectedAt: "asc" }, { createdAt: "asc" }],
    include: {
      referenceVideo: true,
      mediaPrepResult: true,
      videoAnalysisResult: true,
    },
  },
  scriptVariants: {
    orderBy: {
      sequenceNo: "asc",
    },
    include: {
      storyboardVariants: {
        orderBy: {
          variantNo: "asc",
        },
      },
    },
  },
  complianceChecks: {
    orderBy: {
      createdAt: "desc",
    },
  },
  exportPackages: {
    orderBy: {
      createdAt: "desc",
    },
  },
  generationTasks: {
    orderBy: {
      createdAt: "desc",
    },
  },
  assets: {
    orderBy: {
      createdAt: "asc",
    },
  },
};

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function trimNullableString(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function ensureJsonBody(body) {
  return isPlainObject(body) ? body : {};
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseIntegerField(value, fieldName, { min, max } = {}) {
  const parsed = Number.parseInt(String(value), 10);

  if (Number.isNaN(parsed)) {
    throw badRequest(`${fieldName} must be a valid integer.`);
  }

  if (min !== undefined && parsed < min) {
    throw badRequest(`${fieldName} must be greater than or equal to ${min}.`);
  }

  if (max !== undefined && parsed > max) {
    throw badRequest(`${fieldName} must be less than or equal to ${max}.`);
  }

  return parsed;
}

function normalizeJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeJsonValue);
  }

  if (isPlainObject(value)) {
    return Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .reduce((result, key) => {
        result[key] = normalizeJsonValue(value[key]);
        return result;
      }, {});
  }

  return value;
}

function jsonValuesEqual(left, right) {
  return JSON.stringify(normalizeJsonValue(left)) === JSON.stringify(normalizeJsonValue(right));
}

async function findActiveScriptGenerationTask(executor, batchId) {
  return executor.generationTask.findFirst({
    where: {
      batchId,
      taskType: TaskType.SCRIPT_GENERATION,
      status: {
        in: ACTIVE_TASK_STATUSES,
      },
    },
    orderBy: [{ createdAt: "desc" }],
  });
}

function isUniqueConstraintError(error) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

function normalizeEnumValue(value, enumObject, fieldName) {
  if (typeof value !== "string" || value.trim() === "") {
    throw badRequest(`${fieldName} must be a non-empty string.`);
  }

  const rawValue = value.trim();
  const upperValue = rawValue.toUpperCase();

  for (const [key, enumValue] of Object.entries(enumObject)) {
    if (key === upperValue || String(enumValue).toLowerCase() === rawValue.toLowerCase()) {
      return enumValue;
    }
  }

  throw badRequest(`${fieldName} is invalid.`);
}

function buildCreateProductProfileData(input) {
  if (!isPlainObject(input)) {
    throw badRequest("productProfile must be an object.");
  }

  const productName = trimNullableString(input.productName);

  if (!productName) {
    throw badRequest("productProfile.productName is required when productProfile is provided.");
  }

  return {
    brandName: trimNullableString(input.brandName),
    productName,
    productCategory: trimNullableString(input.productCategory),
    targetSpecies: trimNullableString(input.targetSpecies),
    productSummary: trimNullableString(input.productSummary),
    sellingPoints: normalizeStringArray(input.sellingPoints),
    allowedClaims: normalizeStringArray(input.allowedClaims),
    forbiddenClaims: normalizeStringArray(input.forbiddenClaims),
    requiredSellingPoints: normalizeStringArray(input.requiredSellingPoints),
    usageScenarios: normalizeStringArray(input.usageScenarios),
    toneConstraints: isPlainObject(input.toneConstraints) ? input.toneConstraints : {},
    notes: trimNullableString(input.notes),
  };
}

function buildUpdateProductProfileData(input, hasExistingProfile) {
  if (!isPlainObject(input)) {
    throw badRequest("productProfile must be an object.");
  }

  if (!hasExistingProfile) {
    return buildCreateProductProfileData(input);
  }

  const data = {};

  if ("brandName" in input) {
    data.brandName = trimNullableString(input.brandName);
  }

  if ("productName" in input) {
    const productName = trimNullableString(input.productName);

    if (!productName) {
      throw badRequest("productProfile.productName cannot be empty.");
    }

    data.productName = productName;
  }

  if ("productCategory" in input) {
    data.productCategory = trimNullableString(input.productCategory);
  }

  if ("targetSpecies" in input) {
    data.targetSpecies = trimNullableString(input.targetSpecies);
  }

  if ("productSummary" in input) {
    data.productSummary = trimNullableString(input.productSummary);
  }

  if ("sellingPoints" in input) {
    data.sellingPoints = normalizeStringArray(input.sellingPoints);
  }

  if ("allowedClaims" in input) {
    data.allowedClaims = normalizeStringArray(input.allowedClaims);
  }

  if ("forbiddenClaims" in input) {
    data.forbiddenClaims = normalizeStringArray(input.forbiddenClaims);
  }

  if ("requiredSellingPoints" in input) {
    data.requiredSellingPoints = normalizeStringArray(input.requiredSellingPoints);
  }

  if ("usageScenarios" in input) {
    data.usageScenarios = normalizeStringArray(input.usageScenarios);
  }

  if ("toneConstraints" in input) {
    if (input.toneConstraints !== null && !isPlainObject(input.toneConstraints)) {
      throw badRequest("productProfile.toneConstraints must be an object.");
    }

    data.toneConstraints = ensureJsonBody(input.toneConstraints);
  }

  if ("notes" in input) {
    data.notes = trimNullableString(input.notes);
  }

  return data;
}

function buildGenerationTaskSummary(task) {
  return {
    id: task.id,
    batchId: task.batchId,
    taskType: task.taskType,
    status: task.status,
    priority: task.priority,
    targetType: task.targetType,
    targetId: task.targetId,
    requestPayload: task.requestPayload,
    resultPayload: task.resultPayload,
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    queuedAt: task.queuedAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

async function readJsonBody(c) {
  try {
    return await c.req.json();
  } catch {
    throw badRequest("Request body must be valid JSON.");
  }
}

async function findBatchDetail(id) {
  return prisma.batch.findUnique({
    where: { id },
    include: BATCH_DETAIL_INCLUDE,
  });
}

function buildBatchListItem(batch) {
  const selectedReference = batch.batchReferenceVideos[0] ?? null;

  return {
    id: batch.id,
    name: batch.name,
    description: batch.description,
    status: batch.status,
    progressPercent: Number(batch.progressPercent),
    scriptTargetCount: batch.scriptTargetCount,
    scriptGeneratedCount: batch.scriptGeneratedCount,
    storyboardGeneratedCount: batch.storyboardGeneratedCount,
    failedTaskCount: batch.failedTaskCount,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    productProfile: batch.productProfile
      ? {
          id: batch.productProfile.id,
          productName: batch.productProfile.productName,
          productCategory: batch.productProfile.productCategory,
          brandName: batch.productProfile.brandName,
        }
      : null,
    selectedReferenceVideo: selectedReference
      ? {
          id: selectedReference.referenceVideo.id,
          platform: selectedReference.referenceVideo.platform,
          title: selectedReference.referenceVideo.title,
          authorName: selectedReference.referenceVideo.authorName,
          playCount: selectedReference.referenceVideo.playCount?.toString() ?? null,
          likeCount: selectedReference.referenceVideo.likeCount?.toString() ?? null,
          publishedAt: selectedReference.referenceVideo.publishedAt,
        }
      : null,
  };
}

function buildBatchDetail(batch) {
  return {
    id: batch.id,
    name: batch.name,
    description: batch.description,
    status: batch.status,
    referenceVideoLimit: batch.referenceVideoLimit,
    scriptTargetCount: batch.scriptTargetCount,
    progressPercent: Number(batch.progressPercent),
    scriptGeneratedCount: batch.scriptGeneratedCount,
    storyboardGeneratedCount: batch.storyboardGeneratedCount,
    failedTaskCount: batch.failedTaskCount,
    settings: batch.settings,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    productProfile: batch.productProfile
      ? {
          id: batch.productProfile.id,
          brandName: batch.productProfile.brandName,
          productName: batch.productProfile.productName,
          productCategory: batch.productProfile.productCategory,
          targetSpecies: batch.productProfile.targetSpecies,
          productSummary: batch.productProfile.productSummary,
          sellingPoints: batch.productProfile.sellingPoints,
          allowedClaims: batch.productProfile.allowedClaims,
          forbiddenClaims: batch.productProfile.forbiddenClaims,
          requiredSellingPoints: batch.productProfile.requiredSellingPoints,
          usageScenarios: batch.productProfile.usageScenarios,
          toneConstraints: batch.productProfile.toneConstraints,
          notes: batch.productProfile.notes,
        }
      : null,
    referenceVideos: batch.batchReferenceVideos.map((item) => ({
      id: item.id,
      isSelected: item.isSelected,
      selectionRank: item.selectionRank,
      selectedAt: item.selectedAt,
      querySnapshot: item.querySnapshot,
      notes: item.notes,
      mediaPrepResult: item.mediaPrepResult
        ? {
            id: item.mediaPrepResult.id,
            status: item.mediaPrepResult.status,
            downloadStrategy: item.mediaPrepResult.downloadStrategy,
            preparedSpec: item.mediaPrepResult.preparedSpec,
            diagnosticPayload: item.mediaPrepResult.diagnosticPayload,
          }
        : null,
      videoAnalysisResult: item.videoAnalysisResult
        ? {
            id: item.videoAnalysisResult.id,
            status: item.videoAnalysisResult.status,
            analyzerVendor: item.videoAnalysisResult.analyzerVendor,
            analyzerModel: item.videoAnalysisResult.analyzerModel,
            confidenceScore: item.videoAnalysisResult.confidenceScore
              ? Number(item.videoAnalysisResult.confidenceScore)
              : null,
            normalizedTags: item.videoAnalysisResult.normalizedTags,
            summaryPayload: item.videoAnalysisResult.summaryPayload,
          }
        : null,
      referenceVideo: {
        id: item.referenceVideo.id,
        platform: item.referenceVideo.platform,
        sourceProvider: item.referenceVideo.sourceProvider,
        externalVideoId: item.referenceVideo.externalVideoId,
        authorName: item.referenceVideo.authorName,
        authorHandle: item.referenceVideo.authorHandle,
        title: item.referenceVideo.title,
        description: item.referenceVideo.description,
        videoUrl: item.referenceVideo.videoUrl,
        coverUrl: item.referenceVideo.coverUrl,
        durationSeconds: item.referenceVideo.durationSeconds
          ? Number(item.referenceVideo.durationSeconds)
          : null,
        publishedAt: item.referenceVideo.publishedAt,
        playCount: item.referenceVideo.playCount?.toString() ?? null,
        likeCount: item.referenceVideo.likeCount?.toString() ?? null,
        commentCount: item.referenceVideo.commentCount?.toString() ?? null,
        shareCount: item.referenceVideo.shareCount?.toString() ?? null,
        engagementRate: item.referenceVideo.engagementRate
          ? Number(item.referenceVideo.engagementRate)
          : null,
      },
    })),
    referenceSynthesisResult: batch.referenceSynthesisResult
      ? {
          id: batch.referenceSynthesisResult.id,
          status: batch.referenceSynthesisResult.status,
          sourceVideoCount: batch.referenceSynthesisResult.sourceVideoCount,
          synthesisPayload: batch.referenceSynthesisResult.synthesisPayload,
          traceabilityPayload: batch.referenceSynthesisResult.traceabilityPayload,
        }
      : null,
    scripts: batch.scriptVariants.map((script) => ({
      id: script.id,
      sequenceNo: script.sequenceNo,
      styleBase: script.styleBase,
      title: script.title,
      scriptText: script.scriptText,
      generationTags: script.generationTags,
      sourceTrace: script.sourceTrace,
      isSelected: script.isSelected,
      storyboardVariants: script.storyboardVariants.map((storyboard) => ({
        id: storyboard.id,
        variantNo: storyboard.variantNo,
        status: storyboard.status,
        isUserEdited: storyboard.isUserEdited,
        imageGenerationCount: storyboard.imageGenerationCount,
        currentPayload: storyboard.currentPayload,
        systemPayload: storyboard.systemPayload,
      })),
    })),
    complianceChecks: batch.complianceChecks.map((check) => ({
      id: check.id,
      targetType: check.targetType,
      targetId: check.targetId,
      status: check.status,
      checkerVendor: check.checkerVendor,
      checkerVersion: check.checkerVersion,
      riskLevel: check.riskLevel,
      issueCount: check.issueCount,
      issues: check.issues,
      suggestionSummary: check.suggestionSummary,
      createdAt: check.createdAt,
    })),
    exportPackages: batch.exportPackages.map((pkg) => ({
      id: pkg.id,
      status: pkg.status,
      fileName: pkg.fileName,
      exportScope: pkg.exportScope,
      includedScriptCount: pkg.includedScriptCount,
      includedStoryboardCount: pkg.includedStoryboardCount,
      includedJsonCount: pkg.includedJsonCount,
      completedAt: pkg.completedAt,
      downloadExpiresAt: pkg.downloadExpiresAt,
    })),
    tasks: batch.generationTasks.map((task) => ({
      id: task.id,
      batchId: task.batchId,
      taskType: task.taskType,
      status: task.status,
      priority: task.priority,
      targetType: task.targetType,
      targetId: task.targetId,
      requestPayload: task.requestPayload,
      resultPayload: task.resultPayload,
      errorCode: task.errorCode,
      errorMessage: task.errorMessage,
      retryCount: task.retryCount,
      maxRetries: task.maxRetries,
      queuedAt: task.queuedAt,
      startedAt: task.startedAt,
      finishedAt: task.finishedAt,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    })),
    assets: batch.assets.map((asset) => ({
      id: asset.id,
      assetType: asset.assetType,
      assetRole: asset.assetRole,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      externalUrl: asset.externalUrl,
      storageKey: asset.storageKey,
      width: asset.width,
      height: asset.height,
      durationSeconds: asset.durationSeconds ? Number(asset.durationSeconds) : null,
      createdAt: asset.createdAt,
    })),
  };
}

function buildCreatedBatch(batch) {
  return {
    id: batch.id,
    name: batch.name,
    description: batch.description,
    status: batch.status,
    scriptTargetCount: batch.scriptTargetCount,
    progressPercent: Number(batch.progressPercent),
    settings: batch.settings,
    createdAt: batch.createdAt,
    updatedAt: batch.updatedAt,
    productProfile: batch.productProfile
      ? {
          id: batch.productProfile.id,
          brandName: batch.productProfile.brandName,
          productName: batch.productProfile.productName,
          productCategory: batch.productProfile.productCategory,
          targetSpecies: batch.productProfile.targetSpecies,
        }
      : null,
  };
}

batches.post("/", async (c) => {
  const body = ensureJsonBody(await readJsonBody(c));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const description = trimNullableString(body.description);
  const scriptTargetCount = clamp(
    parsePositiveInt(body.scriptTargetCount, 10),
    1,
    50,
  );
  const productProfile = body.productProfile ?? null;

  if (!name) {
    throw badRequest("name is required.");
  }

  if (
    productProfile &&
    (typeof productProfile !== "object" || Array.isArray(productProfile))
  ) {
    throw badRequest("productProfile must be an object.");
  }

  if (
    productProfile &&
    (!productProfile.productName ||
      typeof productProfile.productName !== "string" ||
      productProfile.productName.trim() === "")
  ) {
    throw badRequest("productProfile.productName is required when productProfile is provided.");
  }

  const createdBatch = await prisma.batch.create({
    data: {
      name,
      description,
      status: BatchStatus.DRAFT,
      scriptTargetCount,
      progressPercent: "0",
      settings:
        isPlainObject(body.settings) ? body.settings : {},
      ...(productProfile
        ? {
            productProfile: {
              create: buildCreateProductProfileData(productProfile),
            },
          }
        : {}),
    },
    include: {
      productProfile: true,
    },
  });

  return c.json(
    {
      data: buildCreatedBatch(createdBatch),
    },
    201,
  );
});

batches.patch("/:id", async (c) => {
  const id = c.req.param("id");

  if (!id) {
    throw badRequest("Batch id is required.");
  }

  const body = ensureJsonBody(await readJsonBody(c));
  const existingBatch = await prisma.batch.findUnique({
    where: { id },
    include: {
      productProfile: true,
    },
  });

  if (!existingBatch) {
    throw notFound("Batch not found.");
  }

  const data = {};

  if ("name" in body) {
    const name = trimNullableString(body.name);

    if (!name) {
      throw badRequest("name cannot be empty.");
    }

    data.name = name;
  }

  if ("description" in body) {
    data.description = body.description === null ? null : trimNullableString(body.description);
  }

  if ("status" in body) {
    data.status = normalizeEnumValue(body.status, BatchStatus, "status");
  }

  if ("scriptTargetCount" in body) {
    data.scriptTargetCount = parseIntegerField(body.scriptTargetCount, "scriptTargetCount", {
      min: 1,
      max: 50,
    });
  }

  if ("settings" in body) {
    if (!isPlainObject(body.settings)) {
      throw badRequest("settings must be an object.");
    }

    data.settings = {
      ...ensureJsonBody(existingBatch.settings),
      ...body.settings,
    };
  }

  if ("referenceVideoLimit" in body) {
    data.referenceVideoLimit = parseIntegerField(
      body.referenceVideoLimit,
      "referenceVideoLimit",
      {
        min: 1,
        max: 1,
      },
    );
  }

  const hasProductProfileMutation = "productProfile" in body;
  let productProfileMutation;

  if (hasProductProfileMutation) {
    const productProfileData = buildUpdateProductProfileData(
      body.productProfile,
      Boolean(existingBatch.productProfile),
    );

    if (existingBatch.productProfile && Object.keys(productProfileData).length === 0) {
      throw badRequest("productProfile must include at least one updatable field.");
    }

    productProfileMutation = existingBatch.productProfile
      ? {
          productProfile: {
            update: productProfileData,
          },
        }
      : {
          productProfile: {
            create: productProfileData,
          },
        };
  }

  if (Object.keys(data).length === 0 && !productProfileMutation) {
    throw badRequest("No updatable fields were provided.");
  }

  const updatedBatch = await prisma.batch.update({
    where: { id },
    data: {
      ...data,
      ...productProfileMutation,
    },
    include: BATCH_DETAIL_INCLUDE,
  });

  return c.json({
    data: buildBatchDetail(updatedBatch),
  });
});

batches.get("/", async (c) => {
  const page = parsePositiveInt(c.req.query("page"), 1);
  const pageSize = clamp(parsePositiveInt(c.req.query("pageSize"), 10), 1, 50);
  const skip = (page - 1) * pageSize;

  const total = await prisma.batch.count();
  const items = await prisma.batch.findMany({
    orderBy: {
      createdAt: "desc",
    },
    skip,
    take: pageSize,
    include: BATCH_LIST_INCLUDE,
  });

  return c.json({
    data: items.map(buildBatchListItem),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
  });
});

batches.post("/:id/reference-videos/select", async (c) => {
  const id = c.req.param("id");

  if (!id) {
    throw badRequest("Batch id is required.");
  }

  const body = ensureJsonBody(await readJsonBody(c));
  const referenceVideoId = trimNullableString(body.referenceVideoId);

  if (!referenceVideoId) {
    throw badRequest("referenceVideoId is required.");
  }

  const batch = await prisma.batch.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
    },
  });

  if (!batch) {
    throw notFound("Batch not found.");
  }

  const referenceVideo = await prisma.referenceVideo.findUnique({
    where: {
      id: referenceVideoId,
    },
    select: {
      id: true,
    },
  });

  if (!referenceVideo) {
    throw notFound("Reference video not found.");
  }

  const selectedAt = new Date();
  const querySnapshot = body.querySnapshot ?? {};

  if (!isPlainObject(querySnapshot)) {
    throw badRequest("querySnapshot must be an object when provided.");
  }

  await prisma.$transaction([
    prisma.batchReferenceVideo.updateMany({
      where: {
        batchId: id,
        isSelected: true,
      },
      data: {
        isSelected: false,
        selectionRank: null,
        selectedAt: null,
      },
    }),
    prisma.batchReferenceVideo.upsert({
      where: {
        batchId_referenceVideoId: {
          batchId: id,
          referenceVideoId,
        },
      },
      update: {
        isSelected: true,
        selectionRank: 1,
        selectedAt,
        querySnapshot,
        notes: "notes" in body ? trimNullableString(body.notes) : undefined,
      },
      create: {
        batchId: id,
        referenceVideoId,
        isSelected: true,
        selectionRank: 1,
        selectedAt,
        querySnapshot,
        notes: trimNullableString(body.notes),
      },
    }),
    prisma.batch.update({
      where: {
        id,
      },
      data: {
        status:
          batch.status === BatchStatus.DRAFT ? BatchStatus.COLLECTING_REFERENCE : batch.status,
      },
    }),
  ]);

  const updatedBatch = await findBatchDetail(id);

  if (!updatedBatch) {
    throw notFound("Batch not found.");
  }

  return c.json({
    data: buildBatchDetail(updatedBatch),
  });
});

batches.post("/:id/script-generation-tasks", async (c) => {
  const id = c.req.param("id");

  if (!id) {
    throw badRequest("Batch id is required.");
  }

  const body = ensureJsonBody(await readJsonBody(c));
  const batch = await prisma.batch.findUnique({
    where: { id },
    include: {
      productProfile: true,
      batchReferenceVideos: {
        where: {
          isSelected: true,
        },
        include: {
          referenceVideo: true,
        },
        take: 1,
      },
    },
  });

  if (!batch) {
    throw notFound("Batch not found.");
  }

  if (batch.status === BatchStatus.ARCHIVED) {
    throw badRequest("Archived batch cannot create script generation tasks.");
  }

  if (!batch.productProfile) {
    throw badRequest("Batch must have a productProfile before creating script generation tasks.");
  }

  const selectedReference = batch.batchReferenceVideos[0] ?? null;

  if (!selectedReference) {
    throw badRequest("Batch must select a reference video before creating script generation tasks.");
  }

  const desiredCountInput =
    body.scriptTargetCount !== undefined ? body.scriptTargetCount : body.desiredCount;
  const desiredCount =
    desiredCountInput !== undefined
      ? parseIntegerField(desiredCountInput, "scriptTargetCount", {
          min: 1,
          max: 50,
        })
      : batch.scriptTargetCount;
  const priority =
    "priority" in body
      ? parseIntegerField(body.priority, "priority", {
          min: 1,
          max: 999,
        })
      : 100;
  const maxRetries =
    "maxRetries" in body
      ? parseIntegerField(body.maxRetries, "maxRetries", {
          min: 1,
          max: 10,
        })
      : 3;

  if ("requestPayload" in body && !isPlainObject(body.requestPayload)) {
    throw badRequest("requestPayload must be an object when provided.");
  }

  if ("styleMix" in body && !isPlainObject(body.styleMix)) {
    throw badRequest("styleMix must be an object when provided.");
  }

  const requestPayload = {
    ...ensureJsonBody(body.requestPayload),
    desiredCount,
    productProfileId: batch.productProfile.id,
    selectedReferenceVideoId: selectedReference.referenceVideoId,
    triggerSource:
      typeof body.triggerSource === "string" && body.triggerSource.trim() !== ""
        ? body.triggerSource.trim()
        : "manual",
    executionMode: "llm_mvp",
    ...(isPlainObject(body.styleMix)
      ? {
          styleMix: body.styleMix,
        }
      : {}),
  };

  let deduplicated = false;
  let task;

  const existingTask = await findActiveScriptGenerationTask(prisma, id);
  if (existingTask) {
    if (!jsonValuesEqual(existingTask.requestPayload, requestPayload)) {
      throw conflict(ACTIVE_SCRIPT_TASK_CONFLICT_MESSAGE);
    }

    deduplicated = true;
    await prisma.batch.update({
      where: {
        id,
      },
      data: {
        status: BatchStatus.GENERATING_SCRIPTS,
        scriptTargetCount: desiredCount,
      },
    });
    task = existingTask;
  } else {
    try {
      const queuedAt = new Date();
      const [, createdTask] = await prisma.$transaction([
        prisma.batch.update({
          where: {
            id,
          },
          data: {
            status: BatchStatus.GENERATING_SCRIPTS,
            scriptTargetCount: desiredCount,
          },
        }),
        prisma.generationTask.create({
          data: {
            batchId: id,
            taskType: TaskType.SCRIPT_GENERATION,
            status: TaskStatus.QUEUED,
            priority,
            targetType: "batch",
            targetId: id,
            requestPayload,
            resultPayload: {
              generationMethod: "llm_mvp",
              workerStatus: "not_started",
            },
            retryCount: 0,
            maxRetries,
            queuedAt,
          },
        }),
      ]);
      task = createdTask;
    } catch (error) {
      if (!isUniqueConstraintError(error)) {
        throw error;
      }

      const concurrentTask = await findActiveScriptGenerationTask(prisma, id);
      if (!concurrentTask) {
        throw error;
      }

      if (!jsonValuesEqual(concurrentTask.requestPayload, requestPayload)) {
        throw conflict(ACTIVE_SCRIPT_TASK_CONFLICT_MESSAGE);
      }

      deduplicated = true;
      task = concurrentTask;
    }
  }

  return c.json(
    {
      data: {
        task: buildGenerationTaskSummary(task),
        batch: {
          id: batch.id,
          status: BatchStatus.GENERATING_SCRIPTS,
          scriptTargetCount: desiredCount,
        },
        selectedReferenceVideo: {
          id: selectedReference.referenceVideo.id,
          title: selectedReference.referenceVideo.title,
          platform: selectedReference.referenceVideo.platform,
        },
        executionMode: "llm_mvp",
        deduplicated,
      },
    },
    202,
  );
});

batches.get("/:id", async (c) => {
  const id = c.req.param("id");

  if (!id) {
    throw badRequest("Batch id is required.");
  }

  const batch = await findBatchDetail(id);

  if (!batch) {
    throw notFound("Batch not found.");
  }

  return c.json({
    data: buildBatchDetail(batch),
  });
});

export { batches };
