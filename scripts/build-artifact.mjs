// Maakt van de Vite-build één zelfstandig HTML-bestand (CSS en JS inline),
// geschikt om als privé Claude-artifact te publiceren of als los bestand te openen.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const dist = 'dist'
const html = readFileSync(join(dist, 'index.html'), 'utf8')
const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+\.css)"[^>]*>/g)].map((m) =>
  readFileSync(join(dist, m[1]), 'utf8'),
)
const js = [...html.matchAll(/<script type="module"[^>]*src="\.\/(assets\/[^"]+\.js)"[^>]*><\/script>/g)].map((m) =>
  readFileSync(join(dist, m[1]), 'utf8').replace(/<\/script/gi, '<\\/script'),
)

const out = `<title>Football Score Machine</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="theme-color" content="#050d22">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Anton&family=Barlow+Condensed:wght@500;600;700&family=Barlow:wght@500;600&display=swap">
<style>${css.join('\n')}
/* de artifact-omgeving vangt de safe-area al op */
:root{--sat:0px;--sab:0px}
</style>
<div id="root"></div>
<script type="module">${js.join('\n')}</script>
`
const target = 'dist-artifact/football-score-machine.html'
mkdirSync(dirname(target), { recursive: true })
writeFileSync(target, out)
console.log(`${target} (${(out.length / 1024).toFixed(0)} kB)`)
