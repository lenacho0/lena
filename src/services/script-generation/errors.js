const DEFAULT_RETRYABLE_CODES = new Set([
  "SCRIPT_PROVIDER_TIMEOUT",
  "SCRIPT_PROVIDER_NETWORK",
  "SCRIPT_PROVIDER_RATE_LIMIT",
  "SCRIPT_PROVIDER_UPSTREAM",
]);

export class ScriptGenerationError extends Error {
  constructor(code, message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = "ScriptGenerationError";
    this.code = code;
    this.retryable =
      typeof options.retryable === "boolean"
        ? options.retryable
        : DEFAULT_RETRYABLE_CODES.has(code);
    this.details = options.details ?? null;
  }
}

export function isScriptGenerationError(error) {
  return error instanceof ScriptGenerationError;
}

