import fs from "node:fs";
import path from "node:path";
import { createBrowserSession } from "./browser.js";
import { logInfo } from "./logger.js";

const INTERESTING_PATTERNS = [
  "calendar",
  "availability",
  "ticket",
  "tickets",
  "schedule",
  "time",
  "slot",
  "visit",
  "book",
  "purchase",
  "cart",
  "api",
  "graphql",
  "recaptcha",
];

export async function inspectApi(config, artifactsDir) {
  const session = await createBrowserSession({
    ...config,
    monitor: {
      ...config.monitor,
      headless: false,
    },
  });

  const events = [];

  try {
    session.page.on("request", (request) => {
      events.push({
        type: "request",
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
        postData: trimText(request.postData() ?? ""),
      });
    });

    session.page.on("response", async (response) => {
      const request = response.request();
      const url = response.url();
      const resourceType = request.resourceType();
      const record = {
        type: "response",
        method: request.method(),
        url,
        resourceType,
        status: response.status(),
        contentType: response.headers()["content-type"] ?? "",
      };

      if (isInteresting(url, resourceType)) {
        try {
          const body = await response.text();
          record.bodyPreview = trimText(body);
        } catch {
          record.bodyPreview = "";
        }
      }

      events.push(record);
    });

    await session.page.goto(config.target.url, { waitUntil: "domcontentloaded" });
    await session.page.waitForTimeout(8000);

    const filtered = dedupeEvents(
      events.filter((event) => isInteresting(event.url, event.resourceType)),
    );

    const target = path.join(artifactsDir, `api-inspect-${Date.now()}.json`);
    fs.writeFileSync(target, JSON.stringify(filtered, null, 2), "utf8");

    logInfo(`Saved API inspection to ${target}.`);
    return { target, events: filtered };
  } finally {
    await session.browser.close();
  }
}

function isInteresting(url, resourceType = "") {
  const haystack = `${url} ${resourceType}`.toLowerCase();
  return INTERESTING_PATTERNS.some((pattern) => haystack.includes(pattern));
}

function trimText(value) {
  return String(value).replace(/\s+/g, " ").trim().slice(0, 1500);
}

function dedupeEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = `${event.type}:${event.method}:${event.url}:${event.status ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
