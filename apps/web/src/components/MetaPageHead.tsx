import { back } from '../lib/router'
import Icon from './Icon'

export default function MetaPageHead({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div class="ed-page__head">
      <button class="ed-page__back tap-fx" onClick={() => back('/')} aria-label="Back">
        <Icon name="chevron-left" />
      </button>
      <div>
        <div class="ed-page__eyebrow">{eyebrow}</div>
        <h1 class="ed-page__title">{title}</h1>
      </div>
    </div>
  )
}
