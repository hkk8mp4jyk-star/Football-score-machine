import { useEffect, useRef, useState } from 'react'
import Reel from './Reel.jsx'
import { AWAY_TEAM, HOME_TEAM, TIMING, reelTargets } from '../game/config.js'
import { buzz, sfx } from '../audio/sound.js'

function Bulbs({ count, side }) {
  return (
    <div className={`bulbs bulbs-${side}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="bulb" style={{ '--i': i }} />
      ))}
    </div>
  )
}

// De fruitautomaat. Ontvangt een `spin` uit de spelstatus en laat beide
// rollen synchroon op `spin.startedAt` draaien. Na de laatste rol meldt hij
// `onSettled`. In multiplayer starten alle telefoons zo tegelijk.
export default function SlotMachine({ spin, restResultId, compact = false, onSettled }) {
  const [mode, setMode] = useState('idle') // idle | spinning | win
  const [stopped, setStopped] = useState(0)
  const targets = spin ? reelTargets(spin.resultId) : restResultId ? reelTargets(restResultId) : [0, 0]
  const settledRef = useRef(onSettled)
  settledRef.current = onSettled

  useEffect(() => {
    if (!spin) return
    setMode('spinning')
    setStopped(0)
    sfx.spinStart()
    buzz(15)
  }, [spin?.id])

  const handleStop = (n) => {
    sfx.reelStop()
    buzz(n === 2 ? 40 : 20)
    setStopped(n)
    if (n === 2) {
      setMode('win')
      settledRef.current?.(spin)
    }
  }

  useEffect(() => {
    if (!spin && mode === 'spinning') setMode('idle')
  }, [spin, mode])

  return (
    <div className={`machine ${compact ? 'machine-compact' : ''} machine-${mode}`}>
      <div className="machine-cabinet">
        <Bulbs count={compact ? 7 : 11} side="top" />
        <div className="machine-face">
          <div className="payline-arrow payline-left" aria-hidden="true" />
          <div className="payline-arrow payline-right" aria-hidden="true" />
          <Reel
            spin={spin}
            target={targets[0]}
            stopAfter={TIMING.reel1Stop}
            restSymbol={targets[0]}
            onStop={() => handleStop(1)}
            onTick={stopped < 1 ? sfx.tick : undefined}
            label={compact ? null : HOME_TEAM}
          />
          <div className="reel-dash" aria-hidden="true">
            <span />
          </div>
          <Reel
            spin={spin}
            target={targets[1]}
            stopAfter={TIMING.reel2Stop}
            restSymbol={targets[1]}
            onStop={() => handleStop(2)}
            onTick={stopped >= 1 ? sfx.tick : undefined}
            label={compact ? null : AWAY_TEAM}
          />
        </div>
        <Bulbs count={compact ? 7 : 11} side="bottom" />
      </div>
    </div>
  )
}
