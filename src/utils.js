export function ensureArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value === undefined || value === null || value === "") {
    return [];
  }

  return [value];
}

export function normalizeText(value) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function matchesAnyKeyword(value, keywords = []) {
  const text = normalizeText(value);
  return keywords.some((keyword) => text.includes(normalizeText(keyword)));
}

export function interpolate(template, context) {
  if (typeof template !== "string") {
    return template;
  }

  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, key) => {
    const value = key
      .split(".")
      .reduce((current, segment) => current?.[segment], context);
    return value ?? "";
  });
}

export function isWithinPreferredRanges(label, ranges = []) {
  const minutes = extractTimeMinutes(label);
  if (minutes === null) {
    return false;
  }

  return ranges.some((range) => {
    const [start, end] = String(range).split("-");
    const startMinutes = parseTimeToMinutes(start);
    const endMinutes = parseTimeToMinutes(end);

    if (startMinutes === null || endMinutes === null) {
      return false;
    }

    return minutes >= startMinutes && minutes <= endMinutes;
  });
}

export function parseTimeToMinutes(value) {
  const match = String(value ?? "").match(/(\d{1,2}):(\d{2})/);
  if (!match) {
    return null;
  }

  return Number(match[1]) * 60 + Number(match[2]);
}

export function extractTimeMinutes(label) {
  return parseTimeToMinutes(label);
}

export function formatTargetDateForAria(dateString, locale = "en-US", timezone = "Europe/Madrid") {
  const [year, month, day] = String(dateString).split("-").map(Number);
  if (!year || !month || !day) {
    return "";
  }

  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: timezone,
  }).format(date);
}
