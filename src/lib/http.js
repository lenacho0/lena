export function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);

  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
}

export function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

export function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export function conflict(message) {
  const error = new Error(message);
  error.status = 409;
  return error;
}

export function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}
