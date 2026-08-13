import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HtmlToPdf } from './HtmlToPdf'

// html2pdf.js drives real canvas/PDF rendering, which these tests don't exercise.
// Mocked so the component can be rendered without a canvas implementation, and
// hoisted so tests can assert on how many times it was actually invoked.
const { html2pdfMock } = vi.hoisted(() => ({
  html2pdfMock: vi.fn(() => ({
    set: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    outputPdf: vi.fn(async () => new Blob(['pdf'], { type: 'application/pdf' })),
  })),
}))

vi.mock('html2pdf.js', () => ({ default: html2pdfMock }))

let stateStore: Record<string, unknown> = {}

vi.mock('@tryretool/custom-component-support', () => ({
  Retool: {
    useStateString: vi.fn((opts: { name: string; initialValue: string }) => {
      const value = (stateStore[opts.name] as string | undefined) ?? opts.initialValue
      return [value, (v: string) => { stateStore[opts.name] = v }]
    }),
    useStateBoolean: vi.fn((opts: { name: string; initialValue: boolean }) => {
      const value = (stateStore[opts.name] as boolean | undefined) ?? opts.initialValue
      return [value, (v: boolean) => { stateStore[opts.name] = v }]
    }),
    useEventCallback: vi.fn(() => vi.fn()),
  },
}))

describe('HtmlToPdf', () => {
  beforeEach(() => {
    stateStore = {}
    vi.clearAllMocks()
  })

  it('renders without crashing', () => {
    render(<HtmlToPdf />)
  })

  it('renders a Download PDF button', () => {
    render(<HtmlToPdf />)
    expect(screen.getByText('Download PDF')).toBeDefined()
  })

  it('strips script tags from htmlContent when sanitizeHtml is enabled (default)', () => {
    stateStore.htmlContent = '<div>hi</div><script>window.x = 1</script>'
    const { container } = render(<HtmlToPdf />)
    expect(container.innerHTML).not.toContain('<script>')
  })

  it('strips inline event handler attributes when sanitizeHtml is enabled (default)', () => {
    stateStore.htmlContent = '<img src="x.png" onerror="window.x = 1">'
    const { container } = render(<HtmlToPdf />)
    expect(container.innerHTML).not.toContain('onerror')
  })

  it('does not sanitize htmlContent when sanitizeHtml is disabled', () => {
    stateStore.htmlContent = '<img src="x.png" onerror="window.x = 1">'
    stateStore.sanitizeHtml = false
    const { container } = render(<HtmlToPdf />)
    expect(container.innerHTML).toContain('onerror')
  })

  it('replaces checkmark glyphs with an inline svg icon', () => {
    stateStore.htmlContent = '<div>done</div>'
    const { container } = render(<HtmlToPdf />)
    expect(container.querySelector('svg.pdf-icon')).toBeNull()

    stateStore.htmlContent = '<div>✓ done</div>'
    const { container: container2 } = render(<HtmlToPdf />)
    expect(container2.querySelector('svg.pdf-icon')).not.toBeNull()
  })

  it('renders the reference number title block when provided', () => {
    stateStore.referenceNumber = 'ILEXP-0067'
    render(<HtmlToPdf />)
    expect(screen.getByText('ILEXP-0067')).toBeDefined()
  })

  it('does not generate when autoGenerate is false and triggerGenerate is untouched', async () => {
    vi.useFakeTimers()
    stateStore.autoGenerate = false
    render(<HtmlToPdf />)
    await vi.advanceTimersByTimeAsync(500)
    expect(html2pdfMock).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('generates once when triggerGenerate is pulsed to true', async () => {
    vi.useFakeTimers()
    stateStore.autoGenerate = false
    stateStore.triggerGenerate = true
    render(<HtmlToPdf />)
    await vi.advanceTimersByTimeAsync(100)
    expect(html2pdfMock).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
