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

export function buildScriptGenerationMessages({
  batch,
  selectedReference,
  requestPayload,
  targets,
  language,
}) {
  const productProfile = batch.productProfile;
  const referenceVideo = selectedReference.referenceVideo;
  const synthesisPayload = ensureObject(batch.referenceSynthesisResult?.synthesisPayload);
  const styleMix = ensureObject(requestPayload.styleMix ?? batch.settings?.styleMix);

  const promptPayload = {
    locale: language,
    generationGoal: {
      totalRequestedCount: requestPayload.desiredCount,
      newScriptsToGenerate: targets.length,
      outputOrderMustMatchTargets: true,
    },
    targets: targets.map((target) => ({
      sequenceNo: target.sequenceNo,
      styleBase: target.styleBase,
    })),
    product: {
      brandName: productProfile.brandName,
      productName: productProfile.productName,
      productCategory: productProfile.productCategory,
      targetSpecies: productProfile.targetSpecies,
      productSummary: productProfile.productSummary,
      sellingPoints: normalizeStringList(productProfile.sellingPoints),
      requiredSellingPoints: normalizeStringList(productProfile.requiredSellingPoints),
      allowedClaims: normalizeStringList(productProfile.allowedClaims),
      forbiddenClaims: normalizeStringList(productProfile.forbiddenClaims),
      usageScenarios: normalizeStringList(productProfile.usageScenarios),
      toneConstraints: ensureObject(productProfile.toneConstraints),
      notes: productProfile.notes,
    },
    selectedReferenceVideo: {
      id: referenceVideo.id,
      platform: referenceVideo.platform,
      title: referenceVideo.title,
      authorName: referenceVideo.authorName,
      description: referenceVideo.description,
      durationSeconds: referenceVideo.durationSeconds ? Number(referenceVideo.durationSeconds) : null,
      publishedAt: referenceVideo.publishedAt,
      playCount: referenceVideo.playCount?.toString() ?? null,
      likeCount: referenceVideo.likeCount?.toString() ?? null,
    },
    referenceSynthesis: {
      hookPattern: synthesisPayload.hookPattern ?? null,
      rhythm: Array.isArray(synthesisPayload.rhythm) ? synthesisPayload.rhythm : [],
      ctaPattern: synthesisPayload.ctaPattern ?? null,
    },
    styleMix,
    operatorRequest: ensureObject(requestPayload),
  };

  return [
    {
      role: "system",
      content: [
        {
          type: "text",
          text:
            "你是一名擅长中文短视频电商口播脚本的策划。请基于产品信息、参考视频和风格目标生成可直接落库的脚本方案。" +
            "必须严格遵守输出 JSON Schema，不要输出 Markdown，不要补充额外解释。" +
            "每条脚本都要避免医疗暗示、绝对化承诺和未提供依据的数据，对 forbiddenClaims 必须显式规避。" +
            "scripts 数组顺序必须与 targets 一致，每条 script.styleBase 必须与对应 target.styleBase 完全一致。" +
            "scriptText 使用简体中文，控制在适合 20-35 秒短视频口播的长度，包含钩子、场景/痛点、卖点展开和自然 CTA。" +
            "每条脚本至少覆盖 1 个 requiredSellingPoints 或 sellingPoints，并在 sellingPointsUsed 中体现。",
        },
      ],
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: JSON.stringify(promptPayload, null, 2),
        },
      ],
    },
  ];
}
