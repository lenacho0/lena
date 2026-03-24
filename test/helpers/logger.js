export const QUIET_LOGGER = () => {};

export function createBufferedLogger() {
  const entries = [];

  function log(level, event, payload = {}) {
    entries.push({
      level,
      event,
      payload,
    });
  }

  return {
    log,
    entries,
  };
}
