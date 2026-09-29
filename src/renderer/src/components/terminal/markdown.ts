import { marked } from 'marked'
import DOMPurify from 'dompurify'

// Assistant text and file previews are markdown, not HTML — but GFM lets raw HTML
// pass straight through marked, and DOMPurify's default html profile still allows
// plenty of it (a <style> block blanks the app's own CSS; <details>/<textarea>/
// <select> swallow the rest of the message as their content instead of rendering
// it). Escaping raw HTML at the marked level means a stray "<div>" in a message
// renders as the literal text, which is what a chat transcript should do.
// `marked.use` merges this onto the shared default renderer once, module-wide —
// this file is the only place `marked` is imported.
marked.use({
  renderer: {
    html(token: { text: string }): string {
      return token.text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    }
  }
})

// Belt-and-braces: even with raw HTML escaped above, forbid the tags that would
// either break the app's own styling or swallow the rest of the message as their
// content, in case a future marked/DOMPurify change reopens the html path.
const FORBID_TAGS = ['style', 'form', 'input', 'textarea', 'select', 'button', 'details', 'dialog']

/**
 * Render a small markdown preview to sanitized HTML. Safe to inject: marked
 * escapes any raw HTML in the source instead of passing it through, DOMPurify
 * strips scripts/handlers from what marked DID produce and forbids the tags
 * above, and the app's strict CSP blocks any remote content the markup might
 * reference. Used for read-only chat/reading messages and file previews.
 */
export function renderMarkdownPreview(md: string): string {
  const raw = marked.parse(md, { async: false, gfm: true }) as string
  return DOMPurify.sanitize(raw, { USE_PROFILES: { html: true }, FORBID_TAGS })
}
