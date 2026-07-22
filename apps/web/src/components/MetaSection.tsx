import type { ComponentChildren } from 'preact'

export default function MetaSection({
  title,
  children,
  muted = false
}: {
  title: string
  children: ComponentChildren
  muted?: boolean
}) {
  return (
    <section class={`ed-meta-section${muted ? ' ed-meta-section--muted' : ''}`}>
      <h2 class="ed-meta-section__title">{title}</h2>
      <div class="ed-meta-section__body">{children}</div>
    </section>
  )
}
