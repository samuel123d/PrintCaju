import { Link } from 'react-router-dom'
import Brand from '../components/Brand.jsx'

export default function NotFoundPage() {
  return <main className="printcaju-404"><div className="printcaju-404-card"><Brand /><span className="printcaju-404-code">404 <i>✳</i></span><p className="eyebrow">OPS, ESSA PEÇA NÃO ENCAIXA</p><h1>Não encontramos<br />essa página.</h1><p>O endereço pode ter mudado ou não existe mais. Vamos voltar para um lugar conhecido?</p><Link className="button button-primary" to="/">Voltar ao início <span>↗</span></Link><div className="printcaju-404-decoration" aria-hidden="true"><span></span><span></span><span></span></div></div><small>PRINT CAJU · IDEIAS QUE GANHAM FORMA</small></main>
}
