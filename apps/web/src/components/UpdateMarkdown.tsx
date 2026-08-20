import type { ComponentChildren } from 'preact'
import type { Token } from 'marked'
import { safeUpdateHref, updateMarkdownTokens } from '../lib/update-markdown'

function renderTokens(tokens: Token[]): ComponentChildren[] {
  return tokens.map((token, index) => {
    switch (token.type) {
      case 'text':
      case 'escape':
        return token.text
      case 'codespan':
        return <code key={index}>{token.text}</code>
      case 'strong':
        return <strong key={index}>{renderTokens(token.tokens ?? [])}</strong>
      case 'em':
        return <em key={index}>{renderTokens(token.tokens ?? [])}</em>
      case 'link': {
        const href = safeUpdateHref(token.href)
        if (!href) return token.raw
        const external = href.startsWith('https://')
        return (
          <a
            key={index}
            href={href}
            target={external ? '_blank' : undefined}
            rel={external ? 'noopener noreferrer' : undefined}
          >
            {renderTokens(token.tokens ?? [])}
          </a>
        )
      }
      default:
        return token.raw
    }
  })
}

export default function UpdateMarkdown({ body }: { body: string }) {
  return <p>{renderTokens(updateMarkdownTokens(body))}</p>
}
