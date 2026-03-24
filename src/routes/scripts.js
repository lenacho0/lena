import { Hono } from "hono";

import { prisma } from "../lib/prisma.js";
import { clamp, parsePositiveInt } from "../lib/http.js";

const scripts = new Hono();

function buildScriptListItem(script) {
  return {
    id: script.id,
    batchId: script.batchId,
    batchName: script.batch.name,
    sequenceNo: script.sequenceNo,
    styleBase: script.styleBase,
    title: script.title,
    scriptText: script.scriptText,
    generationTags: script.generationTags,
    sourceTrace: script.sourceTrace,
    isSelected: script.isSelected,
    createdAt: script.createdAt,
    updatedAt: script.updatedAt,
    productProfile: script.productProfile
      ? {
          id: script.productProfile.id,
          productName: script.productProfile.productName,
          productCategory: script.productProfile.productCategory,
        }
      : null,
    storyboardCount: script.storyboardVariants.length,
    storyboardVariants: script.storyboardVariants.map((storyboard) => ({
      id: storyboard.id,
      variantNo: storyboard.variantNo,
      status: storyboard.status,
      isUserEdited: storyboard.isUserEdited,
      imageGenerationCount: storyboard.imageGenerationCount,
    })),
  };
}

scripts.get("/", async (c) => {
  const page = parsePositiveInt(c.req.query("page"), 1);
  const pageSize = clamp(parsePositiveInt(c.req.query("pageSize"), 10), 1, 50);
  const batchId = c.req.query("batchId");
  const onlySelected = c.req.query("selected") === "true";
  const skip = (page - 1) * pageSize;

  const where = {
    ...(batchId ? { batchId } : {}),
    ...(onlySelected ? { isSelected: true } : {}),
  };

  const total = await prisma.scriptVariant.count({ where });
  const items = await prisma.scriptVariant.findMany({
    where,
    orderBy: [{ batchId: "asc" }, { sequenceNo: "asc" }],
    skip,
    take: pageSize,
    include: {
      batch: true,
      productProfile: true,
      storyboardVariants: {
        orderBy: {
          variantNo: "asc",
        },
      },
    },
  });

  return c.json({
    data: items.map(buildScriptListItem),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    },
    filters: {
      batchId: batchId ?? null,
      selected: onlySelected,
    },
  });
});

export { scripts };
