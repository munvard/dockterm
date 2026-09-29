/**
 * Small, dependency-free HTML to Markdown converter for the composer's rich
 * paste. Handles the structural tags people actually copy (tables, lists,
 * headings, code blocks, links, quotes) and nothing else. Works on a tiny
 * tokenizer, not the DOM, so it runs (and is tested) under plain Node.
 */

interface El {
  tag: string
  attrs: Record<string, string>
  children: Node[]
}
type Node = El | string

const VOID = new Set(['br', 'hr', 'img', 'meta', 'link', 'input', 'col', 'wbr', 'area', 'base'])
const SKIP = new Set(['script', 'style', 'head', 'title', 'noscript', 'template', 'xml'])
const BLOCKISH = new Set([
  'p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'nav', 'figure',
  'figcaption', 'details', 'summary', 'dl', 'dt', 'dd', 'address', 'form', 'fieldset', 'body', 'html'
])

const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-',
  hellip: '...', lsquo: "'", rsquo: "'", ldquo: '"', rdquo: '"', copy: '(c)', middot: '·',
  bull: '•', times: '×', laquo: '«', raquo: '»'
}

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, body: string) => {
    if (body[0] === '#') {
      const code = body[1].toLowerCase() === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return m
      const ch = String.fromCodePoint(code)
      return ch === ' ' ? ' ' : ch
    }
    return ENTITIES[body.toLowerCase()] ?? m
  })
}

function parseAttrs(raw: string): Record<string, string> {
  const out: Record<string, string> = {}
  const re = /([^\s=/"'>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw))) {
    out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return out
}

// Opening these implicitly closes an open sibling of the listed kind.
const IMPLIED: Record<string, string[]> = {
  li: ['li'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  tr: ['td', 'th', 'tr'],
  p: ['p'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  thead: ['tr', 'td', 'th'],
  tbody: ['tr', 'td', 'th', 'thead'],
  tfoot: ['tr', 'td', 'th', 'tbody', 'thead']
}
// Implicit closing never crosses these boundaries.
const BOUNDARY = new Set(['ul', 'ol', 'table', 'body', 'html', 'blockquote'])

export function parseHtml(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [] }
  const stack: El[] = [root]
  const top = (): El => stack[stack.length - 1]
  const re = /<!--[\s\S]*?-->|<!\[[^\]]*\]>|<![^>]*>|<\?[^>]*>|<\/([a-zA-Z][\w:-]*)\s*>|<([a-zA-Z][\w:-]*)((?:"[^"]*"|'[^']*'|[^>"'])*)>|[^<]+|</g
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const [full, closeTag, openTag, attrRaw] = m
    if (closeTag) {
      const tag = closeTag.toLowerCase()
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i
          break
        }
        if (BOUNDARY.has(stack[i].tag)) break
      }
      continue
    }
    if (openTag) {
      const tag = openTag.toLowerCase()
      const closes = IMPLIED[tag]
      if (closes) {
        for (let i = stack.length - 1; i > 0; i--) {
          const t = stack[i].tag
          if (closes.includes(t)) {
            stack.length = i
            break
          }
          if (BOUNDARY.has(t) || (tag === 'li' && (t === 'ul' || t === 'ol'))) break
        }
      }
      const el: El = { tag, attrs: parseAttrs(attrRaw ?? ''), children: [] }
      top().children.push(el)
      const selfClosed = /\/\s*$/.test(attrRaw ?? '')
      if (!VOID.has(tag) && !selfClosed) stack.push(el)
      continue
    }
    if (full.startsWith('<!') || full.startsWith('<?')) continue
    if (full === '<') {
      top().children.push('<')
      continue
    }
    top().children.push(full)
  }
  return root
}

interface Ctx {
  pre: boolean
  inCell: boolean
}

function rawText(n: Node): string {
  if (typeof n === 'string') return decodeEntities(n)
  if (SKIP.has(n.tag)) return ''
  if (n.tag === 'br') return '\n'
  return n.children.map(rawText).join('')
}

function wrapInline(inner: string, mark: string): string {
  if (inner.trim() === '') return inner
  const lead = /^\s*/.exec(inner)![0]
  const trail = /\s*$/.exec(inner)![0]
  return `${lead}${mark}${inner.trim()}${mark}${trail}`
}

function safeHref(href: string | undefined): string | null {
  if (!href) return null
  const h = href.trim()
  return /^(https?:|mailto:)/i.test(h) ? h.replace(/\s/g, '%20').replace(/\)/g, '%29') : null
}

function inlines(children: Node[], ctx: Ctx): string {
  return children.map((c) => render(c, ctx)).join('')
}

function renderList(el: El, ctx: Ctx, depth: number): string {
  const ordered = el.tag === 'ol'
  let n = ordered ? parseInt(el.attrs['start'] ?? '1', 10) || 1 : 0
  const lines: string[] = []
  for (const c of el.children) {
    if (typeof c === 'string' || c.tag !== 'li') continue
    const marker = ordered ? `${n++}. ` : '- '
    const own = c.children.filter((x) => typeof x === 'string' || (x.tag !== 'ul' && x.tag !== 'ol'))
    const nested = c.children.filter((x): x is El => typeof x !== 'string' && (x.tag === 'ul' || x.tag === 'ol'))
    const text = inlines(own, ctx).replace(/\s*\n\s*/g, ' ').replace(/[ \t]{2,}/g, ' ').trim()
    let block = marker + text
    for (const sub of nested) {
      const body = renderList(sub, ctx, depth + 1)
      if (body) block += '\n' + body.split('\n').map((l) => ' '.repeat(marker.length) + l).join('\n')
    }
    lines.push(block)
  }
  return lines.join('\n')
}

function cellText(el: El, ctx: Ctx): string {
  return inlines(el.children, { ...ctx, inCell: true })
    .replace(/\s*\n\s*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\|/g, '\\|')
    .trim()
}

function collectRows(el: El, rows: El[]): void {
  for (const c of el.children) {
    if (typeof c === 'string') continue
    if (c.tag === 'tr') rows.push(c)
    else if (c.tag === 'thead' || c.tag === 'tbody' || c.tag === 'tfoot') collectRows(c, rows)
  }
}

function renderTable(el: El, ctx: Ctx): string {
  const trs: El[] = []
  collectRows(el, trs)
  const grid: string[][] = trs.map((tr) => {
    const row: string[] = []
    for (const c of tr.children) {
      if (typeof c === 'string' || (c.tag !== 'td' && c.tag !== 'th')) continue
      row.push(cellText(c, ctx))
      const span = parseInt(c.attrs['colspan'] ?? '1', 10)
      for (let i = 1; i < (Number.isFinite(span) ? Math.min(span, 50) : 1); i++) row.push('')
    }
    return row
  })
  const rows = grid.filter((r) => r.length > 0)
  if (rows.length === 0) return ''
  const cols = Math.max(...rows.map((r) => r.length))
  if (rows.length === 1 && cols === 1) return rows[0][0]
  const pad = (r: string[]): string[] => [...r, ...Array(cols - r.length).fill('')]
  const fmt = (r: string[]): string => `| ${pad(r).join(' | ')} |`
  const out = [fmt(rows[0]), `| ${Array(cols).fill('---').join(' | ')} |`, ...rows.slice(1).map(fmt)]
  return `\n\n${out.join('\n')}\n\n`
}

function render(n: Node, ctx: Ctx): string {
  if (typeof n === 'string') {
    const t = decodeEntities(n)
    return ctx.pre ? t : t.replace(/\s+/g, ' ')
  }
  const tag = n.tag
  if (SKIP.has(tag)) return ''
  switch (tag) {
    case 'br':
      return ctx.inCell ? ' ' : '\n'
    case 'hr':
      return '\n\n---\n\n'
    case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
      const t = inlines(n.children, ctx).replace(/\s+/g, ' ').trim()
      return t ? `\n\n${'#'.repeat(Number(tag[1]))} ${t}\n\n` : ''
    }
    case 'strong': case 'b':
      return wrapInline(inlines(n.children, ctx), '**')
    case 'em': case 'i':
      return wrapInline(inlines(n.children, ctx), '*')
    case 'del': case 's': case 'strike':
      return wrapInline(inlines(n.children, ctx), '~~')
    case 'code': {
      const t = rawText(n)
      if (!t) return ''
      const fence = t.includes('`') ? '``' : '`'
      return `${fence}${t.replace(/\n/g, ' ')}${fence}`
    }
    case 'pre': {
      const body = rawText(n).replace(/^\n+|\s+$/g, '')
      const codeChild = n.children.find((c): c is El => typeof c !== 'string' && c.tag === 'code')
      const lang = /language-([\w+#-]+)/.exec(codeChild?.attrs['class'] ?? n.attrs['class'] ?? '')?.[1] ?? ''
      const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map((r) => r.length))
      const fence = '`'.repeat(longest + 1)
      return `\n\n${fence}${lang}\n${body}\n${fence}\n\n`
    }
    case 'a': {
      const text = inlines(n.children, ctx).replace(/\s+/g, ' ').trim()
      const href = safeHref(n.attrs['href'])
      if (!text) return ''
      if (!href || text === href) return text
      return `[${text}](${href})`
    }
    case 'img': {
      const alt = (n.attrs['alt'] ?? '').trim()
      const src = safeHref(n.attrs['src'])
      return src && alt ? `![${alt}](${src})` : alt
    }
    case 'ul': case 'ol': {
      const body = renderList(n, ctx, 0)
      return body ? `\n\n${body}\n\n` : ''
    }
    case 'blockquote': {
      const inner = normalize(inlines(n.children, ctx))
      if (!inner) return ''
      return `\n\n${inner.split('\n').map((l) => (l ? `> ${l}` : '>')).join('\n')}\n\n`
    }
    case 'table':
      return renderTable(n, ctx)
    case 'p':
      return `\n\n${inlines(n.children, ctx)}\n\n`
    case 'div':
      return `\n${inlines(n.children, ctx)}\n`
    default:
      if (BLOCKISH.has(tag)) return `\n${inlines(n.children, ctx)}\n`
      return inlines(n.children, ctx)
  }
}

function normalize(s: string): string {
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+(?=\n)/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^[ \t]*\n+/, '')
    .trimEnd()
}

export function htmlToMarkdown(html: string): string {
  return normalize(render(parseHtml(html), { pre: false, inCell: false }))
}

const TABLE_RE = /<table[\s>][\s\S]*?<\/table>/gi
// GitHub's classic blob/diff view (`td.blob-code`, `data-line-number`), Pygments/Sphinx
// (`table.highlighttable`, `td.linenos`), or any `<pre>` / `<code>` inside a table.
const CODE_TABLE_RE =
  /<(pre|code)[\s>/]|data-line-number|class\s*=\s*["'][^"']*(blob-code|blob-num|highlight|linenos|codehilite|\bcode\b)/i

/**
 * Code shown as a table (one row per line, a line-number column) would become a
 * broken GFM table: indentation and newlines are lost. Such a paste stays plain text.
 */
function hasCodeTable(html: string): boolean {
  return (html.match(TABLE_RE) ?? []).some((t) => CODE_TABLE_RE.test(t))
}

const STRUCTURAL_RE = /<(table|ul|ol|h[1-6]|pre|blockquote)[\s>/]|<a\s[^>]*href\s*=/i
const CODE_EDITOR_MIMES = ['vscode-editor-data']

/**
 * Whether a paste's HTML is worth converting: it has structural tags AND does
 * not come from a code editor (VS Code adds `vscode-editor-data`; other editors
 * wrap monospace text in a `white-space: pre` div with no structure at all).
 */
export function shouldConvertHtml(html: string, types: readonly string[]): boolean {
  if (types.some((t) => CODE_EDITOR_MIMES.includes(t))) return false
  if (!STRUCTURAL_RE.test(html)) return false
  if (hasCodeTable(html)) return false
  const monoOnly =
    /font-family:[^;"']*(monospace|menlo|consolas|courier|monaco)/i.test(html) &&
    /white-space:\s*pre/i.test(html) &&
    !/<(table|ul|ol|h[1-6]|blockquote)[\s>/]|<a\s[^>]*href\s*=/i.test(html)
  return !monoOnly
}
