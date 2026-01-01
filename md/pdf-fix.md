PDF Extraction Fix (pdf-parse + AI JSON robustness)
====================================================

1) Symptoms
- PDF upload works (file view OK) but extracted fields show placeholders (supplier “Uploaded invoice”, amount £0, invoice# becomes prompt text).

2) Root causes we found
- pdf-parse export mismatch and incorrect invocation:
  - require("pdf-parse") returns an object; treating it as a function fails.
  - Selecting PDFParse incorrectly and calling without `new` produced: “Class constructors cannot be invoked without 'new'”.
- AI JSON parsing fragility:
  - Model sometimes returns JSON with code fences, trailing commas, or extra text.
  - invoiceExtractor did `JSON.parse(content)` directly, so parse failures returned null and upstream fell back to amount=0.

3) Correct implementation pattern (Spa Finance Admin)
- In backend/src/server.js:
  - Use: `const { PDFParse } = require("pdf-parse");`
  - Parse a PDF Buffer using:
    - `const parser = new PDFParse({ data: fileBuffer });`
    - `const textResult = await parser.getText();`
    - `const rawText = textResult?.text || ""`
  - Note: receipts uploaded as PDFs use the same parsing approach.

4) Hardening AI JSON parsing (invoice extractor)
- In backend/src/ai/invoiceExtractor.js:
  - Implement a safe JSON parse that:
    - strips ```json fences
    - extracts first {...} block
    - removes trailing commas before } or ]
    - then JSON.parse()
  - On failure: log error message + content length only (do not dump full content).

5) Amount handling note
- Ensure the upload merge accepts AI amounts when present; if the model returns amount as a string in other apps, parse it (e.g., “£186.00” → 186).

6) Verification checklist
- Upload a known PDF invoice and confirm:
  - invoice number populated
  - supplier populated
  - amount not £0
- Confirm /api/invoices shows amount persisted.
- Confirm “View invoice” still opens original PDF.

7) Copy/paste pointers for another repo
- What to search for:
  - pdf-parse usage in upload route
  - “Raw text source” / “PDF parse failed”
  - invoiceExtractor JSON.parse(content)
- Expected log improvement:
  - No “pdf-parse not available as a function”
  - No “Class constructors…” errors
  - AI extraction result is an object, not null
