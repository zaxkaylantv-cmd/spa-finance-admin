require("dotenv").config();
const fs = require("fs");
const OpenAI = require("openai");

function getClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.warn("OPENAI_API_KEY is not set; skipping receipt extraction.");
    return null;
  }
  return new OpenAI({ apiKey });
}

async function extractReceiptFromImage(filePath) {
  const client = getClient();
  if (!client) return null;

  let b64;
  try {
    const buf = await fs.promises.readFile(filePath);
    b64 = buf.toString("base64");
  } catch (err) {
    console.error("Failed to read receipt image", err);
    return null;
  }

  const systemPrompt = `You are an accurate receipt parser. Output concise JSON only with fields:\n{
  "merchant": string or null,
  "issue_date": string or null,  // YYYY-MM-DD
  "amount": number or null,      // total due/paid
  "vat_amount": number or null,  // VAT/Tax component if present
  "confidence": number           // 0 to 1
}\nIf a field is missing or unclear, set it to null. Do not guess. Use the main total for amount. Dates must be YYYY-MM-DD or null.`;

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4.1-mini",
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Extract receipt details as JSON.",
            },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${b64}`,
              },
            },
          ],
        },
      ],
      temperature: 0.2,
    });

    const content = response?.choices?.[0]?.message?.content || "";
    try {
      const parsed = JSON.parse(content);
      return parsed;
    } catch (parseErr) {
      console.error("Failed to parse receipt AI JSON", parseErr, content);
      return null;
    }
  } catch (err) {
    console.error("OpenAI receipt extraction error", err);
    return null;
  }
}

module.exports = {
  extractReceiptFromImage,
};
