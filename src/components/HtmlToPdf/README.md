# HtmlToPdf

Converts an HTML string to a multi-page A4 PDF using `html2pdf.js` (html2canvas + jsPDF). The PDF is written back to Retool as a Base64 string automatically whenever any input changes, and a **Download PDF** button lets users save it locally.

---

## Inputs

| Property          | Type   | Required | Description |
|-------------------|--------|----------|-------------|
| `htmlContent`     | string | yes      | The HTML markup to render. Bind to a query or transformer output. |
| `cssContent`      | string | no       | CSS rules to apply to the rendered HTML. Keeps styles separate from markup. |
| `referenceNumber` | string | no       | If provided, renders a styled title block at the top of page 1 (e.g. `ILEXP-0067`). |
| `fileName`        | string | no       | Name of the downloaded file. Defaults to `document.pdf`. |

## Outputs

| Property    | Type   | Description |
|-------------|--------|-------------|
| `pdfBase64` | string | Base64-encoded PDF bytes. Updated automatically on every content change. |
| `status`    | string | `idle` → `rendering` → `generating` → `success` or `error` |
| `error`     | string | Error message when `status === 'error'`. Empty otherwise. |

---

## Behavior

### Auto-generation
The component re-generates the PDF 400 ms after any input (`htmlContent`, `cssContent`, `referenceNumber`, `fileName`) changes. No button click required. `pdfBase64` is always up to date.

### Page breaks
- `.summary-card` and `.summary-row` elements are kept whole — they are never split across pages.
- Add the class `pdf-page-break` to any element to force a hard page break before it.
- Pages are A4 portrait with 12 mm margins on all sides.

### Icon replacement
Plain Unicode check and cross characters in `htmlContent` are automatically replaced with clean inline SVG icons before rendering:

| Character(s) | Replaced with |
|---|---|
| `✓` `✔` `✅` | Black checkmark |
| `✗` `✘` `❌` `✕` | Black X |

### CSS injection
Styles from `cssContent` are injected into the render container alongside the HTML, so selectors like `.summary-card` apply exactly as they would in a browser. The component adds a small set of base styles (box-sizing, table resets, font stack) that do not conflict with user-provided styles.

### Download
The **Download PDF** button renders the PDF once, triggers a browser download, and updates `pdfBase64` — all from the same render pass (no double rendering).

---

## Quick wiring example

```
htmlContent     →  {{ generateHtmlQuery.data.html }}
cssContent      →  {{ generateHtmlQuery.data.css }}
referenceNumber →  {{ claimRecord.data.referenceNumber }}
fileName        →  {{ "claim-" + claimRecord.data.id + ".pdf" }}
```

Use the output:
```
// Upload to S3 / REST API
body: {{ htmlToPdf1.pdfBase64 }}

// Convert to a Retool File object
{{ utils.base64ToFile(htmlToPdf1.pdfBase64, htmlToPdf1.fileName, 'application/pdf') }}

// Show a loading indicator
{{ htmlToPdf1.status === 'generating' }}

// Show an error message
{{ htmlToPdf1.error }}
```

---

## Security

`htmlContent` is rendered via `dangerouslySetInnerHTML`. Only bind it to HTML you control (e.g. server-rendered templates or transformer-built strings). If the content can ever include user-supplied input, sanitize it upstream — for example with `DOMPurify` in a Retool transformer before passing it to this component.
