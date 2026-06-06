const EMPTY_RESULT = { dueDateISO: null, term: null };
const DAY_MS = 24 * 60 * 60 * 1000;

const parseValidISODate = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;

  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }

  return { year, month, day };
};

const formatUTCDate = (date) => {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const deriveDueDateFromTerms = (rawText, issueDateISO) => {
  const issueDate = parseValidISODate(issueDateISO);
  if (!issueDate || typeof rawText !== "string" || !rawText.trim()) return EMPTY_RESULT;

  const netMatch = rawText.match(/\bnet\s+(\d{1,3})\b/i);
  const receiptMatch =
    rawText.match(/\bdue\s+(?:on|upon)\s+receipt\b/i) ||
    rawText.match(/\bpayable\s+on\s+receipt\b/i);

  let days;
  let term;
  if (netMatch) {
    days = Number(netMatch[1]);
    term = `Net ${days}`;
  } else if (receiptMatch) {
    days = 0;
    term = "Due on receipt";
  } else {
    return EMPTY_RESULT;
  }

  if (!Number.isInteger(days) || days < 0 || days > 365) return EMPTY_RESULT;

  const issueTime = Date.UTC(issueDate.year, issueDate.month - 1, issueDate.day);
  const dueDate = new Date(issueTime + days * DAY_MS);
  return { dueDateISO: formatUTCDate(dueDate), term };
};

module.exports = { deriveDueDateFromTerms };
