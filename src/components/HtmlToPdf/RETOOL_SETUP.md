# Setting up HtmlToPdf in Retool

This guide walks through deploying the component library and wiring the HtmlToPdf component in a Retool app from scratch.

---

## Prerequisites

- Node.js v20+
- Admin access to your Retool instance
- A Retool API token with **read + write** access for Custom Component Libraries
  (Settings → API tokens)

---

## Step 1 — Deploy the library

Run these commands once from the project root:

```bash
npm install
npx retool-ccl login       # enter your Retool URL and API token when prompted
npx retool-ccl init        # register the library (choose a name, e.g. "KLibrary")
npx retool-ccl deploy      # push an immutable production version
```

> During development use `npx retool-ccl dev` instead of `deploy`. This syncs on every save so you can iterate live.

---

## Step 2 — Add the component to your app

1. Open your Retool app.
2. Click **Add components** in the left panel.
3. Scroll to your library name (e.g. **KLibrary**) and find **HtmlToPdf**.
4. Drag it onto the canvas.

> If the library does not appear, refresh the browser and check that the deploy completed without errors.

---

## Step 3 — Wire the inputs

Select the component on the canvas, then in the **Inspector** panel on the right set each input:

| Input | What to bind |
|-------|-------------|
| `htmlContent` | The HTML string from a query or transformer, e.g. `{{ buildPdfHtml.data }}` |
| `cssContent` | The CSS string from a query or transformer, e.g. `{{ buildPdfCss.data }}` — can be left empty |
| `referenceNumber` | A claim / record ID, e.g. `{{ claimsTable.selectedRow.data.referenceNumber }}` |
| `fileName` | A dynamic file name, e.g. `{{ "claim-" + claimsTable.selectedRow.data.id + ".pdf" }}` |

The component will generate the PDF automatically 400 ms after any of these values change. No button click is needed.

---

## Step 4 — Use the PDF output

The component writes the rendered PDF to `htmlToPdf1.pdfBase64` (adjust the component name if you renamed it).

### Upload to an API / S3

Create a REST query and reference the base64 in the body:

```
POST https://your-api.example.com/upload
Content-Type: application/json

{
  "file": "{{ htmlToPdf1.pdfBase64 }}",
  "fileName": "{{ htmlToPdf1.fileName }}"
}
```

### Attach to an email (e.g. SendGrid)

```json
{
  "attachments": [
    {
      "content": "{{ htmlToPdf1.pdfBase64 }}",
      "filename": "{{ htmlToPdf1.fileName }}",
      "type": "application/pdf",
      "disposition": "attachment"
    }
  ]
}
```

### Convert to a Retool File object

Useful for Retool's native File Upload component or S3 resource queries:

```js
utils.base64ToFile(
  htmlToPdf1.pdfBase64,
  htmlToPdf1.fileName,
  'application/pdf'
)
```

---

## Step 5 — Show status feedback (optional)

Bind UI elements to the `status` and `error` outputs for a polished experience:

| What to show | Expression |
|---|---|
| Loading spinner / banner | `{{ htmlToPdf1.status === 'generating' }}` |
| Success message | `{{ htmlToPdf1.status === 'success' }}` |
| Error banner text | `{{ htmlToPdf1.error }}` |

---

## HTML structure tips

The component is designed around cards with the class `summary-card`. Each card is kept whole — it will never be split across a page boundary.

```html
<div class="summary-card">
  <div class="card-header">Section Title</div>
  <div class="summary-row">
    <span class="summary-label">Field name</span>
    <span class="summary-value">Value</span>
  </div>
  <div class="summary-row">
    <span class="summary-label">Status</span>
    <span class="summary-value">✓ Approved</span>  <!-- auto-replaced with SVG icon -->
  </div>
</div>
```

To force a page break before any element, add the class `pdf-page-break`:

```html
<div class="pdf-page-break"></div>
<div class="summary-card">...</div>
```

---

## CSS tips

Pass your styles through `cssContent` rather than embedding `<style>` tags in `htmlContent`. A minimal starting point:

```css
.summary-card {
  border: 1px solid #e9eaec;
  border-radius: 8px;
  overflow: hidden;
  margin-bottom: 16px;
}

.card-header {
  font-weight: 600;
  font-size: 14px;
  padding: 12px 16px;
  border-bottom: 1px solid #e9eaec;
}

.summary-row {
  display: flex;
  padding: 10px 16px;
  border-bottom: 1px solid #f3f4f6;
}

.summary-label {
  color: #6b7280;
  width: 220px;
  flex-shrink: 0;
}

.summary-value {
  color: #111827;
  flex: 1;
}
```

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Component not appearing in the component list | Re-run `npx retool-ccl deploy` and hard-refresh Retool |
| `pdfBase64` is empty | Check `htmlToPdf1.status` — if `error`, read `htmlToPdf1.error` for the cause |
| PDF content is cut off | Make sure `htmlContent` is fully loaded before the component mounts — trigger the query on page load |
| Card border missing at top of a page | Ensure your card elements use the class `summary-card`; the component wraps these automatically to prevent page-boundary clipping |
| Icons look like plain text | The icon replacement only handles `✓ ✔ ✅ ✗ ✘ ❌ ✕` — use one of these characters in your HTML |
