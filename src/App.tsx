import { lazy, Suspense } from 'react'
import { useRoute } from './router'
import LibraryScreen from './features/library/LibraryScreen'
import CardScreen from './features/card/CardScreen'

const DrillScreen = lazy(() => import('./features/drill/DrillScreen'))
const EvolutionScreen = lazy(() => import('./features/evolution/EvolutionScreen'))
const ElectrodeLabScreen = lazy(() => import('./features/electrode-lab/ElectrodeLabScreen'))
const HyperKScreen = lazy(() => import('./features/hyperk/HyperKScreen'))
const PackScreen = lazy(() => import('./features/pack/PackScreen'))
const AboutScreen = lazy(() => import('./features/about/AboutScreen'))
const DevTraceScreen = lazy(() => import('./features/trace/DevTraceScreen'))

const Loading = () => (
  <div className="screen" style={{ paddingTop: 80, color: 'var(--ink-3)', textAlign: 'center' }}>…</div>
)

export default function App() {
  const route = useRoute()
  return (
    <Suspense fallback={<Loading />}>
      {route.name === 'library' && <LibraryScreen />}
      {route.name === 'card' && <CardScreen cardId={route.cardId} key={route.cardId} />}
      {route.name === 'drill' && <DrillScreen />}
      {route.name === 'evolution' && <EvolutionScreen />}
      {route.name === 'lab-electrodes' && <ElectrodeLabScreen />}
      {route.name === 'lab-hyperk' && <HyperKScreen />}
      {route.name === 'pack' && <PackScreen packId={route.packId} key={route.packId} />}
      {route.name === 'about' && <AboutScreen />}
      {route.name === 'dev-trace' && <DevTraceScreen />}
    </Suspense>
  )
}
