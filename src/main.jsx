import { Component, StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import Brand from './components/Brand.jsx'
import './styles/global.css'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((cause) => {
      console.warn('Não foi possível registrar o modo instalável do Print Caju.', cause)
    })
  })
}

class AppRenderBoundary extends Component {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error, info) {
    console.error('A página Print Caju encontrou uma falha de renderização.', error, info)
  }

  render() {
    if (this.state.failed) return <main className="app-render-error"><section><Brand /><span className="institutional-kicker">VAMOS AJUSTAR ESTA PÁGINA</span><h1>Esta página não carregou como deveria.</h1><p>O restante do seu acesso continua protegido. Atualize a página para tentar novamente.</p><button className="button button-primary" onClick={() => window.location.reload()}>Atualizar página</button><a href="/">Voltar ao site Print Caju</a></section></main>
    return this.props.children
  }
}

const root = createRoot(document.getElementById('root'))

function renderStartupError(error) {
  console.error('Não foi possível inicializar o site Print Caju.', error)
  root.render(<main className="app-render-error"><section><Brand /><span className="institutional-kicker">NÃO CONSEGUIMOS ABRIR O SITE</span><h1>Estamos preparando esta página.</h1><p>O site encontrou um problema ao iniciar. Atualize a página para tentar novamente.</p><button className="button button-primary" onClick={() => window.location.reload()}>Tentar novamente</button><a href="/">Voltar ao início</a></section></main>)
}

root.render(<main className="app-startup"><div className="app-startup-mark">✳</div><strong>Print Caju</strong><span>Preparando nosso espaço…</span></main>)

import('./App.jsx').then(({ default: App }) => {
  root.render(<StrictMode><AppRenderBoundary><BrowserRouter><App /></BrowserRouter></AppRenderBoundary></StrictMode>)
}).catch(renderStartupError)
