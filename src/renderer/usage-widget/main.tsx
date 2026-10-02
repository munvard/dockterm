import { createRoot } from 'react-dom/client'
import '../src/styles/tokens.css'
import '../src/styles/base.css'
import '../src/styles/usage.css'
import { UsageWidget } from './UsageWidget'

const container = document.getElementById('usage-widget-root')
if (!container) throw new Error('Usage widget root missing')
createRoot(container).render(<UsageWidget />)
