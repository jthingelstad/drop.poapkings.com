import { marked, type Token } from 'marked'

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/

export function isUpdateTimestamp(value: string): boolean {
  return ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value))
}

export function safeUpdateHref(href: string): string | undefined {
  if (href.startsWith('/') && !href.startsWith('//')) return href
  if (href.startsWith('#')) return href
  try {
    const url = new URL(href)
    return url.protocol === 'https:' || url.protocol === 'mailto:' ? href : undefined
  } catch {
    return undefined
  }
}

function validateInlineTokens(tokens: Token[]): string[] {
  const errors: string[] = []
  for (const token of tokens) {
    switch (token.type) {
      case 'text':
      case 'escape':
      case 'codespan':
        break
      case 'strong':
      case 'em':
        errors.push(...validateInlineTokens(token.tokens ?? []))
        break
      case 'link':
        if (!safeUpdateHref(token.href)) errors.push(`Link uses an unsupported destination: ${token.href}`)
        errors.push(...validateInlineTokens(token.tokens ?? []))
        break
      default:
        errors.push(`Markdown element is not supported in update copy: ${token.type}`)
    }
  }
  return errors
}

export function updateMarkdownTokens(body: string): Token[] {
  const blocks = marked.lexer(body, { gfm: true })
  if (blocks.length !== 1 || blocks[0]?.type !== 'paragraph') {
    throw new Error('Update copy must be exactly one paragraph')
  }
  const tokens = blocks[0].tokens ?? []
  const errors = validateInlineTokens(tokens)
  if (errors.length > 0) throw new Error(errors.join('; '))
  return tokens
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character] ?? character
  )
}

function renderTokens(tokens: Token[]): string {
  return tokens
    .map((token) => {
      switch (token.type) {
        case 'text':
        case 'escape':
          return escapeHtml(token.text)
        case 'codespan':
          return `<code>${escapeHtml(token.text)}</code>`
        case 'strong':
          return `<strong>${renderTokens(token.tokens ?? [])}</strong>`
        case 'em':
          return `<em>${renderTokens(token.tokens ?? [])}</em>`
        case 'link': {
          const href = safeUpdateHref(token.href)
          if (!href) return escapeHtml(token.raw)
          const external = href.startsWith('https://')
          return `<a href="${escapeHtml(href)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${renderTokens(token.tokens ?? [])}</a>`
        }
        default:
          return escapeHtml(token.raw)
      }
    })
    .join('')
}

export function renderUpdateMarkdownHtml(body: string): string {
  return renderTokens(updateMarkdownTokens(body))
}
