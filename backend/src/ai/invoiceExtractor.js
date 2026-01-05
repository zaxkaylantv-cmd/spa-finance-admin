require("dotenv").config();
const OpenAI = require("openai");

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY is not set; skipping AI extraction.");
    return null;
  }
  return new OpenAI({ apiKey });
}

async function extractInvoiceFromText(rawText) {
  const client = getClient();
  if (!client) return null;
  try {
    const systemPrompt = `
You are an invoice extraction engine. Use ONLY the information explicitly present in the provided text.
Never invent or guess supplier names, invoice numbers, dates, or amounts.
For any field that is missing, unclear, or ambiguous in the text, set it to null.
Dates may appear in formats like YYYY-MM-DD, DD/MM/YYYY, or "15 Nov 2025". Output dates strictly as YYYY-MM-DD or null.
Return pure JSON only, no extra text.`;
    const userPrompt = `
Extract this JSON:
{
  "supplier": string or null,
  "invoice_number": string or null,
  "issue_date": string or null,   // YYYY-MM-DD
  "due_date": string or null,     // YYYY-MM-DD
  "amount": number or null,
  "status": string or null,       // e.g. "Upcoming", "Due soon", "Overdue", "Paid"
  "category": string or null
}
If a field is not present in the text, set it to null. Do not guess.

TEXT:
${rawText || ""}`;

    // Instruction: do not hallucinate; missing fields must be null; output pure JSON only.
    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.2,
    });

    const content = response?.choices?.[0]?.message?.content || "";
    const safeParseJson = (raw) => {
      if (!raw) return null;
      let cleaned = raw.trim();
      if (cleaned.startsWith("```")) {
        const fenceEnd = cleaned.indexOf("```", 3);
        if (fenceEnd !== -1) {
          cleaned = cleaned.slice(3, fenceEnd);
        }
      }
      const firstBrace = cleaned.indexOf("{");
      const lastBrace = cleaned.lastIndexOf("}");
      if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
        cleaned = cleaned.slice(firstBrace, lastBrace + 1);
      }
      cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      return JSON.parse(cleaned);
    };
    try {
      const parsed = safeParseJson(content);
      return parsed;
    } catch (err) {
      console.error("Failed to parse AI invoice JSON:", err?.message, "len=", content.length);
      return null;
    }
  } catch (err) {
    console.error("OpenAI extraction error", err);
    return null;
  }
}

module.exports = {
  extractInvoiceFromText,
};

async function extractInvoiceFromImage(filePath) {
  const client = getClient();
  if (!client) return null;
  const fs = require("fs");
  let b64;
  try {
    const buf = await fs.promises.readFile(filePath);
    b64 = buf.toString("base64");
  } catch (err) {
    console.error("Failed to read invoice image", err);
    return null;
  }

  const systemPrompt = `You are an accurate invoice parser. Return strict JSON only:
{
  "supplier": string or null,
  "invoice_number": string or null,
  "issue_date": string or null, // YYYY-MM-DD
  "due_date": string or null,   // YYYY-MM-DD
  "amount": number or null,
  "subtotal": number or null,
  "tax": number or null,
  "category": string or null,
  "confidence": number           // 0 to 1
}
If a field is missing or unclear, set it to null. Do not guess.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "Extract invoice details as JSON." },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ],
        },
      ],
      temperature: 0.2,
    });
    const content = response?.choices?.[0]?.message?.content || "";
    let cleaned = content.trim();
    if (cleaned.startsWith("```")) {
      const end = cleaned.indexOf("```", 3);
      if (end !== -1) cleaned = cleaned.slice(3, end);
    }
    const firstBrace = cleaned.indexOf("{");
    const lastBrace = cleaned.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      cleaned = cleaned.slice(firstBrace, lastBrace + 1);
    }
    cleaned = cleaned.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("OpenAI invoice image extraction error", err);
    return null;
  }
}

module.exports.extractInvoiceFromImage = extractInvoiceFromImage;
