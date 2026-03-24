import { Hono } from "hono";

import { prisma } from "../lib/prisma.js";

const storyboards = new Hono();

function buildStoryboardDetail(storyboard) {
  return {
    id: storyboard.id,
    batchId: storyboard.batchId,
    scriptVariantId: storyboard.scriptVariantId,
    variantNo: storyboard.variantNo,
    status: storyboard.status,
    isUserEdited: storyboard.isUserEdited,
    editedAt: storyboard.editedAt,
    defaultRestoredAt: storyboard.defaultRestoredAt,
    imageGenerationCount: storyboard.imageGenerationCount,
    currentPayload: storyboard.currentPayload,
    systemPayload: storyboard.systemPayload,
    sourceScriptSnapshot: storyboard.sourceScriptSnapshot,
    createdAt: storyboard.createdAt,
    updatedAt: storyboard.updatedAt,
    batch: {
      id: storyboard.batch.id,
      name: storyboard.batch.name,
      status: storyboard.batch.status,
    },
    scriptVariant: {
      id: storyboard.scriptVariant.id,
      sequenceNo: storyboard.scriptVariant.sequenceNo,
      styleBase: storyboard.scriptVariant.styleBase,
      title: storyboard.scriptVariant.title,
      scriptText: storyboard.scriptVariant.scriptText,
      generationTags: storyboard.scriptVariant.generationTags,
      isSelected: storyboard.scriptVariant.isSelected,
    },
    assets: storyboard.assets.map((asset) => ({
      id: asset.id,
      assetType: asset.assetType,
      assetRole: asset.assetRole,
      fileName: asset.fileName,
      mimeType: asset.mimeType,
      externalUrl: asset.externalUrl,
      storageKey: asset.storageKey,
      width: asset.width,
      height: asset.height,
      createdAt: asset.createdAt,
    })),
    complianceChecks: storyboard.batch.complianceChecks
      .filter(
        (check) =>
          check.targetType === "STORYBOARD_VARIANT" &&
          check.targetId === storyboard.id,
      )
      .map((check) => ({
        id: check.id,
        status: check.status,
        riskLevel: check.riskLevel,
        issueCount: check.issueCount,
        issues: check.issues,
        suggestionSummary: check.suggestionSummary,
        createdAt: check.createdAt,
      })),
  };
}

storyboards.get("/:id", async (c) => {
  const id = c.req.param("id");

  const storyboard = await prisma.storyboardVariant.findUnique({
    where: { id },
    include: {
      batch: {
        include: {
          complianceChecks: {
            orderBy: {
              createdAt: "desc",
            },
          },
        },
      },
      scriptVariant: true,
      assets: {
        orderBy: {
          createdAt: "asc",
        },
      },
    },
  });

  if (!storyboard) {
    return c.json(
      {
        error: {
          message: "Storyboard not found.",
        },
      },
      404,
    );
  }

  return c.json({
    data: buildStoryboardDetail(storyboard),
  });
});

export { storyboards };
