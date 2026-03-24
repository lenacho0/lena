import { scriptGenerationResponseSchema } from "../schema.js";
import { ScriptGenerationError, isScriptGenerationError } from "../errors.js";

function mapHttpStatusToErrorCode(status) {
  if (status === 401 || status === 403) {
    return "SCRIPT_PROVIDER_AUTH";
  }

  if (status === 429) {
    return "SCRIPT_PROVIDER_RATE_LIMIT";
  }

  if (status >= 500) {
    return "SCRIPT_PROVIDER_UPSTREAM";
  }

  return "SCRIPT_PROVIDER_BAD_REQUEST";
}

function summarizeErrorBody(body) {
  if (!body || typeof body !== "object") {
    return "";
  }

  if (body.error && typeof body.error === "object") {
    const parts = [body.error.status, body.error.code, body.error.message].filter(
      (part) => typeof part === "string" && part.trim() !== "",
    );

    return parts.join(" | ");
  }

  return JSON.stringify(body).slice(0, 500);
}

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function extractMessageText(content) {
  if (typeof content === "string") {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item?.text === "string") {
          return item.text;
        }

        return "";
      })
      .join("");
  }

  return "";
}

function toGeminiPrompt(messages) {
  const systemParts = [];
  const contents = [];

  for (const message of messages ?? []) {
    const text = extractMessageText(message?.content).trim();
    if (text === "") {
      continue;
    }

    if (message.role === "system") {
      systemParts.push({ text });
      continue;
    }

    const role = message.role === "assistant" ? "model" : "user";
    contents.push({
      role,
      parts: [{ text }],
    });
  }

  if (contents.length === 0) {
    throw new ScriptGenerationError(
      "SCRIPT_PROVIDER_BAD_REQUEST",
      "Gemini request has no user/model prompt content.",
      { retryable: false },
    );
  }

  return {
    systemInstruction:
      systemParts.length > 0
        ? {
            parts: systemParts,
          }
        : undefined,
    contents,
  };
}

function extractContentText(data) {
  const parts = data?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) {
    throw new ScriptGenerationError(
      "SCRIPT_PROVIDER_INVALID_RESPONSE",
      "Gemini response does not include candidates[0].content.parts.",
    );
  }

  const text = parts
    .map((part) => {
      if (typeof part?.text === "string") {
        return part.text;
      }

      return "";
    })
    .join("")
    .trim();

  if (text === "") {
    throw new ScriptGenerationError(
      "SCRIPT_PROVIDER_INVALID_RESPONSE",
      "Gemini response does not contain JSON text payload.",
    );
  }

  return text;
}

export function createGeminiScriptGenerationProvider({
  apiKey,
  baseUrl,
  model,
  timeoutMs,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) {
    throw new ScriptGenerationError(
      "SCRIPT_PROVIDER_CONFIG",
      "SCRIPT_GENERATION_API_KEY or GEMINI_API_KEY is required for Gemini script generation.",
      { retryable: false },
    );
  }

  if (typeof fetchImpl !== "function") {
    throw new ScriptGenerationError(
      "SCRIPT_PROVIDER_CONFIG",
      "Global fetch is unavailable in the current runtime.",
      { retryable: false },
    );
  }

  return {
    async generate({ messages }) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const promptPayload = toGeminiPrompt(messages);
        const endpoint = `${baseUrl.replace(/\/$/, "")}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ...promptPayload,
            generationConfig: {
              responseMimeType: "application/json",
              responseSchema: scriptGenerationResponseSchema,
            },
          }),
          signal: controller.signal,
        });

        const data = await safeReadJson(response);

        if (!response.ok) {
          const reason = summarizeErrorBody(data);
          const code = mapHttpStatusToErrorCode(response.status);
          throw new ScriptGenerationError(
            code,
            `Gemini script generation failed with status ${response.status}${reason ? `: ${reason}` : "."}`,
            {
              details: {
                status: response.status,
                body: data,
              },
            },
          );
        }

        if (!data || typeof data !== "object") {
          throw new ScriptGenerationError(
            "SCRIPT_PROVIDER_INVALID_RESPONSE",
            "Gemini returned a non-JSON or empty response body.",
          );
        }

        const contentText = extractContentText(data);
        let parsed;
        try {
          parsed = JSON.parse(contentText);
        } catch (error) {
          throw new ScriptGenerationError(
            "SCRIPT_PROVIDER_INVALID_RESPONSE",
            "Gemini response content is not valid JSON.",
            { cause: error },
          );
        }

        if (!Array.isArray(parsed.scripts)) {
          throw new ScriptGenerationError(
            "SCRIPT_PROVIDER_INVALID_RESPONSE",
            "Gemini response JSON is missing the scripts array.",
          );
        }

        return {
          scripts: parsed.scripts,
          providerMetadata: {
            provider: "gemini",
            model: data.modelVersion ?? model,
            responseId: data.responseId ?? null,
          },
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new ScriptGenerationError(
            "SCRIPT_PROVIDER_TIMEOUT",
            `Gemini script generation timed out after ${timeoutMs}ms.`,
            { cause: error },
          );
        }

        if (isScriptGenerationError(error)) {
          throw error;
        }

        if (error instanceof TypeError) {
          throw new ScriptGenerationError(
            "SCRIPT_PROVIDER_NETWORK",
            `Gemini script generation request failed: ${error.message}`,
            { cause: error },
          );
        }

        throw error;
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}
