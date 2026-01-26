# Spa Finance Admin – Pilot Overview

## What This System Does
Spa Finance Admin helps you capture invoices and receipts with less manual work and fewer mistakes.

During the pilot, the system:
- Captures invoices sent by email automatically
- Allows you to upload invoices and receipts manually
- Stores all documents securely in your Google Drive
- Shows a clear cashflow view
- Lets you export data to CSV for accounting
- Prevents duplicate invoices or receipts

---

## How You’ll Use It
- **Email invoices** to your usual inbox → they appear automatically
- **Upload receipts or invoices** by dragging and dropping
- **Archive** items once handled (they disappear from the active list)
- **Export CSVs** when you need to share data with your accountant

---

## Security & Data Safety
- Only logged-in users can access the system
- No documents are stored permanently on the server
- Google Drive is the system of record for all files
- Duplicate documents are automatically blocked
- Archived items are hidden, not deleted

---

## What This Pilot Is (and Isn’t)

### This pilot is:
- A safe, real-world test of daily usage
- Focused on saving time and reducing admin
- Designed to surface improvements for phase 2

### This pilot is not:
- Automatic accounting or bank posting
- A replacement for your accountant
- A final, locked version of the system

---

## What Success Looks Like
The pilot is successful if:
- Invoices and receipts are captured reliably
- Nothing is duplicated or lost
- Admin time is reduced
- Exports are usable for accounting

---

## Support During Pilot
- Issues or feedback are logged and reviewed
- Fixes focus on stability, not new features
- Improvements are planned for the next phase

**Pilot status:** Active and production-safe

---

## Security, Data Storage & Resilience (Plain English)

### Who can access the system
- The system requires sign-in to access any data.
- Only authorised users can view invoices, receipts, tips, or exports.
- Every action is linked to a signed-in user.

This means your data is not accessible anonymously and activity is accountable.

---

### Where your data lives (important)

**Documents (invoices & receipts)**
- All invoices and receipts are stored in **your Google Drive**.
- Google Drive is the **primary source of truth** for documents.
- The app only stores secure links so files can be opened easily.

**Opening documents on mobile**
- When you tap **Open**, the system takes you directly to the file in Google Drive.
- This is designed to work reliably on iPhone and iPad, where mobile browsers require a direct link to open documents safely.

**Business data (amounts, dates, reports)**
- All operational data is stored securely in **Supabase**.
- This includes:
  - Invoice and receipt details
  - Tips & gratuities
  - Cashflow calculations
  - Dashboard and AI summaries
  - CSV exports

Supabase acts as:
- The **system of record** for your finance admin data
- A **resilient backup** for reports and history

---

### What is (and isn’t) stored on the server
- The server does **not** permanently store invoices or receipts.
- Files only pass through briefly so they can be sent to Google Drive.
- After upload, no copy is kept on the server.

This avoids hidden storage, long-term file retention, or lock-in.

---

### Data ownership & resilience
- Your business **owns its data**.
- If the system is unavailable:
  - Your documents remain accessible in Google Drive
  - Your finance data remains safely stored in Supabase
- Data can be exported at any time using CSV.

There is no vendor lock-in.

---

### Duplicate protection
- The system prevents duplicate invoices and receipts.
- Email retries or re-uploads will not create duplicate records.

This reduces the risk of double payments and admin errors.

---

### What the AI does (and does not do)
- The AI highlights what’s due, what’s coming up, and busy weeks.
- It does **not** make payments or move money.
- It does **not** replace your accountant.

Think of it as a clear, helpful summary to support decisions.
