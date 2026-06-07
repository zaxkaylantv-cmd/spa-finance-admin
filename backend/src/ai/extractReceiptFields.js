require("dotenv").config();
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");
const OpenAI = require("openai");
const { PDFParse } = require("pdf-parse");
const { extractReceiptFromImage } = require("./receiptExtractor");
const { normaliseDateOrNull } = require("../util/dateNormalise");

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const TEMP_DIR = path.resolve(__dirname, "../..");

const emptyResult = () => ({
  merchant: null,
  supplier: null,
  invoice_number: null,
  issue_date: null,
  due_date: null,
  amount: null,
  vat_amount: null,
  status: "Needs info",
  category: "Uncategorised",
  week_label: null,
  confidence: null,
  extracted_json: {},
  extracted_source: null,
  needs_review: true,
});

const getFileType = (buffer) => {
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString("latin1") === "%PDF") return "pdf";
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpg";
  return null;
};

const execFilePromise = (command, args, options) =>
  new Promise((resolve, reject) => {
    execFile(command, args, options, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout || "");
    });
  });

const getClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  return new OpenAI({ apiKey });
};

const extractReceiptFromText = async (text) => {
  if (typeof text !== "string" || !text.trim()) return null;
  const client = getClient();
  if (!client) return null;

  const systemPrompt = `You are an accurate receipt parser. Return strict JSON only, with no prose or markdown fences:
{
  "merchant": string or null,
  "issue_date": string or null,
  "amount": number or null,
  "vat_amount": number or null,
  "confidence": number
}
If a field is missing or unclear, set it to null. Do not guess. Use the main total for amount. Dates must be YYYY-MM-DD or null.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Extract receipt details from this text:\n\n${text.slice(0, 20000)}` },
      ],
      temperature: 0.2,
    });
    const content = response?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) return null;
    const cleaned = content
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```$/, "");
    const parsed = JSON.parse(cleaned);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch (_) {
    return null;
  }
};

const toNullableNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const buildResult = ({ extracted, extractedSource, parseFailed, extractFailed }) => {
  const raw = extracted && typeof extracted === "object" && !Array.isArray(extracted) ? extracted : {};
  const merchant = typeof raw.merchant === "string" && raw.merchant.trim() ? raw.merchant.trim() : null;
  const amount = toNullableNumber(raw.amount);
  const vatAmount = toNullableNumber(raw.vat_amount);
  const confidence = toNullableNumber(raw.confidence);
  const needsReview =
    parseFailed ||
    extractFailed ||
    !merchant ||
    amount === null ||
    (typeof confidence === "number" && confidence < 0.5);

  return {
    merchant,
    supplier: merchant,
    invoice_number: null,
    issue_date: normaliseDateOrNull(raw.issue_date),
    due_date: null,
    amount,
    vat_amount: vatAmount,
    status: amount !== null ? "Captured" : "Needs info",
    category: "Uncategorised",
    week_label: null,
    confidence,
    extracted_json: raw,
    extracted_source: extractedSource,
    needs_review: Boolean(needsReview),
  };
};

const extractReceiptFields = async ({ buffer, mimeType, filename } = {}) => {
  void mimeType;
  void filename;
  if (!Buffer.isBuffer(buffer) || buffer.length > MAX_FILE_BYTES) return emptyResult();

  const fileType = getFileType(buffer);
  if (!fileType) return emptyResult();

  try {
    if (fileType === "pdf") {
      let rawText = "";
      let parseFailed = false;
      try {
        const parser = new PDFParse({ data: buffer });
        const textResult = await parser.getText();
        rawText = textResult && typeof textResult.text === "string" ? textResult.text : "";
        if (!rawText.trim()) parseFailed = true;
      } catch (_) {
        parseFailed = true;
      }

      const extracted = rawText ? await extractReceiptFromText(rawText) : null;
      return buildResult({
        extracted,
        extractedSource: rawText ? "pdf_text" : null,
        parseFailed,
        extractFailed: !extracted,
      });
    }

    const token = crypto.randomBytes(16).toString("hex");
    const inputPath = path.join(TEMP_DIR, `.tmp_receipt_${token}.${fileType}`);
    const pngPath = path.join(TEMP_DIR, `.tmp_receipt_${token}_ocr.png`);

    try {
      await fs.promises.writeFile(inputPath, buffer, { flag: "wx", mode: 0o600 });

      let extracted = null;
      try {
        extracted = await extractReceiptFromImage(inputPath);
      } catch (_) {
        extracted = null;
      }
      if (
        extracted &&
        typeof extracted === "object" &&
        !Array.isArray(extracted) &&
        ((typeof extracted.merchant === "string" && extracted.merchant.trim()) ||
          Number.isFinite(Number(extracted.amount)))
      ) {
        return buildResult({ extracted, extractedSource: "vision", parseFailed: false, extractFailed: false });
      }

      let rawText = "";
      let parseFailed = false;
      try {
        await execFilePromise(
          "convert",
          [inputPath, "-auto-orient", "-colorspace", "Gray", "-density", "300", "-strip", "-normalize", pngPath],
          { timeout: 20000 }
        );
        const ocrText = await execFilePromise("tesseract", [pngPath, "stdout", "-l", "eng"], {
          timeout: 20000,
          maxBuffer: 5 * 1024 * 1024,
        });
        rawText = typeof ocrText === "string" ? ocrText.slice(0, 20000) : "";
        if (!rawText.trim()) parseFailed = true;
      } catch (_) {
        parseFailed = true;
      }

      const ocrExtracted = rawText ? await extractReceiptFromText(rawText) : null;
      return buildResult({
        extracted: ocrExtracted,
        extractedSource: rawText ? "ocr_text" : null,
        parseFailed,
        extractFailed: !ocrExtracted,
      });
    } finally {
      await Promise.all([
        fs.promises.rm(inputPath, { force: true }).catch(() => {}),
        fs.promises.rm(pngPath, { force: true }).catch(() => {}),
      ]);
    }
  } catch (_) {
    return emptyResult();
  }
};

module.exports = { extractReceiptFields };
