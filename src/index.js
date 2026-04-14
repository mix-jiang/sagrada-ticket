#!/usr/bin/env node
import { loadConfig, resolveArtifactsDir } from "./config.js";
import { runApiCheckOnce, runApiMonitorLoop } from "./api-monitor.js";
import { runCheckout } from "./checkout.js";
import { inspectApi } from "./inspect-api.js";
import { logError, logInfo } from "./logger.js";
import { runMonitorLoop, runMonitorOnce } from "./monitor.js";

const command = process.argv[2] ?? "once";

try {
  const config = loadConfig();
  const artifactsDir = resolveArtifactsDir(config);

  switch (command) {
    case "once": {
      const result = await runMonitorOnce(config, artifactsDir);
      logInfo(`Availability: ${result.available ? "MATCHED" : "NOT FOUND"}`, result.matchedSlots);
      break;
    }
    case "monitor":
      await runMonitorLoop(config, artifactsDir, async (result) => {
        logInfo("Availability match detected.", result.matchedSlots);
        if (config?.checkout?.enabled) {
          await runCheckout(config, artifactsDir);
        }
      });
      break;
    case "watch-fast": {
      const fastConfig = {
        ...config,
        monitor: {
          ...config.monitor,
          intervalSeconds: 10,
          headless: true,
        },
      };
      await runMonitorLoop(fastConfig, artifactsDir, async (result) => {
        logInfo("Fast monitor detected availability.", result.matchedSlots);
        if (fastConfig?.checkout?.enabled) {
          await runCheckout(fastConfig, artifactsDir);
        }
      });
      break;
    }
    case "checkout":
      await runCheckout(config, artifactsDir);
      break;
    case "once-api": {
      const result = await runApiCheckOnce(config);
      logInfo(`API availability: ${result.available ? "MATCHED" : "NOT FOUND"}`, {
        date: result.targetDate,
        state: result.state,
        url: result.url,
      });
      break;
    }
    case "watch-api-fast": {
      const result = await runApiMonitorLoop(config, { intervalSeconds: 5 });
      logInfo("API fast monitor detected availability.", {
        date: result.targetDate,
        state: result.state,
      });
      if (config?.checkout?.enabled) {
        await runCheckout(config, artifactsDir);
      }
      break;
    }
    case "inspect-api": {
      const result = await inspectApi(config, artifactsDir);
      logInfo("Interesting network events captured.", {
        savedTo: result.target,
        count: result.events.length,
      });
      break;
    }
    default:
      throw new Error(
        `Unsupported command "${command}". Use once, monitor, watch-fast, checkout, or inspect-api.`,
      );
  }
} catch (error) {
  logError(error.message);
  process.exitCode = 1;
}
