import path from "node:path";
import { createBrowserSession } from "./browser.js";
import { logInfo, logWarn } from "./logger.js";
import { sendNotification } from "./notify.js";
import {
  ensureArray,
  formatTargetDateForAria,
  isWithinPreferredRanges,
  normalizeText,
} from "./utils.js";

export async function runCheckout(config, artifactsDir) {
  const session = await createBrowserSession({
    ...config,
    monitor: {
      ...config.monitor,
      headless: false,
    },
  });

  let reachedHandoff = false;
  let preserveBrowser = false;

  try {
    reachedHandoff = await executeCheckoutFlow(config, session.page, artifactsDir);
  } catch (error) {
    if (config?.checkout?.keepBrowserOpenOnError) {
      preserveBrowser = true;
      logWarn("Keeping browser open after checkout error for manual inspection.", error.message);
      throw error;
    }
    throw error;
  } finally {
    if ((config?.checkout?.pauseBeforePayment && reachedHandoff) || preserveBrowser) {
      logInfo("Leaving browser open because pauseBeforePayment is enabled.");
      return;
    }

    await session.browser.close();
  }
}

async function executeCheckoutFlow(config, page, artifactsDir) {
  // Use ?date= param to load the target date directly — more reliable than clicking the calendar.
  const dateParam = config?.target?.date ? `?date=${config.target.date}` : "";
  const startUrl = `${config.target.url}${dateParam}`;
  logInfo(`Opening booking page: ${startUrl}`);
  await sendNotification(config, {
    title: "Opening Sagrada Familia checkout",
    date: config?.target?.date,
    state: "starting-checkout",
    url: startUrl,
  });
  await page.goto(startUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  logInfo("Attempting cookie acceptance.");
  await clickAny(page, ensureArray(config?.selectors?.cookieAccept), true);
  await page.waitForTimeout(500);

  logInfo("Waiting for time slot buttons.");
  await page.waitForSelector(".buyerType, button.btn-custom-next", { timeout: 20000, state: "attached" });

  logInfo("Trying to pick a preferred time slot.");
  await pickPreferredTime(page, config);

  logInfo("Trying to choose ticket category and quantity.");
  await chooseTicketCategoryAndQuantity(page, config);

  logInfo("Clicking CONTINUE to expand passenger form.");
  await proceedToPassengerForm(page);

  logInfo("Trying to fill passenger details.");
  await fillPassengers(page, config);

  logInfo("Clicking CONTINUE to proceed to payment step.");
  await proceedToCart(page);

  logInfo("Reached handoff step before payment.");
  await handoffBeforePayment(page, config, artifactsDir);
  return true;
}

async function pickProductCard(page, config) {
  const url = page.url();
  if (url.includes("/1-individual/4375-sagrada-familia")) {
    logInfo("Direct product page detected; skipping product card selection.");
    return;
  }

  const cards = await findCardCandidates(page, ensureArray(config?.selectors?.productCards));
  const preferences = ensureArray(config?.target?.ticketPreference).map(normalizeText);

  if (cards.length === 0) {
    throw new Error("No product card candidates were found. Update productCards selectors in config.yaml.");
  }

  for (const preference of preferences) {
    const matched = cards.find((card) => card.text.includes(preference));
    if (matched) {
      logInfo(`Selecting product card for preference "${preference}".`);
      await matched.locator.click();
      return;
    }
  }

  if (cards[0]) {
    logWarn("No preferred product card matched; using the first visible card.");
    await cards[0].locator.click();
    return;
  }
}

async function pickPreferredTime(page, config) {
  // Time slots are already loaded via ?date= param — no calendar click needed.
  await page.waitForTimeout(1000);
  const buttons = await findButtonCandidates(page, ensureArray(config?.selectors?.timeSlotButtons));
  const unavailableKeywords = ensureArray(config?.target?.unavailableKeywords);
  const availableButtons = buttons.filter((button) => {
    const unavailable = unavailableKeywords.some((keyword) =>
      button.text.includes(normalizeText(keyword)),
    );
    return !unavailable;
  });

  const matched = pickEarliestTimeSlot(availableButtons, config);

  if (!matched) {
    throw new Error("No matching time slot found. Update preferredTimes or selectors in config.yaml.");
  }

  logInfo(`Selecting time slot "${matched.text}".`);
  await matched.locator.click();
  await page.waitForTimeout(1500);
}

async function pickTargetDate(page, config) {
  const targetDate = formatTargetDateForAria(
    config?.target?.date,
    "en-US",
    config?.target?.timezone ?? "Europe/Madrid",
  );
  if (!targetDate) {
    throw new Error("Invalid target.date in config.yaml.");
  }

  const cells = await page.locator("td[role='button']").all();
  for (const cell of cells) {
    const aria = normalizeText(await cell.getAttribute("aria-label"));
    if (!aria.includes(normalizeText(targetDate))) {
      continue;
    }

    if (aria.includes("not available") || normalizeText(await cell.getAttribute("class")).includes("blocked")) {
      logWarn(`Target date is unavailable: ${targetDate}`);
      await sendNotification(config, {
        title: "Sagrada Familia date unavailable",
        date: config?.target?.date,
        state: "no-availability",
        matchedSlots: [targetDate],
        url: config?.target?.url,
      });
      return "unavailable";
    }

    logInfo(`Selecting date "${targetDate}".`);
    await sendNotification(config, {
      title: "Sagrada Familia date selected",
      date: config?.target?.date,
      state: "date-selected",
      matchedSlots: [targetDate],
      url: config?.target?.url,
    });
    await cell.click();
    await page.waitForTimeout(500);
    return "selected";
  }

  logWarn(`Target date not found in current calendar view: ${targetDate}`);
  return "not-found";
}

async function setTicketQuantity(page, config) {
  const quantity = Number(config?.target?.quantity ?? 1);
  if (!Number.isFinite(quantity) || quantity <= 1) {
    return;
  }

  const plusButtons = await findButtonCandidates(page, [
    "button",
    "[role='button']",
  ]);

  const increment = plusButtons.find((button) => {
    const text = button.text;
    return text === "+" || text.includes("add") || text.includes("more");
  });

  if (!increment) {
    logWarn("Could not find an increment button for ticket quantity.");
    return;
  }

  for (let count = 1; count < quantity; count += 1) {
    await increment.locator.click();
    await page.waitForTimeout(150);
  }

  logInfo(`Requested quantity set to ${quantity}.`);
}

async function fillPassengers(page, config) {
  const passengers = ensureArray(config?.passengers);
  if (passengers.length === 0) {
    logWarn("No passengers configured; skipping form fill.");
    return;
  }

  // Wait for passenger fields to become visible after the form expansion.
  await page.waitForSelector('[id*="formsection-810"]', { timeout: 10000, state: "visible" }).catch(() => {
    logWarn("Passenger formsection not visible within timeout; attempting fill anyway.");
  });

  // Fill each passenger using their real field IDs (discovered via network inspection).
  // Field ID pattern: contact-formsection-810.field-{nameId}-bt-304-{index}[0].value
  //   3711 = first name, 3712 = last name
  for (let i = 0; i < passengers.length; i++) {
    const passenger = passengers[i];
    const firstNameId = `contact-formsection-810.field-3711-bt-304-${i}[0].value`;
    const lastNameId = `contact-formsection-810.field-3712-bt-304-${i}[0].value`;

    if (passenger.firstName) {
      await fillById(page, firstNameId, passenger.firstName);
    }
    if (passenger.lastName) {
      await fillById(page, lastNameId, passenger.lastName);
    }
  }

  await page.waitForTimeout(500);
  logInfo("Passenger detail fill completed.");
}

async function fillById(page, id, value) {
  const locator = page.locator(`[id="${id}"]`);
  if (!(await locator.count())) {
    logWarn(`Field not found: ${id}`);
    return false;
  }
  const visible = await locator.isVisible().catch(() => false);
  if (!visible) {
    logWarn(`Field not visible: ${id}`);
    return false;
  }
  await locator.fill(value);
  logInfo(`Filled ${id} = ${value}`);
  return true;
}

async function proceedToPassengerForm(page) {
  // After selecting quantity, click the section-level CONTINUE (btn-custom-next.select-tickets)
  // to expand the passenger detail form. The cart-level CONTINUE (btn-custom-addToCart) is
  // disabled at this stage and only unlocks after passenger fields are filled.
  const btn = page.locator("button.btn-custom-next.select-tickets").first();
  if (await btn.count()) {
    logInfo("Clicking section CONTINUE to expand passenger form.");
    await btn.click({ force: true });
    await page.waitForTimeout(1500);
    return;
  }
  logWarn("Section CONTINUE (btn-custom-next.select-tickets) not found; passenger form may already be visible.");
}

async function proceedToCart(page) {
  // After filling passenger names, the cart-level CONTINUE (btn-custom-addToCart) should
  // become enabled. Click it to advance to the payment step.
  const btn = page.locator("button.btn-custom-addToCart").first();
  if (!(await btn.count())) {
    logWarn("Cart CONTINUE (btn-custom-addToCart) not found; skipping.");
    return;
  }
  const disabled = await btn.isDisabled().catch(() => true);
  if (disabled) {
    logWarn("Cart CONTINUE is still disabled after passenger fill; check required fields.");
    return;
  }
  logInfo("Clicking cart CONTINUE to proceed to payment.");
  await btn.click({ force: true });
  await page.waitForTimeout(2000);
}

async function handoffBeforePayment(page, config, artifactsDir) {
  const filePath = path.join(artifactsDir, `checkout-${Date.now()}.png`);
  await page.screenshot({ path: filePath, fullPage: true });
  logInfo(`Checkout screenshot saved to ${filePath}.`);
  await sendNotification(config, {
    title: "Sagrada Familia checkout ready",
    date: config?.target?.date,
    state: "handoff-before-payment",
    matchedSlots: [filePath],
    url: config?.target?.url,
  });

  const finalSelectors = ensureArray(config?.selectors?.proceedToPayment);
  if (config?.checkout?.proceedToPayment && !config?.checkout?.pauseBeforePayment) {
    await clickAny(page, finalSelectors, false);
    return;
  }

  if (config?.checkout?.finalConfirmationSelector) {
    await page
      .locator(config.checkout.finalConfirmationSelector)
      .waitFor({ timeout: 30000 });
  }

  logInfo("Paused before payment. Review the browser and complete payment manually if everything looks right.");
}

async function clickAny(page, selectors, optional = false) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.click().catch(() => {});
      return true;
    }
  }

  if (!optional) {
    throw new Error(`None of the selectors matched: ${selectors.join(", ")}`);
  }

  return false;
}

async function fillFirstVisible(page, selectors, value) {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.fill(value);
      return true;
    }
  }

  return false;
}

async function findCardCandidates(page, selectors) {
  const results = [];
  for (const selector of selectors) {
    const locators = await page.locator(selector).all();
    for (const locator of locators) {
      const text = normalizeText(await locator.textContent());
      if (text) {
        results.push({ locator, text });
      }
    }
  }
  return results;
}

async function findButtonCandidates(page, selectors) {
  const results = [];
  for (const selector of selectors) {
    const locators = await page.locator(selector).all();
    for (const locator of locators) {
      const text = normalizeText(await locator.textContent());
      if (text) {
        results.push({ locator, text });
      }
    }
  }
  return results;
}

function pickEarliestTimeSlot(buttons, config) {
  const timedButtons = buttons
    .filter((button) => hasEnoughRemainingInventory(button.text, config))
    .map((button) => ({
      ...button,
      minutes: extractMinutes(button.text),
    }))
    .filter((button) => button.minutes !== null)
    .sort((left, right) => left.minutes - right.minutes);

  if (timedButtons.length > 0) {
    return timedButtons[0];
  }

  const preferredRanges = ensureArray(config?.target?.preferredTimes);
  return buttons.find((button) => isWithinPreferredRanges(button.text, preferredRanges)) ?? null;
}

function extractMinutes(label) {
  const match = String(label).match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

function hasEnoughRemainingInventory(label, config) {
  const quantity = Number(config?.target?.quantity ?? 1);
  const text = String(label).toLowerCase();
  const countMatch =
    text.match(/(\d+)\s*(tickets?|spots?|places?|left|remaining)/) ||
    text.match(/(left|remaining)\s*[:\-]?\s*(\d+)/);

  if (!countMatch) {
    return true;
  }

  const count = Number(countMatch[1] && /\d+/.test(countMatch[1]) ? countMatch[1] : countMatch[2]);
  if (!Number.isFinite(count)) {
    return true;
  }

  return count >= quantity;
}

async function chooseTicketCategoryAndQuantity(page, config) {
  const targetCategory = normalizeText(config?.target?.ticketCategory ?? "");
  const quantity = Number(config?.target?.quantity ?? 1);
  if (!targetCategory || quantity < 1) {
    return;
  }

  // Use the verified selector: .buyerType container filtered by category text,
  // then find the increment button via data-action-id attribute.
  await page.waitForSelector(".buyerType", { timeout: 10000 });
  const row = page.locator(".buyerType").filter({ hasText: new RegExp(targetCategory, "i") }).first();

  if (!(await row.count())) {
    logWarn(`Could not find ticket category "${config?.target?.ticketCategory}" on the page.`);
    return;
  }

  const plus = row.locator('button[data-action-id="increment"]').first();
  if (!(await plus.count())) {
    logWarn(`Increment button not found inside category "${config?.target?.ticketCategory}".`);
    return;
  }

  for (let count = 0; count < quantity; count += 1) {
    await plus.click({ force: true });
    await page.waitForTimeout(300);
  }

  logInfo(`Selected ${quantity} ticket(s) for category "${config.target.ticketCategory}".`);
}

async function findIncrementButton(locators) {
  for (const locator of locators) {
    const text = normalizeText(await locator.textContent());
    const aria = normalizeText(await locator.getAttribute("aria-label"));
    const combined = `${text} ${aria}`.trim();
    if (
      combined === "+" ||
      combined.includes("add") ||
      combined.includes("plus") ||
      combined.includes("increase")
    ) {
      return locator;
    }
  }

  return null;
}
