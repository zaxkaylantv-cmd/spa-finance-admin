const OpenAI = require("openai");

const ensureClient = () => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error("OPENAI_API_KEY is not configured");
    err.code = "NO_API_KEY";
    throw err;
  }
  return new OpenAI({ apiKey });
};

const buildPrompt = (invoice, history) => {
  const historyText =
    history && history.length
      ? history
          .slice(0, 10)
          .map(
            (h, idx) =>
              `${idx + 1}. ${h.invoice_number || h.invoiceNumber || "N/A"} — ${h.amount ?? "n/a"} due ${h.due_date || h.dueDate || "n/a"}`,
          )
          .join("\n")
      : "No recent invoices for this supplier.";

  return `You are helping a spa business manage supplier invoices.

Current invoice:
${JSON.stringify(invoice, null, 2)}

Recent invoices for this supplier (latest first):
${historyText}

Return a concise JSON object with:
{
  "autoApproval": {
    "suggestedMonthlyLimit": number,
    "rationale": string
  } | null,
  "supplierEmail": {
    "subject": string,
    "body": string
  } | null,
  "summary": string
}

Rules:
- If you cannot suggest auto-approval safely, set autoApproval to null.
- Keep currency values as numbers (GBP assumed).
- Email should be polite and short.
- Keep summary to 2 short sentences.`;
};

async function generateInvoiceActions(invoice, history = []) {
  const openai = ensureClient();
  const messages = [
    { role: "system", content: "You assist a spa finance team with invoices, keeping responses concise and actionable." },
    { role: "user", content: buildPrompt(invoice, history) },
  ];

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4.1-mini",
      messages,
      temperature: 0.2,
      response_format: { type: "json_object" },
    });
    const content = completion.choices?.[0]?.message?.content;
    if (!content) return { autoApproval: null, supplierEmail: null, summary: "" };
    const parsed = JSON.parse(content);
    return {
      autoApproval: parsed.autoApproval ?? null,
      supplierEmail: parsed.supplierEmail ?? null,
      summary: parsed.summary ?? "",
    };
  } catch (err) {
    console.error("AI generation failed", err);
    throw err;
  }
}

module.exports = {
  generateInvoiceActions,
};
