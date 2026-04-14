#!/usr/bin/env node
/**
 * Interactive setup wizard for config.yaml.
 * Run via:  npm run setup
 *
 * Prompts the user for every required field, shows current config.yaml values
 * as defaults (if the file already exists), then writes the result.
 */
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import YAML from "yaml";

const CONFIG_PATH = path.resolve(process.cwd(), "config.yaml");
const EXAMPLE_PATH = path.resolve(process.cwd(), "config.example.yaml");

// ── helpers ──────────────────────────────────────────────────────────────────

function rl() {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

function ask(iface, question) {
  return new Promise((resolve) => iface.question(question, (answer) => resolve(answer.trim())));
}

async function prompt(iface, label, defaultValue, hint = "") {
  const defaultDisplay = defaultValue !== undefined && defaultValue !== "" ? ` [${defaultValue}]` : "";
  const hintDisplay = hint ? ` (${hint})` : "";
  const answer = await ask(iface, `${label}${hintDisplay}${defaultDisplay}: `);
  return answer === "" && defaultValue !== undefined ? String(defaultValue) : answer;
}

async function promptInt(iface, label, defaultValue) {
  while (true) {
    const raw = await prompt(iface, label, defaultValue, "number");
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return n;
    console.log("  ⚠  Please enter a positive integer.");
  }
}

async function promptDate(iface, label, defaultValue) {
  while (true) {
    const raw = await prompt(iface, label, defaultValue, "YYYY-MM-DD");
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
    console.log("  ⚠  Format must be YYYY-MM-DD (e.g. 2026-06-15).");
  }
}

async function promptEmail(iface, label, defaultValue) {
  while (true) {
    const raw = await prompt(iface, label, defaultValue);
    if (raw.includes("@") && raw.includes(".")) return raw;
    console.log("  ⚠  Please enter a valid email address.");
  }
}

async function promptPassengers(iface, quantity, existing) {
  const passengers = [];
  for (let i = 0; i < quantity; i++) {
    const ex = existing?.[i] ?? {};
    console.log(`\n  Passenger ${i + 1} of ${quantity}`);
    const firstName = (await prompt(iface, "    First name (as in passport/ID)", ex.firstName ?? "")).toUpperCase();
    const lastName = (await prompt(iface, "    Last name  (as in passport/ID)", ex.lastName ?? "")).toUpperCase();
    const email = await promptEmail(iface, "    Email address", ex.email !== "passenger1@example.com" && ex.email !== "your@email.com" ? ex.email : "");
    const documentId = await prompt(iface, "    Document number (passport/ID)", ex.documentId !== "P00000001" && ex.documentId !== "P00000002" ? ex.documentId : "");
    const docTypeRaw = await prompt(iface, "    Document type", ex.documentType ?? "passport", "passport / id");
    const documentType = ["id", "passport"].includes(docTypeRaw.toLowerCase()) ? docTypeRaw.toLowerCase() : "passport";
    passengers.push({ firstName, lastName, email, documentId, documentType });
  }
  return passengers;
}

// ── load existing or example config as defaults ───────────────────────────────

function loadBase() {
  const src = fs.existsSync(CONFIG_PATH) ? CONFIG_PATH : EXAMPLE_PATH;
  if (!fs.existsSync(src)) return {};
  try {
    return YAML.parse(fs.readFileSync(src, "utf8")) ?? {};
  } catch {
    return {};
  }
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const base = loadBase();
  const iface = rl();

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   Sagrada Familia Ticket Monitor — Setup     ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  if (fs.existsSync(CONFIG_PATH)) {
    console.log("ℹ  config.yaml already exists. Press Enter to keep the current value,\n   or type a new one to override it.\n");
  }

  // ── target ────────────────────────────────────────────────────────────────
  console.log("── Target ───────────────────────────────────────────");
  const date = await promptDate(iface, "Visit date", base.target?.date);
  const quantity = await promptInt(iface, "Number of tickets", base.target?.quantity ?? 2);
  const ticketCategory = await prompt(
    iface,
    "Ticket category",
    base.target?.ticketCategory ?? "under 30 years old",
    'e.g. "under 30 years old" / "adult"',
  );

  console.log("\n  Preferred time windows (comma-separated, 24h, e.g. 10:30-13:00,13:00-16:00)");
  const prefTimesDefault = (base.target?.preferredTimes ?? ["10:30-13:00", "13:00-16:00", "16:00-19:30"]).join(",");
  const prefTimesRaw = await prompt(iface, "  Preferred times", prefTimesDefault);
  const preferredTimes = prefTimesRaw.split(",").map((s) => s.trim()).filter(Boolean);

  // ── passengers ────────────────────────────────────────────────────────────
  console.log("\n── Passengers ───────────────────────────────────────");
  const passengers = await promptPassengers(iface, quantity, base.passengers);

  // ── checkout safety ───────────────────────────────────────────────────────
  console.log("\n── Checkout safety ──────────────────────────────────");
  const pauseRaw = await prompt(
    iface,
    "Pause before payment for manual review?",
    base.checkout?.pauseBeforePayment !== false ? "yes" : "no",
    "yes / no",
  );
  const pauseBeforePayment = !["no", "n", "false"].includes(pauseRaw.toLowerCase());

  iface.close();

  // ── build config ──────────────────────────────────────────────────────────
  const config = {
    target: {
      name: base.target?.name ?? "Sagrada Familia",
      date,
      locale: base.target?.locale ?? "en",
      url: base.target?.url ?? "https://tickets.sagradafamilia.org/en/1-individual/4375-sagrada-familia",
      timezone: base.target?.timezone ?? "Europe/Madrid",
      quantity,
      ticketCategory,
      ticketPreference: base.target?.ticketPreference ?? ["tower", "guided", "basic"],
      preferredTimes,
      unavailableKeywords: base.target?.unavailableKeywords ?? [
        "sold out",
        "not available",
        "agotado",
        "no disponible",
      ],
    },
    monitor: base.monitor ?? {
      intervalSeconds: 45,
      headless: true,
      timeoutMs: 20000,
      stopAfterSuccess: false,
      saveHtmlOnMatch: true,
      saveScreenshots: true,
    },
    notifications: base.notifications ?? {
      console: true,
      desktop: true,
      webhookUrl: "",
    },
    checkout: {
      ...(base.checkout ?? {}),
      enabled: true,
      pauseBeforePayment,
      proceedToPayment: false,
      keepBrowserOpenOnError: true,
      finalConfirmationSelector: "",
      screenshotDir: "./artifacts",
    },
    passengers,
    selectors: base.selectors ?? {
      cookieAccept: ["button:has-text('Accept')", "button:has-text('OK')"],
      productCards: ["article", ".card", "[data-product]"],
      timeSlotButtons: ["button", "[role='button']"],
      travellerFields: {
        firstName: "input[name='firstName']",
        lastName: "input[name='lastName']",
        email: "input[name='email']",
        documentId: "input[name='document']",
      },
      proceedToPayment: ["button:has-text('Pay')", "button:has-text('Checkout')"],
    },
    flows: base.flows ?? {
      monitor: [
        { type: "goto", url: "{{target.url}}" },
        { type: "optionalClickAny", selectors: "{{selectors.cookieAccept}}" },
        { type: "capturePageText" },
        { type: "detectAvailability" },
      ],
      checkout: [
        { type: "goto", url: "{{target.url}}" },
        { type: "optionalClickAny", selectors: "{{selectors.cookieAccept}}" },
        { type: "pickProductCard" },
        { type: "pickPreferredTime" },
        { type: "fillPassengers" },
        { type: "handoffBeforePayment" },
      ],
    },
  };

  const yaml = YAML.stringify(config, { lineWidth: 100 });
  fs.writeFileSync(CONFIG_PATH, yaml, "utf8");

  console.log(`\n✅  config.yaml written to ${CONFIG_PATH}`);
  console.log("\nNext steps:");
  console.log("  npm run once-api          # verify the monitor can reach the site");
  console.log("  npm run watch-api-fast    # start monitoring (runs until a ticket is found)");
  console.log("  npm run checkout          # run checkout manually without monitoring first\n");
}

main().catch((err) => {
  console.error("Setup failed:", err.message);
  process.exitCode = 1;
});
