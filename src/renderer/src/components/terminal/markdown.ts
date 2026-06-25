import { marked } from 'marked'
import DOMPurify from 'dompurify'

/**
 * Render a small markdown preview to sanitized HTML. Safe to inject:
 * DOMPurify strips scripts/handlers, and the app's strict CSP blocks any remote
 * content the markup might reference. Used only for read-only hover previews.
 */
export function renderMarkdownPreview(md: string): string {
  const raw = marked.parse(md, { async: false, gfm: true }) as string
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true } })
}
