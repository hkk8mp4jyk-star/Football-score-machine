import DemoApp from './DemoApp.jsx'
import OnlineApp from './online/OnlineApp.jsx'

// De DEMO (lokale testmodus) is alleen bereikbaar via `?demo` achter het
// webadres; zonder `?demo` opent het online spel (beginscherm).
export const isDemoUrl = (search) => new URLSearchParams(search).has('demo')

export default function App() {
  return isDemoUrl(window.location.search) ? <DemoApp /> : <OnlineApp />
}
