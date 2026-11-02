import { useEffect, useReducer } from 'react'
import { enableAudioFromTap, onSoundChange, setSound, soundOn, soundReady } from '../../audio/openingSound.js'

// Actuele geluidstoestand; ververst bij wijziging en na een tik (iOS).
export function useSound() {
  const [, refresh] = useReducer((n) => n + 1, 0)
  useEffect(() => {
    const off = onSoundChange(refresh)
    // iOS kan de audio buiten ons om pauzeren: af en toe opnieuw kijken.
    const id = setInterval(refresh, 1500)
    return () => {
      off()
      clearInterval(id)
    }
  }, [])
  return { on: soundOn(), ready: soundReady() }
}

// Eén knop voor wachtkamer en opening:
//  - geluid aan maar nog geblokkeerd door de browser → "🔊 Geluid aan" (één tik)
//  - geluid aan en klinkt → 🔊 (tik = uit)
//  - geluid uit → 🔇 (tik = aan)
export function SoundButton() {
  const { on, ready } = useSound()
  if (on && !ready) {
    return (
      <button type="button" className="ol-sound-btn is-locked" onClick={enableAudioFromTap}>
        <span aria-hidden="true">🔊</span> Geluid aan
      </button>
    )
  }
  return (
    <button type="button" className="ol-sound-btn" onClick={() => setSound(!on)} aria-label={on ? 'Geluid uit' : 'Geluid aan'} aria-pressed={on}>
      <span aria-hidden="true">{on ? '🔊' : '🔇'}</span>
    </button>
  )
}
