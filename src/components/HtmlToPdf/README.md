# HtmlToPdf

Converts an HTML string to a multi-page A4 PDF using `html2pdf.js` (html2canvas + jsPDF). The PDF is written back to Retool as a Base64 string, either automatically whenever any input changes or on an explicit trigger, and a **Download PDF** button lets users save it locally.

---

## Inputs

| Property          | Type   | Required | Description |
|-------------------|--------|----------|-------------|
| `htmlContent`     | string | yes      | The HTML markup to render. Bind to a query or transformer output. |
| `cssContent`      | string | no       | CSS rules to apply to the rendered HTML. Keeps styles separate from markup. |
| `pdfHeaderHtml`   | string | no       | HTML prepended before `htmlContent` inside the PDF only (e.g. a logo/title/metadata block for page 1). Never part of `htmlContent`, so if your app reuses `htmlContent` for an on-screen page too, this never shows up there. |
| `referenceNumber` | string | no       | If provided, renders a styled title block at the top of page 1 (e.g. `ILEXP-0067`). |
| `fileName`        | string | no       | Name of the downloaded file. Defaults to `document.pdf`. |
| `sanitizeHtml`    | boolean | no      | When `true` (default), `htmlContent` is run through `DOMPurify` before rendering, stripping scripts and inline event handlers. Turn off only if you trust the source and need markup DOMPurify would strip. |
| `autoGenerate`    | boolean | no      | When `true` (default), the PDF regenerates automatically 400 ms after any content input changes. Set `false` to control timing explicitly with `triggerGenerate` instead. |
| `triggerGenerate` | boolean | no      | Bind to a Temporary State variable's value. When it becomes `true`, generation starts. See [Explicit trigger](#explicit-trigger) below, there's a setup step required, it's not as simple as pointing this at a literal. |
| `showControls`    | boolean | no      | When `true` (default), renders the Download PDF button and status text. Set `false` to run the component fully headless/invisible, e.g. when driven entirely by `autoGenerate`/`triggerGenerate` and the `generated` event. |

## Outputs

| Property    | Type   | Description |
|-------------|--------|-------------|
| `pdfBase64` | string | Base64-encoded PDF bytes. Updated automatically on every content change. |
| `status`    | string | `idle` → `rendering` → `generating` → `success` or `error` |
| `error`     | string | Error message when `status === 'error'`. Empty otherwise. |

## Events

| Event          | Fires when |
|----------------|------------|
| `generated`    | `pdfBase64` has finished updating (auto-generate or Download) and reflects the latest inputs. |
| `generateError`| Generation failed. `error` holds the message. |

Downstream flows should trigger off these events rather than a fixed delay. `pdfBase64` updates asynchronously (debounce + render + encode), a query that reads it immediately after an input change may see stale or empty data. Wire an **Event Handler** on the component for `generated` to run whatever should happen next (upload, download trigger, notification, etc.).

---

## Behavior

### Auto-generation
By default (`autoGenerate: true`), the component re-generates the PDF 400 ms after any input (`htmlContent`, `cssContent`, `referenceNumber`, `fileName`) changes. No button click required. `pdfBase64` is always up to date.

### Explicit trigger
Set `autoGenerate` to `false` to stop regenerating on every input change (useful when the app sets several inputs in sequence and only wants one generation at the end).

Custom component properties in Retool are one-way from the app's side: you bind `triggerGenerate` to something, you can't call `htmlToPdf1.setTriggerGenerate(...)` from a query, that method doesn't exist. To pulse it from a query, you need a piece of app state to bind through:

1. Add a **Temporary State** component to the app, e.g. named `genTrigger`, initial value `false`.
2. Bind `htmlToPdf1`'s `triggerGenerate` property to `{{ genTrigger.value }}`.
3. In your query/JS, once all the other inputs are set, call `genTrigger.setValue(true)` to fire generation.
4. Add an **Event Handler** on `htmlToPdf1` for `generated` (and `generateError`) that resets it: `genTrigger.setValue(false)`. This step is required, the component can consume `triggerGenerate` and reset its own output, but it has no way to write back into `genTrigger` itself. Without resetting `genTrigger`, the next `setValue(true)` won't register as a change and won't fire again.

Works regardless of `autoGenerate`.

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
The **Download PDF** button renders the PDF once, triggers a browser download, and updates `pdfBase64` — all from the same render pass (no double rendering). Only visible when `showControls` is `true`; with it `false` there's no way to trigger the browser download, use `autoGenerate`/`triggerGenerate` plus the `generated` event to consume `pdfBase64` instead.

### Hiding the component completely
`showControls: false` only hides the button/status text rendered *inside* the component. Retool still hosts the component in its own iframe on the page, and that iframe is tab-reachable and announced by screen readers regardless of `showControls`.

Do **not** use the component's native `Hidden` property to fix this, for custom components it stops the iframe from rendering entirely, which kills `autoGenerate`/`triggerGenerate`/timers, generation will silently never happen.

Instead, leave `Hidden` set to `false` and hide it with per-app Custom CSS instead (**Settings → Custom CSS** in the app editor):

```css
._retool-htmlToPdf1 {
  visibility: hidden !important;
}
```

Replace `htmlToPdf1` with your component's actual name, Retool auto-generates a `_retool-<componentName>` class for every component. `visibility: hidden` only affects painting, it removes the component from the tab order and accessibility tree without unmounting it, so the component keeps running normally. Note it still reserves layout space (unlike `display: none`), shrink the component's Height in the Inspector if the empty gap matters.

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

To upload/download automatically once the PDF is ready, don't gate on a delay, use the `generated` event: open the component's **Event Handlers**, add a handler for `generated`, and point it at the query that reads `htmlToPdf1.pdfBase64`.

---

## Security

`htmlContent` is rendered via `dangerouslySetInnerHTML`. By default (`sanitizeHtml: true`), it's run through `DOMPurify` first, which strips `<script>` tags and inline event handlers. Only disable `sanitizeHtml` for content you fully control.
