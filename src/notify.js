import { execFile } from "node:child_process";
import os from "node:os";
import { promisify } from "node:util";
import { logInfo, logWarn } from "./logger.js";

const execFileAsync = promisify(execFile);

export async function sendNotification(config, payload) {
  if (config?.notifications?.console !== false) {
    logInfo(`Notification: ${payload.title}`, payload);
  }

  if (config?.notifications?.desktop !== false) {
    await sendDesktopNotification(payload);
  }

  const webhookUrl = config?.notifications?.webhookUrl;
  if (!webhookUrl) {
    return;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      logWarn(`Webhook responded with ${response.status}.`);
    }
  } catch (error) {
    logWarn("Failed to send webhook notification.", error.message);
  }
}

async function sendDesktopNotification(payload) {
  if (os.platform() !== "darwin") {
    return;
  }

  const title = escapeAppleScript(payload.title ?? "Ticket update");
  const subtitle = escapeAppleScript(payload.date ?? "");
  const message = escapeAppleScript(
    payload.state
      ? `State: ${payload.state}`
      : Array.isArray(payload.matchedSlots) && payload.matchedSlots.length > 0
        ? payload.matchedSlots.join(" | ")
        : payload.url ?? "",
  );

  const script = `display notification "${message}" with title "${title}" subtitle "${subtitle}" sound name "Glass"`;

  try {
    await execFileAsync("osascript", ["-e", script]);
  } catch (error) {
    logWarn("Failed to send desktop notification.", error.message);
  }
}

function escapeAppleScript(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}
