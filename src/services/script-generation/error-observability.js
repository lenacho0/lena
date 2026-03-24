const OBSERVABILITY_BY_ERROR_CODE = {
  SCRIPT_PROVIDER_AUTH: {
    alertLevel: "HIGH",
    metricKey: "script_generation.provider_auth",
    retryable: false,
  },
  SCRIPT_PROVIDER_RATE_LIMIT: {
    alertLevel: "MEDIUM",
    metricKey: "script_generation.provider_rate_limit",
    retryable: true,
  },
  SCRIPT_PROVIDER_TIMEOUT: {
    alertLevel: "MEDIUM",
    metricKey: "script_generation.provider_timeout",
    retryable: true,
  },
  SCRIPT_PROVIDER_NETWORK: {
    alertLevel: "MEDIUM",
    metricKey: "script_generation.provider_network",
    retryable: true,
  },
  SCRIPT_PROVIDER_UPSTREAM: {
    alertLevel: "MEDIUM",
    metricKey: "script_generation.provider_upstream",
    retryable: true,
  },
  SCRIPT_PROVIDER_BAD_REQUEST: {
    alertLevel: "HIGH",
    metricKey: "script_generation.provider_bad_request",
    retryable: false,
  },
  SCRIPT_PROVIDER_INVALID_RESPONSE: {
    alertLevel: "HIGH",
    metricKey: "script_generation.provider_invalid_response",
    retryable: false,
  },
  SCRIPT_PROVIDER_CONFIG: {
    alertLevel: "HIGH",
    metricKey: "script_generation.provider_config",
    retryable: false,
  },
  WORKER_ERROR: {
    alertLevel: "HIGH",
    metricKey: "script_generation.worker_error",
    retryable: false,
  },
};

function resolveTelemetrySpec(errorCode) {
  if (
    errorCode &&
    typeof errorCode === "string" &&
    errorCode in OBSERVABILITY_BY_ERROR_CODE
  ) {
    return OBSERVABILITY_BY_ERROR_CODE[errorCode];
  }

  return {
    alertLevel: "HIGH",
    metricKey: "script_generation.unknown_error",
    retryable: false,
  };
}

export function buildScriptGenerationErrorTelemetry({
  errorCode,
  providerRetryable,
  willRetry,
}) {
  const spec = resolveTelemetrySpec(errorCode);

  return {
    errorCode,
    alertLevel: spec.alertLevel,
    metricKey: spec.metricKey,
    retryable:
      typeof providerRetryable === "boolean" ? providerRetryable : spec.retryable,
    willRetry: Boolean(willRetry),
  };
}

