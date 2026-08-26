import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { TooltipProvider } from './components/ui/tooltip.js'
import { App } from './app.js'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
    // Never retry a mutation. From M3 every attempt spends real money, so an
    // automatic second try is an automatic second charge.
    mutations: { retry: false },
  },
})

const root = document.getElementById('root')
if (!root) throw new Error('#root is missing from index.html')

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* Um provedor só na raiz: e o que coordena o atraso entre tooltips
          vizinhos. Sem ele, cada Tooltip abre por conta propria e passar o mouse
          por uma fila de KPIs vira uma sequencia de piscadas. */}
      <TooltipProvider delay={300}>
        <App />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
)
