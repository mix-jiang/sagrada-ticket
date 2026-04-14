#!/usr/bin/env node
/**
 * Interactive setup wizard for config.yaml.
 * Run via:  npm run setup
 *
 * Uses @inquirer/prompts for arrow-key selection, checkboxes, and validation.
 */
import fs from "node:fs";
import path from "node:path";
import { input, select, checkbox, confirm } from "@inquirer/prompts";
import YAML from "yaml";

const CONFIG_PATH = path.resolve(process.cwd(), "config.yaml");
const EXAMPLE_PATH = path.resolve(process.cwd(), "config.example.yaml");

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

// ── field prompts ─────────────────────────────────────────────────────────────

async function askDate(defaultValue) {
  return input({
    message: "Visit date",
    default: defaultValue,
    validate(value) {
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return true;
      return "Format must be YYYY-MM-DD (e.g. 2026-06-15)";
    },
  });
}

async function askQuantity(defaultValue) {
  return select({
    message: "Number of tickets",
    default: String(defaultValue ?? 2),
    choices: [1, 2, 3, 4, 5, 6].map((n) => ({ value: n, name: String(n) })),
  });
}

async function askTicketCategory(defaultValue) {
  const KNOWN = [
    { value: "under 30 years old", name: "Under 30 years old" },
    { value: "adult", name: "Adult" },
    { value: "senior", name: "Senior (65+)" },
    { value: "child", name: "Child" },
    { value: "__custom__", name: "Custom (type manually)…" },
  ];
  const isKnown = KNOWN.some((c) => c.value === defaultValue);
  const selected = await select({
    message: "Ticket category",
    default: isKnown ? defaultValue : "__custom__",
    choices: KNOWN,
  });
  if (selected !== "__custom__") return selected;
  return input({
    message: "Custom ticket category",
    default: isKnown ? undefined : defaultValue,
    validate(v) {
      return v.trim().length > 0 ? true : "Please enter a category";
    },
  });
}

const TIME_SLOT_OPTIONS = [
  { value: "09:00-13:00", name: "Morning   09:00–13:00" },
  { value: "13:00-17:00", name: "Afternoon 13:00–17:00" },
  { value: "17:00-20:00", name: "Evening   17:00–20:00" },
];

async function askPreferredTimes(defaultValue) {
  const all = TIME_SLOT_OPTIONS.map((o) => o.value);
  const defaultChecked = (defaultValue ?? all).filter((v) =>
    all.includes(v),
  );
  const chosen = await checkbox({
    message: "Preferred time windows  (Space to toggle, Enter to confirm; leave empty = all)",
    choices: TIME_SLOT_OPTIONS.map((o) => ({
      ...o,
      checked: defaultChecked.includes(o.value),
    })),
  });
  return chosen.length > 0 ? chosen : [...all];
}

async function askPassenger(index, total, existing = {}) {
  console.log(`\n  Passenger ${index + 1} of ${total}`);
  const firstName = (
    await input({
      message: "    First name (as in passport/ID)",
      default: existing.firstName ?? "",
      validate(v) { return v.trim().length > 0 ? true : "Required"; },
    })
  ).toUpperCase();

  const lastName = (
    await input({
      message: "    Last name  (as in passport/ID)",
      default: existing.lastName ?? "",
      validate(v) { return v.trim().length > 0 ? true : "Required"; },
    })
  ).toUpperCase();

  const placeholderEmails = ["passenger1@example.com", "your@email.com"];
  const emailDefault = placeholderEmails.includes(existing.email) ? "" : (existing.email ?? "");
  const email = await input({
    message: "    Email address",
    default: emailDefault,
    validate(v) {
      return v.includes("@") && v.includes(".") ? true : "Please enter a valid email address";
    },
  });

  const placeholderDocs = ["P00000001", "P00000002"];
  const docDefault = placeholderDocs.includes(existing.documentId) ? "" : (existing.documentId ?? "");
  const documentId = await input({
    message: "    Document number (passport / ID)",
    default: docDefault,
    validate(v) { return v.trim().length > 0 ? true : "Required"; },
  });

  const documentType = await select({
    message: "    Document type",
    default: existing.documentType ?? "passport",
    choices: [
      { value: "passport", name: "Passport" },
      { value: "id", name: "National ID" },
    ],
  });

  return { firstName, lastName, email, documentId, documentType };
}

async function askPassengers(quantity, existingList = []) {
  const passengers = [];
  for (let i = 0; i < quantity; i++) {
    passengers.push(await askPassenger(i, quantity, existingList[i]));
  }
  return passengers;
}

// ── summary printer ───────────────────────────────────────────────────────────

function printSummary(data) {
  const { date, quantity, ticketCategory, preferredTimes, passengers, pauseBeforePayment } = data;
  console.log("\n┌─────────────────────────────────────────────────────┐");
  console.log("│                   Configuration                     │");
  console.log("├─────────────────────────────────────────────────────┤");
  console.log(`│  Visit date        : ${date}`);
  console.log(`│  Tickets           : ${quantity}`);
  console.log(`│  Category          : ${ticketCategory}`);
  console.log(`│  Time windows      : ${preferredTimes.join(", ")}`);
  console.log(`│  Pause before pay  : ${pauseBeforePayment ? "yes" : "no"}`);
  console.log("├─────────────────────────────────────────────────────┤");
  passengers.forEach((p, i) => {
    console.log(`│  Passenger ${i + 1}       : ${p.firstName} ${p.lastName}`);
    console.log(`│    email           : ${p.email}`);
    console.log(`│    document        : ${p.documentId} (${p.documentType})`);
  });
  console.log("└─────────────────────────────────────────────────────┘\n");
}

// ── edit-field loop ───────────────────────────────────────────────────────────

async function editField(data) {
  const passengerChoices = data.passengers.flatMap((p, i) => [
    { value: `p${i}_firstName`, name: `Passenger ${i + 1} — First name  (${p.firstName})` },
    { value: `p${i}_lastName`, name: `Passenger ${i + 1} — Last name   (${p.lastName})` },
    { value: `p${i}_email`, name: `Passenger ${i + 1} — Email       (${p.email})` },
    { value: `p${i}_documentId`, name: `Passenger ${i + 1} — Document ID (${p.documentId})` },
    { value: `p${i}_documentType`, name: `Passenger ${i + 1} — Doc type    (${p.documentType})` },
  ]);

  const field = await select({
    message: "Which field do you want to edit?",
    choices: [
      { value: "date", name: `Visit date        (${data.date})` },
      { value: "quantity", name: `Ticket count      (${data.quantity})` },
      { value: "ticketCategory", name: `Ticket category   (${data.ticketCategory})` },
      { value: "preferredTimes", name: `Time windows      (${data.preferredTimes.join(", ")})` },
      { value: "pauseBeforePayment", name: `Pause before pay  (${data.pauseBeforePayment ? "yes" : "no"})` },
      ...passengerChoices,
    ],
  });

  if (field === "date") {
    data.date = await askDate(data.date);
  } else if (field === "quantity") {
    const newQty = await askQuantity(data.quantity);
    if (newQty !== data.quantity) {
      data.quantity = newQty;
      // re-ask all passengers to match new count
      data.passengers = await askPassengers(data.quantity, data.passengers);
    }
  } else if (field === "ticketCategory") {
    data.ticketCategory = await askTicketCategory(data.ticketCategory);
  } else if (field === "preferredTimes") {
    data.preferredTimes = await askPreferredTimes(data.preferredTimes);
  } else if (field === "pauseBeforePayment") {
    data.pauseBeforePayment = await confirm({ message: "Pause before payment?", default: data.pauseBeforePayment });
  } else {
    // passenger field: p<i>_<fieldName>
    const [pIdx, fieldName] = field.replace(/^p(\d+)_/, (_, i) => `${i} `).split(" ");
    const i = Number(pIdx);
    const p = data.passengers[i];
    if (fieldName === "firstName") {
      p.firstName = (await input({ message: "First name", default: p.firstName, validate: (v) => v.trim().length > 0 ? true : "Required" })).toUpperCase();
    } else if (fieldName === "lastName") {
      p.lastName = (await input({ message: "Last name", default: p.lastName, validate: (v) => v.trim().length > 0 ? true : "Required" })).toUpperCase();
    } else if (fieldName === "email") {
      p.email = await input({ message: "Email", default: p.email, validate: (v) => (v.includes("@") && v.includes(".") ? true : "Invalid email") });
    } else if (fieldName === "documentId") {
      p.documentId = await input({ message: "Document ID", default: p.documentId, validate: (v) => v.trim().length > 0 ? true : "Required" });
    } else if (fieldName === "documentType") {
      p.documentType = await select({ message: "Document type", default: p.documentType, choices: [{ value: "passport", name: "Passport" }, { value: "id", name: "National ID" }] });
    }
  }
  return data;
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
  const base = loadBase();

  console.log("\n╔══════════════════════════════════════════════╗");
  console.log("║   Sagrada Familia Ticket Monitor — Setup     ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  if (fs.existsSync(CONFIG_PATH)) {
    console.log("ℹ  config.yaml already exists. Existing values are shown as defaults.\n");
  }

  // ── collect all fields ──────────────────────────────────────────────────────
  console.log("── Target ───────────────────────────────────────────");
  const date = await askDate(base.target?.date);
  const quantity = await askQuantity(base.target?.quantity ?? 2);
  const ticketCategory = await askTicketCategory(base.target?.ticketCategory ?? "under 30 years old");
  const preferredTimes = await askPreferredTimes(base.target?.preferredTimes);

  console.log("\n── Passengers ───────────────────────────────────────");
  let passengers = await askPassengers(quantity, base.passengers);

  console.log("\n── Checkout safety ──────────────────────────────────");
  let pauseBeforePayment = await confirm({
    message: "Pause before payment for manual review?",
    default: base.checkout?.pauseBeforePayment !== false,
  });

  // ── confirm / edit loop ─────────────────────────────────────────────────────
  let data = { date, quantity, ticketCategory, preferredTimes, passengers, pauseBeforePayment };

  while (true) {
    printSummary(data);
    const action = await select({
      message: "Everything looks correct?",
      choices: [
        { value: "save", name: "✅  Yes, save and continue" },
        { value: "edit", name: "✏️   Edit a field…" },
      ],
    });
    if (action === "save") break;
    data = await editField(data);
  }

  // ── build config ────────────────────────────────────────────────────────────
  const config = {
    target: {
      name: base.target?.name ?? "Sagrada Familia",
      date: data.date,
      locale: base.target?.locale ?? "en",
      url: base.target?.url ?? "https://tickets.sagradafamilia.org/en/1-individual/4375-sagrada-familia",
      timezone: base.target?.timezone ?? "Europe/Madrid",
      quantity: data.quantity,
      ticketCategory: data.ticketCategory,
      ticketPreference: base.target?.ticketPreference ?? ["tower", "guided", "basic"],
      preferredTimes: data.preferredTimes,
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
      pauseBeforePayment: data.pauseBeforePayment,
      proceedToPayment: false,
      keepBrowserOpenOnError: true,
      finalConfirmationSelector: "",
      screenshotDir: "./artifacts",
    },
    passengers: data.passengers,
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
