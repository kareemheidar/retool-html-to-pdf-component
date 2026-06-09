import { type FC, useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { Retool } from '@tryretool/custom-component-support'
import html2pdf from 'html2pdf.js'

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

  const containerRef = useRef<HTMLDivElement>(null)
  const [localBusy, setLocalBusy] = useState(false)

  const processedHtml = useMemo(() => {
    if (typeof window === 'undefined' || !htmlContent) return htmlContent
    try {
      const doc = new DOMParser().parseFromString(htmlContent, 'text/html')

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
  }, [htmlContent])

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
    setLocalBusy(true)
    setError('')
    setStatus('rendering')

    try {
      // Give the DOM a tick to finish painting images/fonts before snapshotting
      await new Promise((resolve) => setTimeout(resolve, 50))

      setStatus('generating')
      const blob = await buildPdfBlob()
      const buffer = await blob.arrayBuffer()
      const base64 = arrayBufferToBase64(buffer)

      setPdfBase64(base64)
      setStatus('success')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStatus('error')
    } finally {
      setLocalBusy(false)
    }
  }, [buildPdfBlob, setPdfBase64, setStatus, setError])

  const download = useCallback(async () => {
    setLocalBusy(true)
    setError('')
    setStatus('rendering')

    try {
      await new Promise((resolve) => setTimeout(resolve, 50))
      setStatus('generating')

      // Render once, reuse the blob for both base64 output and browser download.
      const blob = await buildPdfBlob()
      const buffer = await blob.arrayBuffer()
      setPdfBase64(arrayBufferToBase64(buffer))

      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName || 'document.pdf'
      a.click()
      URL.revokeObjectURL(url)

      setStatus('success')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
      setStatus('error')
    } finally {
      setLocalBusy(false)
    }
  }, [buildPdfBlob, fileName, setPdfBase64, setStatus, setError])

  // Keep a stable ref so the debounced effect always calls the latest generate
  const generateRef = useRef(generate)
  useEffect(() => { generateRef.current = generate }, [generate])

  // Auto-generate pdfBase64 whenever any content input changes (debounced)
  useEffect(() => {
    const timer = setTimeout(() => generateRef.current(), 400)
    return () => clearTimeout(timer)
  }, [htmlContent, cssContent, referenceNumber, fileName])

  return (
    <div style={{ width: '100%' }}>
      <style>{baseStyles}</style>

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

      <div
        style={{
          maxHeight: 600,
          overflow: 'auto',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          background: '#f9fafb',
          padding: 12,
        }}
      >
        {/* This is the exact DOM html2pdf snapshots into the PDF */}
        <div ref={containerRef}>
          {cssContent && <style>{cssContent}</style>}
          <div className="pdf-render-root">
            {referenceNumber && (
              <div className="pdf-title-block">
                <div className="pdf-title-label">Claim Reference Number</div>
                <div className="pdf-title-ref">{referenceNumber}</div>
              </div>
            )}
            {/* Content comes from a trusted Retool query/model bound to htmlContent.
                Sanitize upstream if it can ever contain untrusted user input. */}
            <div dangerouslySetInnerHTML={{ __html: processedHtml }} />
          </div>
        </div>
      </div>
    </div>
  )
}
