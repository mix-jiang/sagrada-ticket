import fs from "node:fs";
import path from "node:path";
import { createBrowserSession } from "./browser.js";
import { logInfo, logWarn } from "./logger.js";
import { sendNotification } from "./notify.js";
import {
  ensureArray,
  formatTargetDateForAria,
  interpolate,
  isWithinPreferredRanges,
  matchesAnyKeyword,
  normalizeText,
} from "./utils.js";

export async function runMonitorOnce(config, artifactsDir) {
  const session = await createBrowserSession(config);

  try {
    const result = await executeMonitorFlow(config, session.page, artifactsDir);
    return result;
  } finally {
    await session.browser.close();
  }
}

export async function runMonitorLoop(config, artifactsDir, onMatch) {
  const intervalMs = (config?.monitor?.intervalSeconds ?? 60) * 1000;

  while (true) {
    try {
      const result = await runMonitorOnce(config, artifactsDir);
      if (result.available) {
        await onMatch?.(result);
        if (config?.monitor?.stopAfterSuccess) {
          return result;
        }
      }
    } catch (error) {
      logWarn("Monitor iteration failed.", error.message);
    }

    await delay(intervalMs);
  }
}

async function executeMonitorFlow(config, page, artifactsDir) {
  await runFlow(page, config, config?.flows?.monitor ?? []);

  const pageText = normalizeText(await page.textContent("body"));
  const availability = await inspectAvailability(config, page);
  const matched = availability.available;

  if (matched) {
    const timestamp = Date.now();
    if (config?.monitor?.saveScreenshots) {
      await page.screenshot({
        path: path.join(artifactsDir, `match-${timestamp}.png`),
        fullPage: true,
      });
    }

    if (config?.monitor?.saveHtmlOnMatch) {
      fs.writeFileSync(
        path.join(artifactsDir, `match-${timestamp}.html`),
        await page.content(),
        "utf8",
      );
    }

    await sendNotification(config, {
      title: `${config.target.name} may be available`,
      date: config.target.date,
      url: config.target.url,
      matchedSlots: availability.matchedSlots,
    });
  }

  return {
    available: matched,
    matchedSlots: availability.matchedSlots,
    pageText,
  };
}

async function inspectAvailability(config, page) {
  const dateMatch = await inspectTargetDate(config, page);
  if (dateMatch.available !== null) {
    return {
      available: dateMatch.available,
      matchedSlots: dateMatch.matchedSlots,
    };
  }

  const matchedSlots = [];
  const buttonSelectors = ensureArray(config?.selectors?.timeSlotButtons);
  const ticketPreferences = ensureArray(config?.target?.ticketPreference);
  const preferredTimes = ensureArray(config?.target?.preferredTimes);
  const unavailableKeywords = ensureArray(config?.target?.unavailableKeywords);

  for (const selector of buttonSelectors) {
    const handles = await page.locator(selector).all();
    for (const handle of handles) {
      const label = normalizeText(await handle.textContent());
      if (!label) {
        continue;
      }

      const matchesTicket =
        ticketPreferences.length === 0 ||
        ticketPreferences.some((preference) =>
          label.includes(normalizeText(preference)),
        );
      const matchesTime =
        preferredTimes.length === 0 ||
        isWithinPreferredRanges(label, preferredTimes);
      const unavailable = matchesAnyKeyword(label, unavailableKeywords);

      if (matchesTicket && matchesTime && !unavailable) {
        matchedSlots.push(label);
      }
    }
  }

  if (matchedSlots.length === 0) {
    const bodyText = normalizeText(await page.textContent("body"));
    const roughPositive = ensureArray(config?.target?.preferredTimes).some((range) =>
      bodyText.includes(normalizeText(String(range).split("-")[0])),
    );

    return {
      available: roughPositive && !matchesAnyKeyword(bodyText, unavailableKeywords),
      matchedSlots,
    };
  }

  return {
    available: true,
    matchedSlots,
  };
}

async function inspectTargetDate(config, page) {
  const targetDate = formatTargetDateForAria(
    config?.target?.date,
    "en-US",
    config?.target?.timezone ?? "Europe/Madrid",
  );

  if (!targetDate) {
    return { available: null, matchedSlots: [] };
  }

  const dateCells = await page.locator("td[role='button']").evaluateAll((nodes) =>
    nodes.map((node) => ({
      text: (node.textContent || "").trim(),
      aria: node.getAttribute("aria-label") || "",
      cls: typeof node.className === "string" ? node.className : "",
    })),
  );

  const normalizedTargetDate = normalizeText(targetDate);
  const matchedDate = dateCells.find((cell) =>
    normalizeText(cell.aria).includes(normalizedTargetDate),
  );

  if (!matchedDate) {
    return { available: null, matchedSlots: [] };
  }

  const unavailable =
    normalizeText(matchedDate.aria).includes("not available") ||
    normalizeText(matchedDate.cls).includes("blocked");

  return {
    available: !unavailable,
    matchedSlots: [matchedDate.aria],
  };
}

async function runFlow(page, config, steps) {
  for (const step of steps) {
    await executeStep(page, config, step);
  }
}

async function executeStep(page, config, step) {
  switch (step.type) {
    case "goto":
      await page.goto(interpolate(step.url, config), {
        waitUntil: "domcontentloaded",
      });
      return;
    case "optionalClickAny": {
      const selectors = resolveMaybeConfigArray(config, step.selectors);
      for (const selector of selectors) {
        const locator = page.locator(selector).first();
        if (await locator.count()) {
          try {
            await locator.click({ timeout: 1500 });
            return;
          } catch {
            continue;
          }
        }
      }
      return;
    }
    case "capturePageText":
      await page.waitForLoadState("networkidle").catch(() => {});
      return;
    case "detectAvailability":
      return;
    default:
      logInfo(`Skipping unsupported monitor step "${step.type}".`);
  }
}

function resolveMaybeConfigArray(config, value) {
  if (typeof value === "string" && value.startsWith("{{") && value.endsWith("}}")) {
    const key = value.slice(2, -2).trim();
    return ensureArray(
      key.split(".").reduce((current, segment) => current?.[segment], config),
    );
  }

  return ensureArray(value);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
