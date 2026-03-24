import "dotenv/config";

function readEnv(name, fallback) {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value === "") {
    throw new Error(`${name} is required.`);
  }

  return value;
}

function readIntEnv(name, fallback) {
  const value = process.env[name] ?? fallback;
  const parsed = Number.parseInt(String(value), 10);

  if (Number.isNaN(parsed)) {
    throw new Error(`${name} must be a valid integer.`);
  }

  return parsed;
}

function readOptionalEnv(name, fallback) {
  const value = process.env[name] ?? fallback;

  if (value === undefined || value === "") {
    return undefined;
  }

  return value;
}

export const env = {
  databaseUrl: readEnv("DATABASE_URL"),
  port: readIntEnv("PORT", "3000"),
  nodeEnv: process.env.NODE_ENV ?? "development",
};

export function getScriptGenerationEnv() {
  const provider = readOptionalEnv("SCRIPT_GENERATION_PROVIDER", "openai") ?? "openai";

  const defaultBaseUrlByProvider = {
    openai: "https://api.openai.com/v1",
    gemini: "https://generativelanguage.googleapis.com/v1beta",
  };

  return {
    provider,
    baseUrl:
      readOptionalEnv("SCRIPT_GENERATION_BASE_URL", defaultBaseUrlByProvider[provider]) ??
      defaultBaseUrlByProvider[provider] ??
      defaultBaseUrlByProvider.openai,
    apiKey: readOptionalEnv("SCRIPT_GENERATION_API_KEY"),
    openaiApiKey: readOptionalEnv("OPENAI_API_KEY"),
    geminiApiKey: readOptionalEnv("GEMINI_API_KEY"),
    model:
      readOptionalEnv(
        "SCRIPT_GENERATION_MODEL",
        provider === "gemini" ? "gemini-2.0-flash" : "gpt-4.1-mini",
      ) ?? "gpt-4.1-mini",
    timeoutMs: readIntEnv("SCRIPT_GENERATION_TIMEOUT_MS", "30000"),
    language: readOptionalEnv("SCRIPT_GENERATION_LANGUAGE", "zh-CN") ?? "zh-CN",
  };
}
