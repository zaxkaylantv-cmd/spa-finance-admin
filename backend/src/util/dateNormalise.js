const MONTHS = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const validDateResult = (year, month, day) => {
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);

  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return { state: "invalid" };
  }

  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { state: "valid", iso };
};

const parseDateStrict = (value) => {
  if (value === null || value === undefined) return { state: "empty" };
  if (typeof value !== "string") return { state: "invalid" };

  const str = value.trim();
  if (!str) return { state: "empty" };

  let match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return validDateResult(Number(match[1]), Number(match[2]), Number(match[3]));

  match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (match) return validDateResult(Number(match[3]), Number(match[2]), Number(match[1]));

  match = str.match(/^(\d{1,2})\s+([a-z]{3,9})\s+(\d{4})$/i);
  if (match) {
    const month = MONTHS[match[2].toLowerCase()];
    return month ? validDateResult(Number(match[3]), month, Number(match[1])) : { state: "invalid" };
  }

  match = str.match(/^([a-z]{3,9})\s+(\d{1,2}),?\s+(\d{4})$/i);
  if (match) {
    const month = MONTHS[match[1].toLowerCase()];
    return month ? validDateResult(Number(match[3]), month, Number(match[2])) : { state: "invalid" };
  }

  return { state: "invalid" };
};

const normaliseDateOrNull = (value) => {
  const result = parseDateStrict(value);
  return result.state === "valid" ? result.iso : null;
};

const normaliseDateStrict = (value) => {
  const result = parseDateStrict(value);
  if (result.state === "valid") return { ok: true, iso: result.iso };
  if (result.state === "empty") return { ok: true, iso: null };
  return { ok: false };
};

module.exports = { parseDateStrict, normaliseDateOrNull, normaliseDateStrict };
