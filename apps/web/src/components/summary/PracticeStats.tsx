interface PracticeResult {
  correct: number
  total: number
}

interface Props {
  recall: PracticeResult
  assisted: PracticeResult
  recovered: number
  stillDue: number
}

function ratio({ correct, total }: PracticeResult): string {
  return total > 0 ? `${correct} / ${total}` : '—'
}

export default function PracticeStats({ recall, assisted, recovered, stillDue }: Props) {
  return (
    <dl class="ed-practice-stats" aria-label="Practice learning results">
      <div class="ed-practice-stat ed-practice-stat--recall" data-practice-stat="recall">
        <dt>Recall</dt>
        <dd>
          <strong>{ratio(recall)}</strong>
          <span>{recall.total > 0 ? 'correct without help' : 'no unassisted reads'}</span>
        </dd>
      </div>
      <div class="ed-practice-stat ed-practice-stat--assisted" data-practice-stat="assisted">
        <dt>With help</dt>
        <dd>
          <strong>{ratio(assisted)}</strong>
          <span>{assisted.total > 0 ? 'correct with choices' : 'no help used'}</span>
        </dd>
      </div>
      <div class="ed-practice-stat ed-practice-stat--recovered" data-practice-stat="recovered">
        <dt>Recovered</dt>
        <dd>
          <strong>{recovered}</strong>
          <span>recalled after a miss</span>
        </dd>
      </div>
      <div class="ed-practice-stat ed-practice-stat--due" data-practice-stat="due">
        <dt>Still due</dt>
        <dd>
          <strong>{stillDue}</strong>
          <span>{stillDue === 1 ? 'card to recall again' : 'cards to recall again'}</span>
        </dd>
      </div>
    </dl>
  )
}
