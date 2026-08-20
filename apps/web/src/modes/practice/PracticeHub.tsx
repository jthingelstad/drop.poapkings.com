import ModeIcon from '../../components/ModeIcon'
import PracticeDrills from '../../components/PracticeDrills'

export default function PracticeHub() {
  return (
    <div class="practice-hub main-content">
      <header class="practice-hub__head">
        <div class="practice-hub__mark" aria-hidden="true">
          <ModeIcon mode="practice" size={56} />
        </div>
        <div>
          <div class="eyebrow">Training grounds</div>
          <h1>Practice</h1>
          <p>Start practicing. No clock, no ranks—just sharper Clash Royale reads.</p>
        </div>
      </header>

      <PracticeDrills />
    </div>
  )
}
