import { chromium } from "playwright";

export async function createBrowserSession(config) {
  const browser = await chromium.launch({
    headless: config?.monitor?.headless ?? true,
  });

  const context = await browser.newContext({
    locale: config?.target?.locale ?? "en",
    timezoneId: config?.target?.timezone ?? "Europe/Madrid",
  });

  const page = await context.newPage();
  page.setDefaultTimeout(config?.monitor?.timeoutMs ?? 20000);

  return { browser, context, page };
}
