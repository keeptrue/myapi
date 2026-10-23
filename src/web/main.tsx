import * as React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { App } from './App.js'
import './styles.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      staleTime: 5_000,
    },
  },
})

const root = document.getElementById('root')
if (root === null) throw new Error('root element is missing')

createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
        <Toaster theme="dark" position="bottom-right" toastOptions={{ style: { background: 'var(--panel-3)', border: '1px solid var(--line-strong)', color: 'var(--text)' } }} />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
)
