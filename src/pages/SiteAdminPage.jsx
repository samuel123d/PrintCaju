import { useEffect, useMemo, useState } from 'react'
import ProductImage from '../components/ProductImage.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { DEFAULT_SITE_CONTENT, saveSiteContent, syncPublicCatalog, watchAdminProducts, watchPublicProducts, watchSiteContent } from '../services/site.js'

function photoUrl(product) {
  if (!product?.photoBytes?.toUint8Array || !product.photoContentType) return ''
  const bytes = product.photoBytes.toUint8Array()
  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  return `data:${product.photoContentType};base64,${btoa(binary)}`
}

export default function SiteAdminPage() {
  const { workspaceUid } = useAuth()
  const [content, setContent] = useState(DEFAULT_SITE_CONTENT)
  const [products, setProducts] = useState([])
  const [published, setPublished] = useState([])
  const [saving, setSaving] = useState(false)
  const [syncingCatalog, setSyncingCatalog] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  useEffect(() => {
    if (!workspaceUid) return undefined
    let productsLoaded = false
    let publishedLoaded = false
    let initialSyncStarted = false
    let siteConfigurationStarted = false
    let currentProducts = []
    let currentPublished = []
    const syncInitialCatalog = () => {
      if (initialSyncStarted || !productsLoaded || !publishedLoaded) return
      initialSyncStarted = true
      syncPublicCatalog(currentProducts, currentPublished).then(() => {
        setMessage('Todos os produtos ativos foram incluídos no catálogo público.')
      }).catch((cause) => {
        console.error('Não foi possível sincronizar o catálogo público.', cause)
        setError(cause.message || 'Não foi possível sincronizar os produtos do site.')
      })
    }
    setError('')
    const stops = [
      watchSiteContent((value) => {
        setContent({ ...DEFAULT_SITE_CONTENT, ...value })
        if (!value.workspaceUid && !siteConfigurationStarted) {
          siteConfigurationStarted = true
          saveSiteContent({ ...DEFAULT_SITE_CONTENT, ...value }, workspaceUid).catch((cause) => {
            console.error('Não foi possível inicializar a configuração do site.', cause)
            setError(cause.message || 'Não foi possível configurar o vínculo das contas de clientes.')
          })
        }
      }, reportLoadError),
      watchAdminProducts(workspaceUid, (rows) => {
        currentProducts = rows
        productsLoaded = true
        setProducts(rows)
        syncInitialCatalog()
      }, reportLoadError),
      watchPublicProducts((rows) => {
        currentPublished = rows
        publishedLoaded = true
        setPublished(rows)
        syncInitialCatalog()
      }, reportLoadError),
    ]
    return () => stops.forEach((stop) => stop())
  }, [workspaceUid])

  const listed = useMemo(() => products.filter((product) => product.active !== false && `${product.name} ${product.category || ''}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))), [products, search])

  function reportLoadError(cause) {
    console.error('Não foi possível carregar os dados do editor do site.', cause)
    setError(cause.code === 'permission-denied'
      ? 'O Firebase bloqueou o acesso ao catálogo. Publique as regras atualizadas do Firestore.'
      : cause.message || 'Não foi possível carregar os dados do editor do site.')
  }

  async function save(event) {
    event.preventDefault()
    setSaving(true); setError(''); setMessage('')
    try { await saveSiteContent(content, workspaceUid); setMessage('Conteúdo institucional salvo.') }
    catch (cause) { setError(cause.message || 'Não foi possível salvar o site.') }
    finally { setSaving(false) }
  }

  async function synchronizeCatalog() {
    setSyncingCatalog(true); setError(''); setMessage('')
    try {
      await syncPublicCatalog(products, published)
      setMessage(`${products.filter((product) => product.active !== false).length} produto(s) ativos sincronizados com a loja.`)
    } catch (cause) {
      console.error('Não foi possível sincronizar o catálogo público.', cause)
      setError(cause.message || 'Não foi possível sincronizar os produtos do site. Confira as regras publicadas do Firestore.')
    } finally { setSyncingCatalog(false) }
  }

  return <div className="page-stack site-admin-page">
    <div className="page-intro"><div><p className="eyebrow">PRESENÇA DIGITAL</p><h2>Site institucional</h2><p>Edite o conteúdo público, confira o catálogo e conecte o Instagram pelo Behold.</p></div><a className="button button-secondary" href="/" target="_blank" rel="noreferrer">Visualizar site ↗</a></div>
    {(message || error) && <div className={`alert ${error ? 'alert-error' : 'alert-success'}`} role={error ? 'alert' : 'status'}>{error || message}</div>}
    <form className="panel site-editor-form" onSubmit={save}>
      <header><div><p className="eyebrow">IDENTIDADE DA EMPRESA</p><h3>Conteúdo principal</h3><p>Esses textos aparecem na página inicial e na apresentação da empresa.</p></div></header>
      <div className="site-editor-grid">
        <label>Nome da marca<input maxLength="80" value={content.brandName || ''} onChange={(e) => setContent({ ...content, brandName: e.target.value })} required /></label>
        <label>Frase da marca<input maxLength="120" value={content.tagline || ''} onChange={(e) => setContent({ ...content, tagline: e.target.value })} /></label>
        <label className="site-editor-wide">Título de destaque<input maxLength="120" value={content.heroTitle || ''} onChange={(e) => setContent({ ...content, heroTitle: e.target.value })} required /></label>
        <label className="site-editor-wide">Texto de apresentação<textarea rows="3" maxLength="500" value={content.heroText || ''} onChange={(e) => setContent({ ...content, heroText: e.target.value })} /></label>
        <label>Título “Sobre nós”<input maxLength="120" value={content.aboutTitle || ''} onChange={(e) => setContent({ ...content, aboutTitle: e.target.value })} /></label>
        <label>E-mail público<input type="email" maxLength="160" value={content.email || ''} onChange={(e) => setContent({ ...content, email: e.target.value })} /></label>
        <label className="site-editor-wide">Sobre a empresa<textarea rows="4" maxLength="900" value={content.aboutText || ''} onChange={(e) => setContent({ ...content, aboutText: e.target.value })} /></label>
        <label>WhatsApp (com DDI e DDD)<input inputMode="tel" maxLength="20" placeholder="5511999999999" value={content.whatsapp || ''} onChange={(e) => setContent({ ...content, whatsapp: e.target.value.replace(/\D/g, '') })} /></label>
        <label>Instagram<input maxLength="80" placeholder="@printcaju" value={content.instagram || ''} onChange={(e) => setContent({ ...content, instagram: e.target.value })} /></label>
        <label>Feed ID do Behold<input maxLength="100" pattern="[A-Za-z0-9_-]*" value={content.beholdFeedId || DEFAULT_SITE_CONTENT.beholdFeedId} onChange={(e) => setContent({ ...content, beholdFeedId: e.target.value.trim() })} /><small>O feed configurado é carregado automaticamente no site, sem sincronização manual do Instagram.</small></label>
      </div>
      <footer><span>Use textos claros e mantenha os contatos atualizados.</span><button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar conteúdo'}</button></footer>
    </form>
    <section className="panel site-catalog-admin">
      <header><div><p className="eyebrow">CATÁLOGO PÚBLICO</p><h3>Produtos do seu banco de dados</h3><p>O site mostra todos os produtos ativos do estoque, com foto, descrição, preço e quantidade disponível.</p></div><span className="count-chip">{published.length} publicados</span><button type="button" className="button button-secondary" disabled={syncingCatalog} onClick={synchronizeCatalog}>{syncingCatalog ? 'Sincronizando…' : 'Sincronizar catálogo'}</button></header>
      <label className="search-field site-catalog-search"><span>⌕</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar produto" /></label>
      {listed.length ? <div className="site-admin-product-grid">{listed.map((product) => {
        const isPublished = published.some((item) => item.id === product.id)
        const isAvailable = product.type !== 'fisico' || Number(product.quantity) > 0
        const image = photoUrl(product)
        return <article key={product.id} className="site-admin-product">
          {image ? <ProductImage src={image} alt={product.name} /> : <div className="site-admin-product-placeholder"><ProductImage alt="" /></div>}
          <div><strong>{product.name}</strong><small>{product.category || 'Sem categoria'} · {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(product.price) || 0)}</small>{!image && <small>Adicione uma foto no cadastro de Produtos para enriquecer o catálogo.</small>}</div>
          <span className={`status-pill ${isPublished && isAvailable ? 'payment-paid' : 'payment-pending'}`}>{!isPublished ? 'Sincronizando' : product.type === 'fisico' ? `${Number(product.quantity) || 0} no estoque` : 'Sob encomenda'}</span>
        </article>
      })}</div> : <div className="finance-empty"><strong>Nenhum produto ativo</strong><small>Cadastre produtos em Produtos para começar seu catálogo.</small></div>}
    </section>
    <section className="panel instagram-admin-card"><div className="instagram-admin-copy"><span className="instagram-admin-icon">◎</span><div><p className="eyebrow">INSTAGRAM · BEHOLD</p><h3>Posts e Reels carregados automaticamente</h3><p>O feed Behold configurado aparece na página inicial sem sincronização manual pelo painel.</p></div></div><small>O conteúdo exibido segue as publicações e opções definidas no feed Behold.</small></section>
  </div>
}
