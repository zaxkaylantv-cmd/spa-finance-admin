const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFile } = require("child_process");
const { PDFParse } = require("pdf-parse");
const { extractInvoiceFromText } = require("./invoiceExtractor");

const emptyResult = () => ({
  supplier: null,
  invoice_number: null,
  issue_date: null,
  due_date: null,
  amount: null,
  vat_amount: null,
  status: "Needs info",
  category: null,
  week_label: null,
  confidence: null,
  extracted_json: null,
  extracted_source: null,
  needs_review: true,
});

const parseAmount = (value) => {
  if (!value) return undefined;
  const cleaned = value.replace(/[^0-9.\-]+/g, "");
  const num = parseFloat(cleaned);
  return Number.isNaN(num) ? undefined : num;
};

const normaliseDate = (value) => {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  const parsed = new Date(str);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
};

const toNullableNumber = (value) => {
  if (value === null || value === undefined || value === "" || value === "NaN") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
};

const weekLabelFromDate = (date) => `Week of ${date}`;

const simpleExtract = (text) => {
  if (!text) return {};
  const lines = text.split(/\r?\n/);
  const findValue = (label) => {
    const line = lines.find((l) => l.toLowerCase().includes(label));
    if (!line) return undefined;
    const parts = line.split(/[:\-]/);
    return parts.length > 1 ? parts.slice(1).join(":").trim() : undefined;
  };
  const parseDate = (value) => {
    if (!value) return undefined;
    const parsed = new Date(value);
    return isNaN(parsed.getTime()) ? undefined : parsed.toISOString().slice(0, 10);
  };

  return {
    supplier: findValue("supplier"),
    invoice_number: findValue("invoice number") || findValue("invoice no") || findValue("inv"),
    issue_date: parseDate(findValue("issue date")),
    due_date: parseDate(findValue("due date")),
    amount: parseAmount(findValue("amount") || findValue("total") || findValue("balance")),
  };
};

const execFilePromise = (cmd, args, options) =>
  new Promise((resolve, reject) => {
    execFile(cmd, args, options, (err, stdout) => {
      if (err) return reject(err);
      resolve(stdout || "");
    });
  });

const extractInvoiceFields = async ({ buffer, mimeType, filename }) => {
  try {
    const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
    const mimetype = (mimeType || "").toLowerCase();
    const ext = path.extname(filename || "").toLowerCase();
    const imageExtensions = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".heic", ".heif"];
    const isPdf = mimetype === "application/pdf" || mimetype === "application/x-pdf" || mimetype.includes("pdf") || ext === ".pdf";
    const isImage = mimetype.startsWith("image/") || imageExtensions.includes(ext);

    let rawText = "";
    let parseFailed = false;
    let extractedSource = null;

    if (isPdf) {
      try {
        if (typeof PDFParse !== "function") {
          throw new Error("pdf-parse PDFParse class not available");
        }
        const parser = new PDFParse({ data: buf });
        const textResult = await parser.getText();
        rawText = textResult && typeof textResult.text === "string" ? textResult.text : "";
        extractedSource = rawText ? "pdf_text" : null;
      } catch (pdfErr) {
        console.error("PDF parse failed:", pdfErr);
        parseFailed = true;
        rawText = `Uploaded invoice file: ${filename || ""}. Extract key invoice details.`;
      }
    } else if (isImage) {
      let tmpDir;
      try {
        tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "invoice-ocr-"));
        const inputPath = path.join(tmpDir, "input.bin");
        const pngPath = path.join(tmpDir, "converted.png");
        await fs.promises.writeFile(inputPath, buf);
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
        extractedSource = rawText ? "image_ocr" : null;
        if (!rawText) {
          parseFailed = true;
          rawText = `Uploaded invoice file: ${filename || ""}. Extract key invoice details.`;
        }
      } catch (ocrErr) {
        console.error("Image OCR failed:", ocrErr);
        parseFailed = true;
        rawText = "";
      } finally {
        if (tmpDir) {
          await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    } else {
      parseFailed = true;
      rawText = `Uploaded invoice file: ${filename || ""}. Extract key invoice details.`;
    }

    const simpleResult = simpleExtract(rawText);

    let aiResult = null;
    let aiFailed = false;
    try {
      aiResult = await extractInvoiceFromText(rawText);
    } catch (err) {
      console.error("AI extraction failed:", err);
      aiFailed = true;
    }

    const mergedInvoice = emptyResult();
    mergedInvoice.status = null;
    mergedInvoice.needs_review = false;

    if (simpleResult && typeof simpleResult === "object") {
      mergedInvoice.supplier = simpleResult.supplier?.trim() || mergedInvoice.supplier;
      mergedInvoice.invoice_number = simpleResult.invoice_number?.toString().trim() || mergedInvoice.invoice_number;
      mergedInvoice.issue_date = simpleResult.issue_date || mergedInvoice.issue_date;
      mergedInvoice.due_date = simpleResult.due_date || mergedInvoice.due_date;
      if (typeof simpleResult.amount === "number" && !Number.isNaN(simpleResult.amount)) {
        mergedInvoice.amount = simpleResult.amount;
      }
    }

    if (aiResult && typeof aiResult === "object") {
      mergedInvoice.supplier =
        (typeof aiResult.supplier === "string" && aiResult.supplier.trim()) || mergedInvoice.supplier;
      mergedInvoice.invoice_number =
        (aiResult.invoice_number && aiResult.invoice_number.toString().trim()) || mergedInvoice.invoice_number;
      mergedInvoice.issue_date = aiResult.issue_date || mergedInvoice.issue_date;
      mergedInvoice.due_date = aiResult.due_date || mergedInvoice.due_date;
      const aiAmount =
        typeof aiResult.amount === "number" && Number.isFinite(aiResult.amount)
          ? aiResult.amount
          : typeof aiResult.amount === "string"
            ? parseAmount(aiResult.amount)
            : undefined;
      if (typeof aiAmount === "number" && Number.isFinite(aiAmount)) {
        mergedInvoice.amount = aiAmount;
      }
      const aiTax =
        typeof aiResult.tax === "number" && Number.isFinite(aiResult.tax)
          ? aiResult.tax
          : typeof aiResult.tax === "string"
            ? parseAmount(aiResult.tax)
            : undefined;
      const aiVat =
        typeof aiResult.vat === "number" && Number.isFinite(aiResult.vat)
          ? aiResult.vat
          : typeof aiResult.vat === "string"
            ? parseAmount(aiResult.vat)
            : undefined;
      if (typeof aiVat === "number" && Number.isFinite(aiVat)) {
        mergedInvoice.vat_amount = aiVat;
      } else if (typeof aiTax === "number" && Number.isFinite(aiTax)) {
        mergedInvoice.vat_amount = aiTax;
      }
      mergedInvoice.status =
        (typeof aiResult.status === "string" && aiResult.status.trim()) || mergedInvoice.status;
      mergedInvoice.category =
        (typeof aiResult.category === "string" && aiResult.category.trim()) || mergedInvoice.category;
      mergedInvoice.confidence =
        typeof aiResult.confidence === "number" && Number.isFinite(aiResult.confidence) ? aiResult.confidence : null;
    } else {
      console.error("AI extraction failed or returned null:", aiResult);
    }

    mergedInvoice.extracted_source = extractedSource;
    mergedInvoice.extracted_json = aiResult ? JSON.stringify(aiResult).slice(0, 8000) : null;
    mergedInvoice.issue_date = normaliseDate(mergedInvoice.issue_date);
    mergedInvoice.due_date = normaliseDate(mergedInvoice.due_date);
    mergedInvoice.amount = toNullableNumber(mergedInvoice.amount);
    mergedInvoice.vat_amount = toNullableNumber(mergedInvoice.vat_amount);
    mergedInvoice.category = mergedInvoice.category || null;
    mergedInvoice.supplier = (mergedInvoice.supplier || "").toString().trim() || null;
    mergedInvoice.invoice_number = (mergedInvoice.invoice_number || "").toString().trim() || null;
    mergedInvoice.week_label = mergedInvoice.due_date ? weekLabelFromDate(mergedInvoice.due_date) : null;

    const needsReview =
      parseFailed ||
      aiFailed ||
      !aiResult ||
      !mergedInvoice.supplier ||
      !mergedInvoice.invoice_number ||
      mergedInvoice.amount === null ||
      (typeof mergedInvoice.confidence === "number" && mergedInvoice.confidence < 0.5);
    mergedInvoice.needs_review = Boolean(needsReview);
    mergedInvoice.status = needsReview
      ? "Needs info"
      : (typeof aiResult?.status === "string" && aiResult.status.trim()) || null;

    return mergedInvoice;
  } catch (err) {
    console.error("Invoice extraction failed:", err);
    return emptyResult();
  }
};

module.exports = { extractInvoiceFields };
