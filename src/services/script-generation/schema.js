import { ScriptStyleBase } from "@prisma/client";

export const SCRIPT_GENERATION_SCHEMA_NAME = "script_generation_result";

export const SCRIPT_STYLE_BASE_VALUES = Object.values(ScriptStyleBase);

export const scriptGenerationResponseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scripts"],
  properties: {
    scripts: {
      type: "array",
      minItems: 1,
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "styleBase",
          "title",
          "hook",
          "scriptText",
          "cta",
          "beatOutline",
          "sellingPointsUsed",
          "generationTags",
          "complianceNotes",
        ],
        properties: {
          styleBase: {
            type: "string",
            enum: SCRIPT_STYLE_BASE_VALUES,
          },
          title: {
            type: "string",
            minLength: 4,
            maxLength: 60,
          },
          hook: {
            type: "string",
            minLength: 6,
            maxLength: 80,
          },
          scriptText: {
            type: "string",
            minLength: 40,
            maxLength: 1500,
          },
          cta: {
            type: "string",
            minLength: 4,
            maxLength: 60,
          },
          beatOutline: {
            type: "array",
            minItems: 3,
            maxItems: 6,
            items: {
              type: "string",
              minLength: 2,
              maxLength: 120,
            },
          },
          sellingPointsUsed: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 80,
            },
          },
          generationTags: {
            type: "array",
            minItems: 1,
            maxItems: 8,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 32,
            },
          },
          complianceNotes: {
            type: "array",
            minItems: 1,
            maxItems: 6,
            items: {
              type: "string",
              minLength: 1,
              maxLength: 120,
            },
          },
        },
      },
    },
  },
};
