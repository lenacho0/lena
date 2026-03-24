import { SCRIPT_GENERATION_SCHEMA_NAME, scriptGenerationResponseSchema } from "../schema.js";
import { ScriptGenerationError, isScriptGenerationError } from "../errors.js";

function summarizeErrorBody(body) {
  if (!body || typeof body !== "object") {
    return "";
  }

  if (body.error && typeof body.error === "object") {
    const parts = [body.error.type, body.error.code, body.error.message].filter(
      (part) => typeof part === "string" && part.trim() !== "",
    );

    return parts.join(" | ");
  }

  return JSON.stringify(body).slice(0, 500);
}

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

async function safeReadJson(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function shouldRetryWithoutStructuredOutput(response, data) {
  if (!response || response.status !== 400) {
    return false;
  }

  const summary = summarizeErrorBody(data).toLowerCase();
  if (summary === "") {
    return false;
  }

  return (
    summary.includes("invalid argument") ||
    summary.includes("response_format") ||
    summary.includes("json_schema") ||
    summary.includes("unsupported")
  );
}

function extractContentText(data) {
  const content = data?.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim() !== "") {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((item) => {
        if (typeof item?.text === "string") {
          return item.text;
        }

        return "";
      })
      .join("")
      .trim();

    if (text !== "") {
      return text;
    }
  }

  throw new ScriptGenerationError(
    "SCRIPT_PROVIDER_INVALID_RESPONSE",
    "LLM response does not contain a JSON text payload.",
  );
}

export function createOpenAIScriptGenerationProvider({
  apiKey,
  baseUrl,
  model,
  timeoutMs,
  fetchImpl = globalThis.fetch,
} = {}) {
  if (!apiKey) {
    throw new ScriptGenerationError(
      "SCRIPT_PROVIDER_CONFIG",
      "SCRIPT_GENERATION_API_KEY or OPENAI_API_KEY is required for script generation.",
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
        const endpoint = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
        const baseHeaders = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        };
        const requestPayload = {
          model,
          response_format: {
            type: "json_schema",
            json_schema: {
              name: SCRIPT_GENERATION_SCHEMA_NAME,
              strict: true,
              schema: scriptGenerationResponseSchema,
            },
          },
          messages,
        };

        let response = await fetchImpl(endpoint, {
          method: "POST",
          headers: baseHeaders,
          body: JSON.stringify(requestPayload),
          signal: controller.signal,
        });
        let data = await safeReadJson(response);

        if (shouldRetryWithoutStructuredOutput(response, data)) {
          const fallbackMessages = [
            ...messages,
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: "请仅输出合法 JSON，对象结构必须包含 scripts 数组，不要输出 Markdown。",
                },
              ],
            },
          ];

          response = await fetchImpl(endpoint, {
            method: "POST",
            headers: baseHeaders,
            body: JSON.stringify({
              model,
              messages: fallbackMessages,
            }),
            signal: controller.signal,
          });
          data = await safeReadJson(response);
        }

        if (!response.ok) {
          const reason = summarizeErrorBody(data);
          const code = mapHttpStatusToErrorCode(response.status);
          throw new ScriptGenerationError(
            code,
            `OpenAI script generation failed with status ${response.status}${reason ? `: ${reason}` : "."}`,
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
            "OpenAI returned a non-JSON or empty response body.",
          );
        }

        const contentText = extractContentText(data);
        let parsed;
        try {
          parsed = JSON.parse(contentText);
        } catch (error) {
          throw new ScriptGenerationError(
            "SCRIPT_PROVIDER_INVALID_RESPONSE",
            "LLM response content is not valid JSON.",
            { cause: error },
          );
        }

        if (!Array.isArray(parsed.scripts)) {
          throw new ScriptGenerationError(
            "SCRIPT_PROVIDER_INVALID_RESPONSE",
            "LLM response JSON is missing the scripts array.",
          );
        }

        return {
          scripts: parsed.scripts,
          providerMetadata: {
            provider: "openai",
            model: data.model ?? model,
            responseId: data.id ?? null,
          },
        };
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") {
          throw new ScriptGenerationError(
            "SCRIPT_PROVIDER_TIMEOUT",
            `OpenAI script generation timed out after ${timeoutMs}ms.`,
            { cause: error },
          );
        }

        if (isScriptGenerationError(error)) {
          throw error;
        }

        if (error instanceof TypeError) {
          throw new ScriptGenerationError(
            "SCRIPT_PROVIDER_NETWORK",
            `OpenAI script generation request failed: ${error.message}`,
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
