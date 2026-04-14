export function logInfo(message, extra) {
  logWithLevel("INFO", message, extra);
}

export function logWarn(message, extra) {
  logWithLevel("WARN", message, extra);
}

export function logError(message, extra) {
  logWithLevel("ERROR", message, extra);
}

function logWithLevel(level, message, extra) {
  const timestamp = new Date().toISOString();
  if (extra !== undefined) {
    console.log(`[${timestamp}] [${level}] ${message}`, extra);
    return;
  }

  console.log(`[${timestamp}] [${level}] ${message}`);
}
