import { formatSeconds } from './format'
import { formatTrade } from './trade'

export function tradeSummaryLine({
  isPB,
  totalMs,
  sequenceLen,
  cleanTrades,
  wrongGuesses,
  lastTrade
}: {
  isPB: boolean
  totalMs: number
  sequenceLen: number
  cleanTrades: number
  wrongGuesses: number
  lastTrade: number
}): string {
  if (isPB) return `New Trade best: ${formatSeconds(totalMs)}s. Blue-side math is landing.`
  if (wrongGuesses === 0) return `${cleanTrades}/${sequenceLen} clean. You read both bars without a hint.`
  if (lastTrade < 0) return `${cleanTrades}/${sequenceLen} clean. Watch the sign when Blue spends more.`
  if (lastTrade > 0)
    return `${cleanTrades}/${sequenceLen} clean. Positive means Red overspent: ${formatTrade(lastTrade)} last.`
  return `${cleanTrades}/${sequenceLen} clean. Even trades are the easiest place to overthink.`
}
