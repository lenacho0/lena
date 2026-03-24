import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, AssetRole, AssetType, BatchStatus, ComplianceTargetType, RiskLevel, ScriptStyleBase, SourcePlatform, TaskStatus, TaskType } from "@prisma/client";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required for the seed script.");
}

const adapter = new PrismaPg({
  connectionString: process.env.DATABASE_URL,
});

const prisma = new PrismaClient({ adapter });

const ids = {
  batch: "00000000-0000-0000-0000-000000000001",
  referenceVideo: "00000000-0000-0000-0000-000000000101",
  batchReferenceVideo: "00000000-0000-0000-0000-000000000102",
  mediaPrepResult: "00000000-0000-0000-0000-000000000103",
  videoAnalysisResult: "00000000-0000-0000-0000-000000000104",
  referenceSynthesisResult: "00000000-0000-0000-0000-000000000105",
  productProfile: "00000000-0000-0000-0000-000000000106",
  scriptVariant: "00000000-0000-0000-0000-000000000107",
  storyboardVariant: "00000000-0000-0000-0000-000000000108",
  generationTaskScript: "00000000-0000-0000-0000-000000000109",
  generationTaskStoryboard: "00000000-0000-0000-0000-000000000110",
  complianceCheck: "00000000-0000-0000-0000-000000000111",
  exportPackage: "00000000-0000-0000-0000-000000000112",
  assetReferenceCover: "00000000-0000-0000-0000-000000000113",
  assetReferenceVideo: "00000000-0000-0000-0000-000000000114",
  assetProductWhiteBg: "00000000-0000-0000-0000-000000000115",
  assetHumanReference: "00000000-0000-0000-0000-000000000116",
  assetPetReference: "00000000-0000-0000-0000-000000000117",
  assetStoryboardGrid: "00000000-0000-0000-0000-000000000118",
  assetExportZip: "00000000-0000-0000-0000-000000000119",
};

async function clearDatabase() {
  await prisma.asset.deleteMany();
  await prisma.complianceCheck.deleteMany();
  await prisma.exportPackage.deleteMany();
  await prisma.generationTask.deleteMany();
  await prisma.storyboardVariant.deleteMany();
  await prisma.scriptVariant.deleteMany();
  await prisma.videoAnalysisResult.deleteMany();
  await prisma.mediaPrepResult.deleteMany();
  await prisma.referenceSynthesisResult.deleteMany();
  await prisma.productProfile.deleteMany();
  await prisma.batchReferenceVideo.deleteMany();
  await prisma.referenceVideo.deleteMany();
  await prisma.batch.deleteMany();
}

async function seed() {
  await clearDatabase();

  await prisma.batch.create({
    data: {
      id: ids.batch,
      name: "宠物除臭喷雾创意测试批次",
      description: "用于联调批次、脚本、九镜头和导出链路的最小示例数据。",
      status: BatchStatus.SCRIPTS_READY,
      referenceVideoLimit: 1,
      scriptTargetCount: 10,
      progressPercent: "68.50",
      scriptGeneratedCount: 1,
      storyboardGeneratedCount: 1,
      failedTaskCount: 0,
      settings: {
        scriptCount: 10,
        concurrency: {
          scriptGeneration: 3,
          storyboardGeneration: 2,
        },
        styleMix: {
          stable_conversion: 0.5,
          strong_hook: 0.3,
          atmosphere_seeding: 0.2,
        },
      },
    },
  });

  await prisma.referenceVideo.create({
    data: {
      id: ids.referenceVideo,
      platform: SourcePlatform.TIKTOK,
      sourceProvider: "fastmoss",
      externalVideoId: "tt_demo_viral_video_001",
      authorExternalId: "tt_author_9001",
      authorName: "PetHome Lab",
      authorHandle: "@pethomelab",
      title: "3秒去味的宠物家庭清洁秘诀",
      description: "宠物异味处理前后对比，突出居家清洁感与情绪转化。",
      videoUrl: "https://example.com/reference-video.mp4",
      coverUrl: "https://example.com/reference-cover.jpg",
      durationSeconds: "27.50",
      publishedAt: new Date("2026-03-10T08:00:00.000Z"),
      playCount: 1280000n,
      likeCount: 96300n,
      commentCount: 1840n,
      shareCount: 6270n,
      engagementRate: "0.0812",
      rawPayload: {
        source: "fastmoss",
        tags: ["pet", "odor-removal", "home-cleaning"],
      },
    },
  });

  await prisma.batchReferenceVideo.create({
    data: {
      id: ids.batchReferenceVideo,
      batchId: ids.batch,
      referenceVideoId: ids.referenceVideo,
      isSelected: true,
      selectionRank: 1,
      selectedAt: new Date("2026-03-23T11:10:00.000Z"),
      querySnapshot: {
        keyword: "pet deodorizer",
        filters: {
          playCountMin: 500000,
          publishedWithinDays: 30,
        },
        sortBy: "play_count_desc",
      },
      notes: "V1 仅选择 1 条参考视频，这里保留选中快照。",
    },
  });

  await prisma.productProfile.create({
    data: {
      id: ids.productProfile,
      batchId: ids.batch,
      brandName: "FurFresh",
      productName: "宠物家庭除臭喷雾",
      productCategory: "pet_deodorizer",
      targetSpecies: "cat_dog",
      productSummary: "面向有猫狗家庭的日常除味喷雾，主打快速除味与温和配方。",
      sellingPoints: [
        "快速中和宠物异味",
        "适合沙发、地毯、宠物窝周边使用",
        "温和不刺鼻",
      ],
      allowedClaims: [
        "帮助改善居家异味感受",
        "适合日常环境清洁辅助使用",
      ],
      forbiddenClaims: [
        "医疗级杀菌",
        "对所有异味100%永久消除",
      ],
      requiredSellingPoints: [
        "温和配方",
        "适用宠物家庭场景",
      ],
      usageScenarios: [
        "客厅布艺",
        "宠物窝周边",
        "地毯和角落",
      ],
      toneConstraints: {
        style: "clean_and_reassuring",
        mustAvoid: ["夸大功效", "医疗暗示"],
      },
      notes: "产品白底图、真人角色图、宠物角色图均已上传。",
    },
  });

  await prisma.referenceSynthesisResult.create({
    data: {
      id: ids.referenceSynthesisResult,
      batchId: ids.batch,
      status: TaskStatus.SUCCEEDED,
      sourceVideoCount: 1,
      synthesisPayload: {
        hookPattern: "先展示异味困扰，再立刻给出清爽反差",
        rhythm: ["脏乱/困扰", "喷洒动作", "清爽反馈", "情绪收束"],
        ctaPattern: "引导用户把产品纳入日常清洁流程",
      },
      traceabilityPayload: {
        sourceVideoIds: [ids.referenceVideo],
        confidence: 0.93,
      },
    },
  });

  await prisma.generationTask.createMany({
    data: [
      {
        id: ids.generationTaskScript,
        batchId: ids.batch,
        taskType: TaskType.SCRIPT_GENERATION,
        status: TaskStatus.SUCCEEDED,
        priority: 100,
        targetType: "script_variant",
        targetId: ids.scriptVariant,
        requestPayload: {
          styleBase: "stable_conversion",
          desiredCount: 10,
        },
        resultPayload: {
          generatedCount: 1,
          selectedCount: 1,
        },
        retryCount: 0,
        maxRetries: 3,
        queuedAt: new Date("2026-03-23T11:11:00.000Z"),
        startedAt: new Date("2026-03-23T11:11:05.000Z"),
        finishedAt: new Date("2026-03-23T11:11:20.000Z"),
      },
      {
        id: ids.generationTaskStoryboard,
        batchId: ids.batch,
        taskType: TaskType.STORYBOARD_IMAGE_GENERATION,
        status: TaskStatus.SUCCEEDED,
        priority: 120,
        targetType: "storyboard_variant",
        targetId: ids.storyboardVariant,
        requestPayload: {
          storyboardVariantId: ids.storyboardVariant,
          mode: "grid_3x3",
        },
        resultPayload: {
          imageCount: 1,
        },
        retryCount: 0,
        maxRetries: 3,
        queuedAt: new Date("2026-03-23T11:12:00.000Z"),
        startedAt: new Date("2026-03-23T11:12:10.000Z"),
        finishedAt: new Date("2026-03-23T11:12:45.000Z"),
      },
    ],
  });

  await prisma.scriptVariant.create({
    data: {
      id: ids.scriptVariant,
      batchId: ids.batch,
      productProfileId: ids.productProfile,
      referenceSynthesisResultId: ids.referenceSynthesisResult,
      sequenceNo: 1,
      styleBase: ScriptStyleBase.STABLE_CONVERSION,
      title: "异味困扰到清爽安心",
      scriptText: "开头展示沙发边宠物异味困扰，随后主角喷洒产品并快速切到清爽整洁的家庭氛围，最后强调适合宠物家庭日常使用。",
      scriptPayload: {
        hook: "宠物味道一上来，整个客厅都不想待？",
        body: [
          "镜头给到宠物窝和沙发一角，营造真实生活感",
          "主角拿起喷雾，动作干净利落",
          "切到空间观感明显更清爽的对比",
        ],
        cta: "放在家里顺手一喷，日常更安心。",
      },
      generationTags: ["conversion", "pet", "odor-removal"],
      sourceTrace: {
        referenceVideoId: ids.referenceVideo,
        sellingPointsUsed: ["快速中和宠物异味", "温和不刺鼻"],
      },
      originType: "generated",
      isSelected: true,
    },
  });

  await prisma.storyboardVariant.create({
    data: {
      id: ids.storyboardVariant,
      batchId: ids.batch,
      scriptVariantId: ids.scriptVariant,
      variantNo: 1,
      status: TaskStatus.SUCCEEDED,
      systemPayload: {
        globalConstraints: {
          humanCharacter: "30岁左右女性，居家休闲穿搭",
          petCharacter: "浅色柴犬，中型犬",
          productConsistency: "白色瓶身+浅绿色标签",
          style: "自然居家、明亮清爽、无任何文字覆盖",
        },
        shots: [
          { shotNo: 1, visual: "客厅布艺区域，主人皱眉闻到异味", camera: "eye_level", framing: "medium", action: "停顿观察", productPosition: "not_shown", durationSeconds: 2.5 },
          { shotNo: 2, visual: "柴犬趴在窝边，环境略显凌乱", camera: "low_angle", framing: "wide", action: "轻微摆尾", productPosition: "not_shown", durationSeconds: 2.0 },
          { shotNo: 3, visual: "主角拿起喷雾特写", camera: "close_up", framing: "close", action: "抬手举起产品", productPosition: "center", durationSeconds: 1.5 },
          { shotNo: 4, visual: "朝沙发和窝边喷洒", camera: "tracking", framing: "medium", action: "连续喷两下", productPosition: "right", durationSeconds: 2.0 },
          { shotNo: 5, visual: "空气感更清爽，主人神情放松", camera: "eye_level", framing: "medium", action: "轻呼气", productPosition: "left", durationSeconds: 2.0 },
          { shotNo: 6, visual: "宠物靠近主人，互动自然", camera: "eye_level", framing: "medium_wide", action: "宠物蹭腿", productPosition: "not_shown", durationSeconds: 2.0 },
          { shotNo: 7, visual: "客厅整体更整洁明亮", camera: "wide", framing: "wide", action: "轻推镜", productPosition: "table", durationSeconds: 2.5 },
          { shotNo: 8, visual: "产品与干净布艺环境同框", camera: "product_focus", framing: "close", action: "静态展示", productPosition: "center", durationSeconds: 1.5 },
          { shotNo: 9, visual: "主人抱着宠物坐在沙发上，画面收束", camera: "eye_level", framing: "wide", action: "微笑互动", productPosition: "table", durationSeconds: 2.0 },
        ],
      },
      currentPayload: {
        globalConstraints: {
          humanCharacter: "30岁左右女性，居家休闲穿搭",
          petCharacter: "浅色柴犬，中型犬",
          productConsistency: "白色瓶身+浅绿色标签",
          style: "自然居家、明亮清爽、无任何文字覆盖",
        },
        shots: [
          { shotNo: 1, visual: "客厅布艺区域，主人皱眉闻到异味", camera: "eye_level", framing: "medium", action: "停顿观察", productPosition: "not_shown", durationSeconds: 2.5 },
          { shotNo: 2, visual: "柴犬趴在窝边，环境略显凌乱", camera: "low_angle", framing: "wide", action: "轻微摆尾", productPosition: "not_shown", durationSeconds: 2.0 },
          { shotNo: 3, visual: "主角拿起喷雾特写", camera: "close_up", framing: "close", action: "抬手举起产品", productPosition: "center", durationSeconds: 1.5 },
          { shotNo: 4, visual: "朝沙发和窝边喷洒", camera: "tracking", framing: "medium", action: "连续喷两下", productPosition: "right", durationSeconds: 2.0 },
          { shotNo: 5, visual: "空气感更清爽，主人神情放松", camera: "eye_level", framing: "medium", action: "轻呼气", productPosition: "left", durationSeconds: 2.0 },
          { shotNo: 6, visual: "宠物靠近主人，互动自然", camera: "eye_level", framing: "medium_wide", action: "宠物蹭腿", productPosition: "not_shown", durationSeconds: 2.0 },
          { shotNo: 7, visual: "客厅整体更整洁明亮", camera: "wide", framing: "wide", action: "轻推镜", productPosition: "table", durationSeconds: 2.5 },
          { shotNo: 8, visual: "产品与干净布艺环境同框", camera: "product_focus", framing: "close", action: "静态展示", productPosition: "center", durationSeconds: 1.5 },
          { shotNo: 9, visual: "主人抱着宠物坐在沙发上，画面收束", camera: "eye_level", framing: "wide", action: "微笑互动", productPosition: "table", durationSeconds: 2.0 },
        ],
        note: "当前示例未修改系统默认版，便于前端直接联调。",
      },
      sourceScriptSnapshot: {
        title: "异味困扰到清爽安心",
        scriptText: "开头展示沙发边宠物异味困扰，随后主角喷洒产品并快速切到清爽整洁的家庭氛围，最后强调适合宠物家庭日常使用。",
      },
      isUserEdited: false,
      imageGenerationCount: 1,
    },
  });

  await prisma.complianceCheck.create({
    data: {
      id: ids.complianceCheck,
      batchId: ids.batch,
      sourceTaskId: ids.generationTaskStoryboard,
      targetType: ComplianceTargetType.STORYBOARD_VARIANT,
      targetId: ids.storyboardVariant,
      status: TaskStatus.SUCCEEDED,
      checkerVendor: "internal",
      checkerVersion: "v1",
      riskLevel: RiskLevel.LOW,
      issueCount: 1,
      issues: [
        {
          level: "low",
          code: "CLAIM_SOFTENING",
          message: "建议保持‘帮助改善异味感受’表述，不要延展成绝对化承诺。",
        },
      ],
      suggestionSummary: "当前内容可用，建议继续避免绝对化功效表达。",
    },
  });

  await prisma.exportPackage.create({
    data: {
      id: ids.exportPackage,
      batchId: ids.batch,
      sourceTaskId: ids.generationTaskStoryboard,
      status: TaskStatus.SUCCEEDED,
      fileName: "viral-video-storyboard-demo-export.zip",
      exportScope: {
        includeScripts: true,
        includeStoryboardJson: true,
        includeStoryboardImages: true,
      },
      includedScriptCount: 1,
      includedStoryboardCount: 1,
      includedJsonCount: 1,
      downloadExpiresAt: new Date("2026-03-30T11:30:00.000Z"),
      completedAt: new Date("2026-03-23T11:29:00.000Z"),
    },
  });

  await prisma.asset.createMany({
    data: [
      {
        id: ids.assetReferenceCover,
        batchId: ids.batch,
        referenceVideoId: ids.referenceVideo,
        batchReferenceVideoId: ids.batchReferenceVideo,
        assetType: AssetType.IMAGE,
        assetRole: AssetRole.REFERENCE_VIDEO_COVER,
        sourceProvider: "fastmoss",
        storageProvider: "s3",
        bucketName: "demo-assets",
        storageKey: "reference/cover-001.jpg",
        fileName: "reference-cover.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 183245,
        width: 1080,
        height: 1920,
        externalUrl: "https://example.com/reference-cover.jpg",
        meta: {
          usage: "reference_video_cover",
        },
      },
      {
        id: ids.assetReferenceVideo,
        batchId: ids.batch,
        referenceVideoId: ids.referenceVideo,
        batchReferenceVideoId: ids.batchReferenceVideo,
        assetType: AssetType.VIDEO,
        assetRole: AssetRole.REFERENCE_VIDEO_DOWNLOADED,
        sourceProvider: "system",
        storageProvider: "s3",
        bucketName: "demo-assets",
        storageKey: "reference/video-001.mp4",
        fileName: "reference-video.mp4",
        mimeType: "video/mp4",
        fileSizeBytes: 12480231,
        durationSeconds: "27.50",
        externalUrl: "https://example.com/reference-video.mp4",
        meta: {
          usage: "analysis_input",
        },
      },
      {
        id: ids.assetProductWhiteBg,
        batchId: ids.batch,
        productProfileId: ids.productProfile,
        assetType: AssetType.IMAGE,
        assetRole: AssetRole.PRODUCT_WHITE_BG,
        bucketName: "demo-assets",
        storageKey: "product/product-white-bg.png",
        fileName: "product-white-bg.png",
        mimeType: "image/png",
        fileSizeBytes: 542331,
        width: 1600,
        height: 1600,
        externalUrl: "https://example.com/product-white-bg.png",
        meta: {},
      },
      {
        id: ids.assetHumanReference,
        batchId: ids.batch,
        productProfileId: ids.productProfile,
        assetType: AssetType.IMAGE,
        assetRole: AssetRole.HUMAN_REFERENCE,
        bucketName: "demo-assets",
        storageKey: "reference/human-001.jpg",
        fileName: "human-reference.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 298112,
        width: 1024,
        height: 1536,
        externalUrl: "https://example.com/human-reference.jpg",
        meta: {},
      },
      {
        id: ids.assetPetReference,
        batchId: ids.batch,
        productProfileId: ids.productProfile,
        assetType: AssetType.IMAGE,
        assetRole: AssetRole.PET_REFERENCE,
        bucketName: "demo-assets",
        storageKey: "reference/pet-001.jpg",
        fileName: "pet-reference.jpg",
        mimeType: "image/jpeg",
        fileSizeBytes: 264901,
        width: 1024,
        height: 1024,
        externalUrl: "https://example.com/pet-reference.jpg",
        meta: {},
      },
      {
        id: ids.assetStoryboardGrid,
        batchId: ids.batch,
        scriptVariantId: ids.scriptVariant,
        storyboardVariantId: ids.storyboardVariant,
        assetType: AssetType.IMAGE,
        assetRole: AssetRole.STORYBOARD_GRID,
        bucketName: "demo-assets",
        storageKey: "storyboard/grid-001.png",
        fileName: "storyboard-grid-001.png",
        mimeType: "image/png",
        fileSizeBytes: 1684201,
        width: 2048,
        height: 2048,
        externalUrl: "https://example.com/storyboard-grid-001.png",
        meta: {},
      },
      {
        id: ids.assetExportZip,
        batchId: ids.batch,
        exportPackageId: ids.exportPackage,
        assetType: AssetType.ARCHIVE,
        assetRole: AssetRole.EXPORT_ZIP,
        bucketName: "demo-assets",
        storageKey: "exports/viral-video-storyboard-demo-export.zip",
        fileName: "viral-video-storyboard-demo-export.zip",
        mimeType: "application/zip",
        fileSizeBytes: 2419820,
        externalUrl: "https://example.com/viral-video-storyboard-demo-export.zip",
        meta: {},
      },
    ],
  });

  await prisma.mediaPrepResult.create({
    data: {
      id: ids.mediaPrepResult,
      batchReferenceVideoId: ids.batchReferenceVideo,
      referenceVideoId: ids.referenceVideo,
      status: TaskStatus.SUCCEEDED,
      downloadStrategy: "primary",
      preparedSpec: {
        format: "mp4",
        resolution: "1080x1920",
        fps: 30,
      },
      diagnosticPayload: {
        retries: 0,
        source: "internal-downloader",
      },
    },
  });

  await prisma.videoAnalysisResult.create({
    data: {
      id: ids.videoAnalysisResult,
      batchReferenceVideoId: ids.batchReferenceVideo,
      referenceVideoId: ids.referenceVideo,
      status: TaskStatus.SUCCEEDED,
      analyzerVendor: "google",
      analyzerModel: "gemini-2.5-pro",
      confidenceScore: "92.50",
      normalizedTags: ["hook", "pet", "odor-removal", "home-scene"],
      summaryPayload: {
        hook: "异味困扰前置",
        sellingAngle: "快速改善居家体感",
        cta: "顺手加入日常清洁流程",
      },
      analysisPayload: {
        structure: ["问题出现", "产品出场", "快速处理", "结果反馈", "情绪收束"],
        emotionCurve: ["嫌弃", "期待", "放松", "安心"],
        subtitleStyle: "口语化短句",
      },
    },
  });
}

seed()
  .then(async () => {
    console.log("Seed completed successfully.");
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error("Seed failed.");
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
