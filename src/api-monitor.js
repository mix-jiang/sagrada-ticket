import { logInfo, logWarn } from "./logger.js";
import { sendNotification } from "./notify.js";

export async function runApiCheckOnce(config) {
  const targetDate = config?.target?.date;
  if (!targetDate) {
    throw new Error("config.target.date is required.");
  }

  const [year, month] = String(targetDate).split("-").map(Number);
  const quantity = Number(config?.target?.quantity ?? 1);
  const accessToken = await fetchAccessToken();
  const availabilityUrl = buildAvailabilityUrl({
    year,
    month,
    minTickets: quantity,
  });

  const response = await fetch(availabilityUrl, {
    headers: {
      accept: "application/json, text/plain, */*",
      authorization: `Bearer ${accessToken}`,
      pos: "649",
      "user-agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      "content-type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Availability API returned ${response.status}.`);
  }

  const payload = await response.json();
  const state = payload?.[targetDate] ?? "unknown";
  return {
    url: availabilityUrl,
    targetDate,
    state,
    available: state === "availability",
    payload,
  };
}

async function fetchAccessToken() {
  const response = await fetch(
    "https://services.clorian.com/user/api/oauth/token?secretKey=thesagradafamiliafrontendoftomorrow",
    {
      method: "POST",
      body: "",
      headers: {
        accept: "application/json",
        "accept-language": "en-US",
        "content-type": "application/json",
        origin: "https://tickets.sagradafamilia.org",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "cross-site",
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
      },
    },
  );

  if (!response.ok) {
    throw new Error(`Token API returned ${response.status}.`);
  }

  const payload = await response.json();
  if (!payload?.access_token) {
    throw new Error("Token API did not return access_token.");
  }

  return payload.access_token;
}

export async function runApiMonitorLoop(config, options = {}) {
  const intervalSeconds = options.intervalSeconds ?? 5;
  let previousState = null;

  while (true) {
    try {
      const result = await runApiCheckOnce(config);
      if (result.state !== previousState) {
        logInfo(`API state changed for ${result.targetDate}: ${result.state}`);
        previousState = result.state;
      }

      if (result.available) {
        await sendNotification(config, {
          title: `${config.target.name} available via API`,
          date: result.targetDate,
          state: result.state,
          url: config?.target?.url,
        });
        return result;
      }
    } catch (error) {
      logWarn("API monitor iteration failed.", error.message);
    }

    await delay(intervalSeconds * 1000);
  }
}

function buildAvailabilityUrl({ year, month, minTickets }) {
  const search = new URLSearchParams({
    minTickets: String(minTickets),
    month: String(month),
    venueId: "1",
    year: String(year),
  });

  return `https://services.clorian.com/catalog/salesGroups/1/product/4375/availability?${search.toString()}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
