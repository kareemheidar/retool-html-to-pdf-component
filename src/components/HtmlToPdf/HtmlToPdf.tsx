import { type FC, useRef, useState, useCallback, useEffect, useLayoutEffect, useMemo } from 'react'
import { Retool } from '@tryretool/custom-component-support'
import html2pdf from 'html2pdf.js'
import DOMPurify from 'dompurify'

// Inline default styles applied around the rendered HTML so tables/cards/page
// breaks look correct both on screen and inside the generated PDF. Retool
// strips <style> tags from arbitrary HTML strings injected via dangerouslySetInnerHTML
// in some contexts, so we scope these via a wrapper class instead of relying on
// the incoming htmlContent to carry its own <style>.
const baseStyles = `
.pdf-render-root {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 12px;
  color: #1a1a1a;
  line-height: 1.4;
  width: 210mm;
  box-sizing: border-box;
  padding: 0 12mm 12mm;
  background: #ffffff;
}
.pdf-render-root * {
  box-sizing: border-box;
}
.pdf-render-root img {
  max-width: 100%;
  height: auto;
}
.pdf-render-root table {
  width: 100%;
  border-collapse: collapse;
}
.pdf-render-root td,
.pdf-render-root th {
  padding: 6px 8px;
  word-break: break-word;
}
.pdf-page-break {
  page-break-before: always;
  break-before: page;
}
.pdf-render-root .link-edit {
  display: none;
}
.pdf-icon {
  display: inline-block;
  vertical-align: middle;
  margin: 0 1px;
}
.pdf-render-root .pdf-card-wrapper {
  padding-top: 12px;
  page-break-inside: avoid;
  break-inside: avoid;
}
.pdf-render-root .summary-card {
  page-break-inside: avoid;
  break-inside: avoid;
}
.pdf-title-block {
  padding-bottom: 14px;
  margin-bottom: 20px;
  border-bottom: 2px solid #18181b;
}
.pdf-title-label {
  font-size: 10px;
  font-weight: 500;
  color: #6b7280;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 6px;
}
.pdf-title-ref {
  font-size: 24px;
  font-weight: 700;
  color: #18181b;
  letter-spacing: -0.01em;
  line-height: 1.2;
}
`

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export const HtmlToPdf: FC = () => {
  // ---- Retool-bound model values ----
  const [htmlContent] = Retool.useStateString({
    name: 'htmlContent',
    initialValue: '<div>No content provided.</div>',
  })

  const [cssContent] = Retool.useStateString({
    name: 'cssContent',
    initialValue: '',
  })

  const [referenceNumber] = Retool.useStateString({
    name: 'referenceNumber',
    initialValue: '',
  })

  const [fileName] = Retool.useStateString({
    name: 'fileName',
    initialValue: 'document.pdf',
  })

  const [sanitizeHtml] = Retool.useStateBoolean({
    name: 'sanitizeHtml',
    initialValue: true,
  })

  const [autoGenerate] = Retool.useStateBoolean({
    name: 'autoGenerate',
    initialValue: true,
  })

  const [showControls] = Retool.useStateBoolean({
    name: 'showControls',
    initialValue: true,
  })

  // App sets this to true when it wants generation to start; the component
  // consumes it and resets it back to false so it can be pulsed again later.
  const [triggerGenerate, setTriggerGenerate] = Retool.useStateBoolean({
    name: 'triggerGenerate',
    initialValue: false,
  })

  const [, setPdfBase64] = Retool.useStateString({
    name: 'pdfBase64',
    initialValue: '',
  })

  const [status, setStatus] = Retool.useStateString({
    name: 'status',
    initialValue: 'idle',
  })

  const [error, setError] = Retool.useStateString({
    name: 'error',
    initialValue: '',
  })

  // Fired once pdfBase64 has actually finished updating, so app flows can
  // trigger off this instead of guessing how long generation takes.
  const onGenerated = Retool.useEventCallback({ name: 'generated' })
  const onGenerateError = Retool.useEventCallback({ name: 'generateError' })

  const containerRef = useRef<HTMLDivElement>(null)
  const offscreenRef = useRef<HTMLDivElement>(null)

  // `inert` isn't in this React version's DOM typings yet; set it imperatively.
  // useLayoutEffect (not useEffect) so it's applied before the first paint,
  // and both the IDL property and attribute are set for maximum browser support.
  useLayoutEffect(() => {
    const node = offscreenRef.current
    if (!node) return
    node.setAttribute('inert', '')
    ;(node as HTMLDivElement & { inert: boolean }).inert = true
  }, [])
  const [busyCount, setBusyCount] = useState(0)
  const localBusy = busyCount > 0

  // Bumped at the start of every generate/download call so a slower, older
  // call can detect it's been superseded and skip writing stale results.
  const requestIdRef = useRef(0)

  const processedHtml = useMemo(() => {
    if (typeof window === 'undefined' || !htmlContent) return htmlContent
    try {
      const safeHtml = sanitizeHtml ? DOMPurify.sanitize(htmlContent) : htmlContent
      const doc = new DOMParser().parseFromString(safeHtml, 'text/html')

      // Wrap each .summary-card so html2pdf positions the wrapper (not the card border)
      // at the page boundary, giving 12px of breathing room before the card's border.
      doc.querySelectorAll('.summary-card').forEach((card) => {
        const wrapper = doc.createElement('div')
        wrapper.className = 'pdf-card-wrapper'
        card.parentNode!.insertBefore(wrapper, card)
        wrapper.appendChild(card)
      })

      // Replace plain Unicode check/cross glyphs with modern inline SVG icons.
      const CHECK_SVG = `<svg class="pdf-icon" width="1em" height="1em" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M1.5 6L4.5 9L10.5 3" stroke="#111111" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/></svg>`
      const CROSS_SVG = `<svg class="pdf-icon" width="1em" height="1em" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M2 2L10 10M10 2L2 10" stroke="#111111" stroke-width="1.75" stroke-linecap="round"/></svg>`

      const replaceIcons = (node: Node) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = node.textContent ?? ''
          if (/[✓✔✅]/.test(text) || /[✗✘❌✕]/.test(text)) {
            const span = doc.createElement('span')
            span.innerHTML = text
              .replace(/[✓✔✅]/g, CHECK_SVG)
              .replace(/[✗✘❌✕]/g, CROSS_SVG)
            node.parentNode?.replaceChild(span, node)
          }
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          const tag = (node as Element).tagName.toLowerCase()
          if (tag !== 'style' && tag !== 'script') {
            Array.from(node.childNodes).forEach(replaceIcons)
          }
        }
      }
      replaceIcons(doc.body)

      return doc.body.innerHTML
    } catch {
      return htmlContent
    }
  }, [htmlContent, sanitizeHtml])

  const buildPdfBlob = useCallback(async (): Promise<Blob> => {
    if (!containerRef.current) {
      throw new Error('Render container is not available.')
    }

    const opt = {
      margin: [12, 0, 12, 0],
      filename: fileName || 'document.pdf',
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        logging: false,
      },
      jsPDF: {
        unit: 'mm',
        format: 'a4',
        orientation: 'portrait',
      },
      // Respect .pdf-page-break elements and avoid splitting cards/rows mid-page
      pagebreak: { mode: ['css', 'legacy'], avoid: ['.pdf-card-wrapper', '.summary-card', '.summary-row'] },
    }

    return html2pdf().set(opt).from(containerRef.current).outputPdf('blob')
  }, [fileName])

  const generate = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setBusyCount((c) => c + 1)
    setError('')
    setStatus('rendering')

    try {
      // Give the DOM a tick to finish painting images/fonts before snapshotting
      await new Promise((resolve) => setTimeout(resolve, 50))

      setStatus('generating')
      const blob = await buildPdfBlob()
      const buffer = await blob.arrayBuffer()
      const base64 = arrayBufferToBase64(buffer)

      // A newer generate/download call started while this one was rendering
      // (e.g. the user kept typing). Its result is stale, so drop it.
      if (requestId !== requestIdRef.current) return

      setPdfBase64(base64)
      setStatus('success')
      onGenerated()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('HtmlToPdf generate failed:', err)
      if (requestId !== requestIdRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStatus('error')
      onGenerateError()
    } finally {
      setBusyCount((c) => c - 1)
    }
  }, [buildPdfBlob, setPdfBase64, setStatus, setError, onGenerated, onGenerateError])

  const download = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setBusyCount((c) => c + 1)
    setError('')
    setStatus('rendering')

    try {
      await new Promise((resolve) => setTimeout(resolve, 50))
      setStatus('generating')

      // Render once, reuse the blob for both base64 output and browser download.
      const blob = await buildPdfBlob()
      const buffer = await blob.arrayBuffer()

      // The actual file download always reflects what the user asked for, but
      // skip updating shared state if a newer call has since superseded it.
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName || 'document.pdf'
      a.click()
      URL.revokeObjectURL(url)

      if (requestId !== requestIdRef.current) return

      setPdfBase64(arrayBufferToBase64(buffer))
      setStatus('success')
      onGenerated()
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('HtmlToPdf download failed:', err)
      if (requestId !== requestIdRef.current) return
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStatus('error')
      onGenerateError()
    } finally {
      setBusyCount((c) => c - 1)
    }
  }, [buildPdfBlob, fileName, setPdfBase64, setStatus, setError, onGenerated, onGenerateError])

  // Keep a stable ref so the debounced effect always calls the latest generate
  const generateRef = useRef(generate)
  useEffect(() => { generateRef.current = generate }, [generate])

  // Auto-generate pdfBase64 whenever any content input changes (debounced).
  // Disable via autoGenerate when the app wants to control timing explicitly.
  useEffect(() => {
    if (!autoGenerate) return
    const timer = setTimeout(() => generateRef.current(), 400)
    return () => clearTimeout(timer)
  }, [autoGenerate, htmlContent, cssContent, referenceNumber, fileName])

  // Explicit trigger: app sets triggerGenerate to true, we consume it and
  // reset it back to false so the next pulse can be detected.
  useEffect(() => {
    if (!triggerGenerate) return
    setTriggerGenerate(false)
    generateRef.current()
  }, [triggerGenerate, setTriggerGenerate])

  return (
    <div style={{ width: '100%' }}>
      <style>{baseStyles}</style>

      {showControls && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, alignItems: 'center' }}>
          <button
            type="button"
            onClick={download}
            disabled={localBusy}
            style={{
              padding: '8px 14px',
              borderRadius: 4,
              border: '1px solid #16a34a',
              background: localBusy ? '#86efac' : '#16a34a',
              color: '#fff',
              cursor: localBusy ? 'not-allowed' : 'pointer',
            }}
          >
            Download PDF
          </button>

          {status === 'rendering' || status === 'generating' ? (
            <span style={{ color: '#555' }}>
              {status === 'rendering' ? 'Preparing content…' : 'Rendering pages…'}
            </span>
          ) : null}

          {status === 'success' ? <span style={{ color: '#16a34a' }}>PDF ready ✓</span> : null}

          {status === 'error' ? (
            <span style={{ color: '#dc2626' }}>Error: {error}</span>
          ) : null}
        </div>
      )}

      {/* Kept off-screen (not display:none) so it has real layout for html2pdf to
          snapshot, without showing the rendered HTML in the Retool UI. aria-hidden
          and tabIndex keep it out of the accessibility tree and tab order, since
          arbitrary htmlContent can otherwise contain focusable/announced elements. */}
      <div ref={offscreenRef} style={{ position: 'fixed', top: 0, left: '-99999px' }} aria-hidden="true" tabIndex={-1}>
        <div ref={containerRef}>
          {cssContent && <style>{cssContent}</style>}
          <div className="pdf-render-root">
            {referenceNumber && (
              <div className="pdf-title-block">
                <div className="pdf-title-label">Claim Reference Number</div>
                <div className="pdf-title-ref">{referenceNumber}</div>
              </div>
            )}
            {/* processedHtml is run through DOMPurify above when sanitizeHtml is true (default). */}
            <div dangerouslySetInnerHTML={{ __html: processedHtml }} />
          </div>
        </div>
      </div>
    </div>
  )
}
