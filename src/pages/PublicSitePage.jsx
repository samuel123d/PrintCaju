import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import ProductImage from '../components/ProductImage.jsx'
import { DEFAULT_SITE_CONTENT, loadShoppingCart, saveShoppingCart, watchPublicInstagramPosts, watchPublicProducts, watchSiteContent } from '../services/site.js'

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)

export default function PublicSitePage() {
  const [site, setSite] = useState(DEFAULT_SITE_CONTENT)
  const [products, setProducts] = useState([])
  const [instagramPosts, setInstagramPosts] = useState([])
  const [cart, setCart] = useState(loadShoppingCart)
  const [cartOpen, setCartOpen] = useState(false)
  const cartDialogRef = useRef(null)
  const [productSearch, setProductSearch] = useState('')
  const [catalogLoading, setCatalogLoading] = useState(true)
  const [siteError, setSiteError] = useState('')
  const [catalogError, setCatalogError] = useState('')
  const [beholdError, setBeholdError] = useState('')
  const beholdFeedId = String(site.beholdFeedId || DEFAULT_SITE_CONTENT.beholdFeedId)
  const socialPosts = instagramPosts.length ? instagramPosts : Array.isArray(site.instagramPosts) ? site.instagramPosts : []
  useEffect(() => {
    if (!/^[A-Za-z0-9_-]{1,100}$/.test(beholdFeedId)) return
    if (document.getElementById('behold-widget-script')) return
    const script = document.createElement('script')
    script.id = 'behold-widget-script'
    script.type = 'module'
    script.src = 'https://w.behold.so/widget.js'
    script.addEventListener('error', () => setBeholdError('Não foi possível carregar o feed agora. Visite o Instagram da Print Caju.'))
    document.head.appendChild(script)
  }, [beholdFeedId])
  useEffect(() => {
    const stopContent = watchSiteContent(setSite, (cause) => {
      console.error('Não foi possível carregar o conteúdo institucional.', cause)
      setSiteError('Não foi possível carregar todas as informações do site. Tente novamente mais tarde.')
    })
    const stopProducts = watchPublicProducts((rows) => {
      setProducts(rows)
      setCatalogLoading(false)
      setCatalogError('')
    }, (cause) => {
      console.error('Não foi possível carregar o catálogo público.', cause)
      setCatalogLoading(false)
      setCatalogError('Nosso catálogo está temporariamente indisponível. Tente novamente mais tarde.')
    })
    const stopInstagram = watchPublicInstagramPosts((rows) => setInstagramPosts(rows), (cause) => {
      console.error('Não foi possível carregar as publicações do Instagram.', cause)
      setBeholdError('Não foi possível carregar as publicações sincronizadas. Verifique as regras publicadas do Firestore.')
    })
    return () => { stopContent(); stopProducts(); stopInstagram() }
  }, [])
  useEffect(() => { saveShoppingCart(cart) }, [cart])
  useEffect(() => {
    const dialog = cartDialogRef.current
    if (!dialog) return undefined
    if (cartOpen && !dialog.open) dialog.showModal()
    if (!cartOpen && dialog.open) dialog.close()
    return undefined
  }, [cartOpen])
  const cartCount = Object.values(cart).reduce((total, quantity) => total + quantity, 0)
  const cartRows = products.filter((product) => cart[product.id]).map((product) => ({
    ...product,
    cartQuantity: cart[product.id],
    lineTotal: Number(product.price || 0) * cart[product.id],
  }))
  const cartTotal = cartRows.reduce((total, item) => total + item.lineTotal, 0)
  const whatsapp = String(site.whatsapp || '').replace(/\D/g, '')
  const instagramHandle = String(site.instagram || '').replace(/^@/, '')
  const instagramUsername = site.instagramUsername || instagramHandle || 'printcaju'
  const visibleProducts = products.filter((product) => `${product.name || ''} ${product.description || ''} ${product.category || ''}`.toLocaleLowerCase('pt-BR').includes(productSearch.toLocaleLowerCase('pt-BR')))
  useEffect(() => {
    const elements = document.querySelectorAll('.institutional-site .motion-reveal:not(.is-visible)')
    if (!('IntersectionObserver' in window)) {
      elements.forEach((element) => element.classList.add('is-visible'))
      return undefined
    }
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible')
          observer.unobserve(entry.target)
        }
      })
    }, { threshold: 0.12, rootMargin: '0px 0px -35px 0px' })
    elements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [products.length, productSearch, instagramPosts.length, cartCount])
  function addToCart(productId) {
    const product = products.find((item) => item.id === productId)
    if (!product || (cart[productId] || 0) >= 50) return
    setCart((current) => ({ ...current, [productId]: Math.min(50, (current[productId] || 0) + 1) }))
    setCartOpen(true)
  }
  function updateCartQuantity(productId, quantity) {
    setCart((current) => {
      const next = { ...current }
      if (quantity < 1) delete next[productId]
      else {
        next[productId] = Math.min(50, quantity)
      }
      return next
    })
  }
  return <main className="institutional-site">
    {siteError && <p className="alert alert-error" role="alert">{siteError}</p>}
    <header className="institutional-header"><Link to="/" className="institutional-brand"><Brand /><span>{site.tagline}</span></Link><nav><a href="#compras">Compras</a><a href="#sobre">Sobre nós</a><a href="#contato">Contato</a></nav><button type="button" className="button button-secondary storefront-cart-trigger" onClick={() => setCartOpen(true)} aria-label={`Abrir sacola com ${cartCount} ${cartCount === 1 ? 'item' : 'itens'}`}><span aria-hidden="true">▱</span> Sacola <span className="storefront-cart-count">{cartCount}</span></button><Link className="button button-primary" to="/conta">Minha conta</Link></header>
    <section className="institutional-hero"><div className="institutional-hero-copy motion-reveal"><span className="institutional-kicker">IMPRESSÃO 3D · CRIATIVIDADE · CUIDADO</span><h1>{site.heroTitle}</h1><p>{site.heroText}</p><div><a className="button button-primary" href="#catalogo">Conheça nossos produtos <span>↓</span></a>{whatsapp && <a className="institutional-text-link" href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">Converse com a gente ↗</a>}</div><small>Peças criadas com atenção a cada detalhe.</small></div><div className="institutional-hero-art motion-reveal" aria-label="Identidade visual Print Caju"><div className="institutional-sun"></div><div className="institutional-orbit institutional-orbit-one"></div><div className="institutional-orbit institutional-orbit-two"></div><img src="/printcaju-mark.png" alt="" /></div><span className="institutional-hero-index">01 — FEITO PARA IMAGINAR</span></section>
    <section className="institutional-catalog motion-reveal" id="compras">
      <span id="catalogo" className="institutional-anchor" aria-hidden="true"></span>
      <div className="institutional-section-heading"><div><span className="institutional-kicker">COMPRAS · CATÁLOGO PRINT CAJU</span><h2>Encontre sua próxima peça.</h2></div><p>Produtos, fotos, descrições, preços e saldo sincronizados com o estoque do sistema.</p></div>
      <label className="storefront-search"><span>⌕</span><input type="search" value={productSearch} onChange={(event) => setProductSearch(event.target.value)} placeholder="Buscar produtos por nome, categoria ou descrição" aria-label="Buscar produtos" /></label>
      {products.length ? visibleProducts.length ? <div className="institutional-product-grid">{visibleProducts.map((product, index) => {
        const soldOut = product.hasInventory && Number(product.quantity) <= 0
        const cartQuantity = Number(cart[product.id] || 0)
        const scheduledInCart = product.hasInventory && cartQuantity > Number(product.quantity)
        const cartAtLimit = cartQuantity >= 50
        return <article className="institutional-product-card motion-reveal" style={{ '--reveal-delay': `${Math.min(index % 6, 5) * 70}ms` }} key={product.id}>
          <div className="institutional-product-image"><ProductImage src={product.photo} alt={product.name} loading="lazy" /></div>
          <div className="institutional-product-info"><small>{product.category || 'PRINT CAJU'}</small><h3>{product.name}</h3><p>{product.description || 'Peça criada com cuidado pela Print Caju.'}</p><strong>{money(product.price)}</strong><span className={`storefront-stock ${soldOut ? 'is-out' : ''}`}>{product.hasInventory ? soldOut ? 'Esgotado · 0 no estoque' : `${product.quantity} unidade(s) em estoque` : 'Disponível sob encomenda'}</span>{scheduledInCart && <small className="storefront-scheduled-note">Agendamento na sacola: {cartQuantity - Number(product.quantity)} unidade(s) aguardando reposição</small>}<button className="button button-primary storefront-add-button" disabled={cartAtLimit} onClick={() => addToCart(product.id)}>{cartAtLimit ? 'Limite de 50 unidades' : soldOut ? 'Agendar compra' : scheduledInCart ? `Adicionar mais · ${cartQuantity} na sacola` : cartQuantity > 0 ? `Adicionar mais · ${cartQuantity} na sacola` : 'Adicionar à sacola'}</button></div>
        </article>
      })}</div> : <div className="institutional-empty"><span>⌕</span><h3>Nenhum produto encontrado.</h3><p>Tente buscar por outro nome ou categoria.</p></div> : <div className="institutional-empty"><span>✳</span><h3>{catalogLoading ? 'Carregando nosso catálogo…' : catalogError ? 'Não foi possível abrir o catálogo.' : 'Novidades estão a caminho.'}</h3><p>{catalogError || 'Ainda não há produtos publicados. O administrador pode sincronizar os produtos na área “Site institucional”.'}</p></div>}
    </section>
    <dialog className="storefront-cart-dialog" ref={cartDialogRef} aria-labelledby="storefront-cart-title" onCancel={(event) => { event.preventDefault(); setCartOpen(false) }} onClick={(event) => { if (event.target === event.currentTarget) setCartOpen(false) }}>
      <aside className="storefront-cart-drawer">
        <header className="storefront-cart-drawer-header"><div><span className="institutional-kicker">PRINT CAJU</span><h2 id="storefront-cart-title">Sua sacola <span>({cartCount})</span></h2></div><button type="button" className="storefront-cart-close" onClick={() => setCartOpen(false)} aria-label="Fechar sacola">×</button></header>
        {cartRows.length
          ? <><div className="storefront-cart-items">{cartRows.map((item) => {
            const maxQuantity = 50
            const scheduledQuantity = item.hasInventory ? Math.max(0, item.cartQuantity - Number(item.quantity || 0)) : 0
            return <article className="storefront-cart-item" key={item.id}>
              <div className="storefront-cart-item-image"><ProductImage src={item.photo} alt="" /></div>
              <div className="storefront-cart-item-details"><h3>{item.name}</h3><span>{money(item.price)} cada</span>{scheduledQuantity > 0 && <small className="storefront-scheduled-note" role="status">Compra agendada: {scheduledQuantity} unidade(s) sem estoque. A Print Caju confirmará o prazo.</small>}<div className="storefront-cart-item-actions"><div className="storefront-quantity-control" aria-label={`Quantidade de ${item.name}`}><button type="button" onClick={() => updateCartQuantity(item.id, item.cartQuantity - 1)} aria-label={`Diminuir ${item.name}`}>−</button><span aria-live="polite">{item.cartQuantity}</span><button type="button" onClick={() => updateCartQuantity(item.id, item.cartQuantity + 1)} disabled={item.cartQuantity >= maxQuantity} aria-label={`Aumentar ${item.name}`}>+</button></div><button type="button" className="storefront-cart-remove" onClick={() => updateCartQuantity(item.id, 0)}>Remover</button></div></div>
              <strong className="storefront-cart-item-total">{money(item.lineTotal)}</strong>
            </article>
          })}</div><footer className="storefront-cart-footer"><div><span>Subtotal</span><strong>{money(cartTotal)}</strong></div><small>A disponibilidade e o valor serão confirmados pela Print Caju antes da cobrança.</small><Link className="button button-primary" to="/conta?checkout=1" onClick={() => setCartOpen(false)}>Continuar para finalizar</Link><button type="button" className="storefront-cart-continue" onClick={() => setCartOpen(false)}>Continuar comprando</button></footer></>
          : <div className="storefront-cart-empty"><span aria-hidden="true">▱</span><h3>Sua sacola está vazia</h3><p>Adicione um produto do catálogo e ele aparecerá aqui.</p><button type="button" className="button button-primary" onClick={() => { setCartOpen(false); document.getElementById('compras')?.scrollIntoView({ behavior: 'smooth' }) }}>Ver produtos</button></div>}
      </aside>
    </dialog>
    <section className="institutional-about motion-reveal" id="sobre"><div className="institutional-about-mark"><img src="/printcaju-mark.png" alt="Símbolo Print Caju" /></div><div><span className="institutional-kicker">UM POUCO SOBRE NÓS</span><h2>{site.aboutTitle}</h2><p>{site.aboutText}</p><a href={whatsapp ? `https://wa.me/${whatsapp}` : '#contato'} target={whatsapp ? '_blank' : undefined} rel={whatsapp ? 'noreferrer' : undefined} className="institutional-text-link">Vamos criar juntos ↗</a></div><section className="institutional-instagram institutional-about-social" id="instagram"><div className="institutional-section-heading"><div><span className="institutional-kicker">NOSSA COMUNIDADE</span><h2>Print Caju no Instagram.</h2></div><a className="institutional-text-link" href={`https://instagram.com/${encodeURIComponent(instagramUsername)}`} target="_blank" rel="noreferrer">@{instagramUsername} ↗</a></div>{beholdFeedId && /^[A-Za-z0-9_-]{1,100}$/.test(beholdFeedId) ? <><behold-widget feed-id={beholdFeedId}></behold-widget>{beholdError && <p className="institutional-instagram-empty" role="status">{beholdError}</p>}</> : site.instagramPosts?.length > 0 ? <div className="institutional-instagram-grid">{site.instagramPosts.slice(0, 6).map((post, index) => <a style={{ '--reveal-delay': `${index * 60}ms` }} key={post.id} href={post.url} target="_blank" rel="noreferrer" aria-label={`Ver ${post.type === 'VIDEO' ? 'Reel' : 'publicação'} no Instagram: ${post.caption || 'Print Caju'}`}><img src={post.image} alt={post.caption || (post.type === 'VIDEO' ? 'Reel da Print Caju' : 'Publicação Print Caju')} loading="lazy" /><span>{post.type === 'VIDEO' ? '▶ Assistir Reel' : post.type === 'CAROUSEL_ALBUM' ? 'Ver carrossel' : 'Ver publicação'} ↗</span></a>)}</div> : <div className="institutional-instagram-empty"><span>◎</span><p>{beholdError || (beholdFeedId ? 'Carregando as postagens do Instagram…' : 'Configure o Feed ID do Behold no painel administrativo para exibir as postagens aqui.')}</p><a className="button button-secondary" href={`https://instagram.com/${encodeURIComponent(instagramUsername)}`} target="_blank" rel="noreferrer">Visitar @{instagramUsername} ↗</a></div>}</section></section>
    <section className="institutional-instagram institutional-instagram-all motion-reveal" id="instagram-feed">
      <div className="institutional-section-heading"><div><span className="institutional-kicker">NOSSA COMUNIDADE</span><h2>Print Caju no Instagram.</h2></div><a className="institutional-text-link" href={`https://instagram.com/${encodeURIComponent(instagramUsername)}`} target="_blank" rel="noreferrer">@{instagramUsername} ↗</a></div>
      {beholdFeedId && /^[A-Za-z0-9_-]{1,100}$/.test(beholdFeedId)
        ? <><behold-widget feed-id={beholdFeedId}></behold-widget>{beholdError && <p className="institutional-instagram-empty" role="status">{beholdError}</p>}</>
        : socialPosts.length
          ? <div className="institutional-instagram-grid">{socialPosts.map((post, index) => <a style={{ '--reveal-delay': `${index % 10 * 40}ms` }} key={post.id} href={post.url} target="_blank" rel="noreferrer" aria-label={`Ver ${post.type === 'VIDEO' ? 'Reel' : 'publicação'} no Instagram: ${post.caption || 'Print Caju'}`}>{post.image ? <img src={post.image} alt={post.caption || (post.type === 'VIDEO' ? 'Reel da Print Caju' : 'Publicação Print Caju')} loading="lazy" /> : <span className="institutional-instagram-no-image">◎ Ver no Instagram</span>}<span>{post.type === 'VIDEO' ? '▶ Assistir Reel' : post.type === 'CAROUSEL_ALBUM' ? 'Ver carrossel' : 'Ver publicação'} ↗</span></a>)}</div>
          : <div className="institutional-instagram-empty"><span>◎</span><p>{beholdError || 'Não foi possível carregar o feed do Instagram agora.'}</p><a className="button button-secondary" href={`https://instagram.com/${encodeURIComponent(instagramUsername)}`} target="_blank" rel="noreferrer">Visitar @{instagramUsername} ↗</a></div>}
    </section>
    <section className="institutional-contact motion-reveal" id="contato"><div><span className="institutional-kicker">FALE COM A PRINT CAJU</span><h2>Seu próximo projeto começa com uma conversa.</h2><p>Estamos por aqui para ajudar com dúvidas, encomendas e ideias personalizadas.</p></div><div className="institutional-contact-links">{whatsapp && <a href={`https://wa.me/${whatsapp}`} target="_blank" rel="noreferrer">WhatsApp <span>↗</span></a>}{site.email && <a href={`mailto:${site.email}`}>{site.email} <span>↗</span></a>}{instagramHandle && <a href={`https://instagram.com/${encodeURIComponent(instagramHandle)}`} target="_blank" rel="noreferrer">Instagram @{instagramHandle} <span>↗</span></a>}</div></section>
    <footer className="institutional-footer motion-reveal">
      <Brand compact />
      <div className="institutional-footer-copy"><span>© {new Date().getFullYear()} {site.brandName || 'Print Caju'}</span><small>Feito com cuidado, do nosso ateliê para você.</small></div>
      <nav aria-label="Links do rodapé"><Link to="/cadastro-cliente">Cadastro</Link><Link to="/conta">Área do cliente</Link><Link to="/admin/login">Área administrativa</Link></nav>
    </footer>
  </main>
}
