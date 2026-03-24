import { ScriptStyleBase } from "@prisma/client";

import { getScriptGenerationEnv } from "../../lib/env.js";
import { ScriptGenerationError } from "./errors.js";
import { buildScriptGenerationMessages } from "./prompts.js";
import { createGeminiScriptGenerationProvider } from "./providers/gemini-script-generation-provider.js";
import { createOpenAIScriptGenerationProvider } from "./providers/openai-script-generation-provider.js";

const STYLE_BASE_BY_KEY = {
  stable_conversion: ScriptStyleBase.STABLE_CONVERSION,
  strong_hook: ScriptStyleBase.STRONG_HOOK,
  atmosphere_seeding: ScriptStyleBase.ATMOSPHERE_SEEDING,
  STABLE_CONVERSION: ScriptStyleBase.STABLE_CONVERSION,
  STRONG_HOOK: ScriptStyleBase.STRONG_HOOK,
  ATMOSPHERE_SEEDING: ScriptStyleBase.ATMOSPHERE_SEEDING,
};

const STYLE_BASE_SEQUENCE = [
  ScriptStyleBase.STABLE_CONVERSION,
  ScriptStyleBase.STRONG_HOOK,
  ScriptStyleBase.ATMOSPHERE_SEEDING,
];

function ensureObject(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value;
  }

  return {};
}

function normalizeStringList(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item !== "");
}

function normalizeStyleMix(rawStyleMix) {
  const styleMix = ensureObject(rawStyleMix);
  const normalized = STYLE_BASE_SEQUENCE.map((styleBase) => ({
    styleBase,
    weight: 0,
  }));

  for (const [key, value] of Object.entries(styleMix)) {
    const styleBase = STYLE_BASE_BY_KEY[key] ?? STYLE_BASE_BY_KEY[key.toUpperCase()];
    const weight = Number(value);

    if (!styleBase || Number.isNaN(weight) || weight <= 0) {
      continue;
    }

    const item = normalized.find((entry) => entry.styleBase === styleBase);
    if (item) {
      item.weight += weight;
    }
  }

  const validWeights = normalized.filter((item) => item.weight > 0);
  if (validWeights.length === 0) {
    return [];
  }

  return validWeights;
}

function buildStylePlan(count, styleMix) {
  if (count <= 0) {
    return [];
  }

  const normalizedStyleMix = normalizeStyleMix(styleMix);
  if (normalizedStyleMix.length === 0) {
    return Array.from({ length: count }, (_, index) => STYLE_BASE_SEQUENCE[index % STYLE_BASE_SEQUENCE.length]);
  }

  const scores = new Map(normalizedStyleMix.map((item) => [item.styleBase, 0]));
  const result = [];

  for (let index = 0; index < count; index += 1) {
    for (const item of normalizedStyleMix) {
      scores.set(item.styleBase, (scores.get(item.styleBase) ?? 0) + item.weight);
    }

    let bestStyleBase = normalizedStyleMix[0].styleBase;
    let bestScore = scores.get(bestStyleBase) ?? 0;

    for (const item of normalizedStyleMix) {
      const score = scores.get(item.styleBase) ?? 0;
      if (score > bestScore) {
        bestStyleBase = item.styleBase;
        bestScore = score;
      }
    }

    scores.set(bestStyleBase, bestScore - 1);
    result.push(bestStyleBase);
  }

  return result;
}

function getProvider(config = getScriptGenerationEnv()) {
  if (config.provider === "openai") {
    return createOpenAIScriptGenerationProvider({
      apiKey: config.apiKey ?? config.openaiApiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: config.timeoutMs,
    });
  }

  if (config.provider === "gemini") {
    return createGeminiScriptGenerationProvider({
      apiKey: config.apiKey ?? config.geminiApiKey,
      baseUrl: config.baseUrl,
      model: config.model,
      timeoutMs: config.timeoutMs,
    });
  }

  throw new ScriptGenerationError(
    "SCRIPT_PROVIDER_CONFIG",
    `Unsupported script generation provider: ${config.provider}.`,
    { retryable: false },
  );
}

export function validateScriptGenerationRuntimeConfig() {
  const config = getScriptGenerationEnv();
  getProvider(config);

  return {
    provider: config.provider,
    model: config.model,
    baseUrl: config.baseUrl,
  };
}

function sanitizeGeneratedScript(item, target) {
  if (!item || typeof item !== "object" || Array.isArray(item)) {
    throw new ScriptGenerationError(
      "SCRIPT_PROVIDER_INVALID_RESPONSE",
      "Each generated script item must be an object.",
    );
  }

  const script = ensureObject(item);
  const title =
    typeof script.title === "string" && script.title.trim() !== ""
      ? script.title.trim()
      : `脚本 ${target.sequenceNo}`;
  const hook =
    typeof script.hook === "string" && script.hook.trim() !== ""
      ? script.hook.trim()
      : title;
  const cta =
    typeof script.cta === "string" && script.cta.trim() !== "" ? script.cta.trim() : "适合日常场景持续使用";
  const scriptText =
    typeof script.scriptText === "string" && script.scriptText.trim() !== ""
      ? script.scriptText.trim()
      : `${hook} ${cta}`;

  return {
    styleBase: target.styleBase,
    title,
    hook,
    cta,
    scriptText,
    beatOutline: normalizeStringList(script.beatOutline).slice(0, 6),
    sellingPointsUsed: normalizeStringList(script.sellingPointsUsed).slice(0, 6),
    generationTags: normalizeStringList(script.generationTags).slice(0, 8),
    complianceNotes: normalizeStringList(script.complianceNotes).slice(0, 6),
  };
}

export async function generateScriptVariantsForTask({ batch, task, selectedReference, desiredCount }) {
  const existingCount = batch.scriptVariants.length;
  const toGenerate = Math.max(0, desiredCount - existingCount);
  const maxSequenceNo = batch.scriptVariants.reduce(
    (max, item) => Math.max(max, item.sequenceNo),
    0,
  );

  if (toGenerate === 0) {
    return {
      scripts: [],
      providerMetadata: {
        provider: "none",
        model: null,
        responseId: null,
      },
      targets: [],
      generatedCount: 0,
    };
  }

  const requestPayload = ensureObject(task.requestPayload);
  const stylePlan = buildStylePlan(
    toGenerate,
    requestPayload.styleMix ?? ensureObject(batch.settings).styleMix,
  );
  const targets = stylePlan.map((styleBase, index) => ({
    sequenceNo: maxSequenceNo + index + 1,
    styleBase,
  }));

  const config = getScriptGenerationEnv();
  const provider = getProvider(config);
  const messages = buildScriptGenerationMessages({
    batch,
    selectedReference,
    requestPayload,
    targets,
    language: config.language,
  });
  const generationResult = await provider.generate({ messages });

  if (generationResult.scripts.length !== targets.length) {
    throw new ScriptGenerationError(
      "SCRIPT_PROVIDER_INVALID_RESPONSE",
      `LLM returned ${generationResult.scripts.length} scripts, expected ${targets.length}.`,
    );
  }

  const scripts = generationResult.scripts.map((item, index) => {
    const sanitized = sanitizeGeneratedScript(item, targets[index]);

    if (sanitized.generationTags.length === 0) {
      sanitized.generationTags = ["llm", targets[index].styleBase.toLowerCase()];
    }

    if (sanitized.complianceNotes.length === 0) {
      sanitized.complianceNotes = ["避免绝对化与医疗暗示"];
    }

    if (sanitized.sellingPointsUsed.length === 0) {
      sanitized.sellingPointsUsed = normalizeStringList(batch.productProfile?.requiredSellingPoints).slice(
        0,
        3,
      );
    }

    return sanitized;
  });

  return {
    scripts,
    providerMetadata: generationResult.providerMetadata,
    targets,
    generatedCount: scripts.length,
  };
}
