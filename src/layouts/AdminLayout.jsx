import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import useExternalSales from '../hooks/useExternalSales.js'
import useProducts from '../hooks/useProducts.js'
import usePreferences from '../hooks/usePreferences.js'
import useClients from '../hooks/useClients.js'
import useQuotes from '../hooks/useQuotes.js'
import useFinancialMaterials from '../hooks/useFinancialMaterials.js'
import useFinancialTransactions from '../hooks/useFinancialTransactions.js'
import usePurchases from '../hooks/usePurchases.js'
import { isProductionComplete } from '../utils/saleStatus.js'

function DailySystemAlerts({ preferences }) {
  const { user } = useAuth()
  const { sales } = useExternalSales()
  const { quotes } = useQuotes()
  const { products } = useProducts()
  const { materials } = useFinancialMaterials()
  const [current, setCurrent] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setCurrent(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const today = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`
  const horizon = new Date(current.getFullYear(), current.getMonth(), current.getDate() + Number(preferences.dueAlertDays || 3))
  const until = `${horizon.getFullYear()}-${String(horizon.getMonth() + 1).padStart(2, '0')}-${String(horizon.getDate()).padStart(2, '0')}`
  const dueOrders = preferences.dailyDueAlertsEnabled ? sales.filter((sale) => sale.status !== 'cancelled' && sale.deliveryStatus !== 'delivered' && !isProductionComplete(sale) && sale.dueDate) : []
  const overdueSales = dueOrders.filter((sale) => sale.dueDate < today)
  const dueSoonSales = dueOrders.filter((sale) => sale.dueDate >= today && sale.dueDate <= until)
  const expiredQuotes = preferences.dailyDueAlertsEnabled ? quotes.filter((quote) => quote.status === 'open' && quote.validUntil && quote.validUntil < today) : []
  const lowStockProducts = preferences.lowStockAlertsEnabled ? products.filter((product) => product.active !== false && Number(product.quantity) <= Number(product.minStock)) : []
  const lowStockMaterials = preferences.lowStockAlertsEnabled ? materials.filter((material) => material.active !== false && Number(material.stockQuantity) <= Number(material.minStock)) : []
  const lowStockCount = lowStockProducts.length + lowStockMaterials.length
  const routes = {
    overdue: '/admin/producao?alert=overdue',
    dueSoon: '/admin/producao?alert=due-soon',
    quotes: '/admin/vendas?tab=quotes&alert=expired-quotes',
    stock: '/admin/estoque?alert=low-stock',
  }

  useEffect(() => {
    if (!user?.uid || !preferences.desktopNotificationsEnabled || (!overdueSales.length && !dueSoonSales.length && !expiredQuotes.length && !lowStockCount) || !('Notification' in window) || Notification.permission !== 'granted') return
    const key = `printcaju-daily-alerts-${user.uid}-${today}`
    try {
      if (localStorage.getItem(key)) return
      localStorage.setItem(key, 'sent')
      const notifications = [
        [overdueSales.length, 'Entregas atrasadas', `${overdueSales.length} pedido(s) passaram do prazo e ainda não foram entregues.`, routes.overdue],
        [dueSoonSales.length, 'Entrega em breve', `${dueSoonSales.length} pedido(s) devem ser entregues em até ${preferences.dueAlertDays} dia(s).`, routes.dueSoon],
        [expiredQuotes.length, 'Orçamentos vencidos', `${expiredQuotes.length} orçamento(s) venceram e ainda não viraram venda.`, routes.quotes],
        [lowStockCount, 'Estoque baixo', `${lowStockCount} produto(s) ou material(is) precisam de reposição.`, routes.stock],
      ]
      notifications.filter(([count]) => count).forEach(([, title, body, route]) => {
        const notification = new Notification(`Print Caju · ${title}`, { body, icon: '/printcaju-mark.png', tag: `printcaju-${title}` })
        notification.onclick = () => { window.focus(); window.location.href = route; notification.close() }
      })
    } catch (cause) { console.warn('Não foi possível exibir a notificação do navegador.', cause) }
  }, [user?.uid, today, overdueSales.length, dueSoonSales.length, expiredQuotes.length, lowStockCount, preferences.dueAlertDays, preferences.desktopNotificationsEnabled])

  if (!overdueSales.length && !dueSoonSales.length && !expiredQuotes.length && !lowStockCount) return null
  return <div className="daily-order-alert" role="status"><strong>Alertas</strong><div className="daily-alert-links">
    {overdueSales.length > 0 && <Link to={routes.overdue}>{overdueSales.length} entrega(s) atrasada(s) · Ver produção</Link>}
    {dueSoonSales.length > 0 && <Link to={routes.dueSoon}>{dueSoonSales.length} pedido(s) com entrega em até {preferences.dueAlertDays} dia(s) · Ver produção</Link>}
    {expiredQuotes.length > 0 && <Link to={routes.quotes}>{expiredQuotes.length} orçamento(s) vencido(s) · Ver orçamentos</Link>}
    {lowStockCount > 0 && <Link to={routes.stock}>{lowStockCount} item(ns) com estoque baixo · Ver estoque</Link>}
  </div></div>
}

const navigation = [
  { label: 'Dashboard', path: '/admin', glyph: '▦' },
  { label: 'Vendas externas', path: '/admin/vendas', glyph: '↗' },
  { label: 'Clientes', path: '/admin/clientes', glyph: '♧' },
  { label: 'Financeiro', path: '/admin/financeiro', glyph: '◉' },
  { label: 'Produtos', path: '/admin/produtos', glyph: '◇' },
  { label: 'Produção', path: '/admin/producao', glyph: '⚙' },
  { label: 'Estoque', path: '/admin/estoque', glyph: '▥' },
  { label: 'Site institucional', path: '/admin/site', glyph: '✳' },
  { label: 'Relatórios', path: '/admin/relatorios', glyph: '▧' },
  { label: 'Agenda e tarefas', path: '/admin/agenda', glyph: '◷' },
  { label: 'Configurações', path: '/admin/configuracoes', glyph: '⚙' },
]

function normalizeSearch(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim()
}

function GlobalNavigationSearch({ onNavigate, accountName }) {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { sales, error: salesError } = useExternalSales()
  const { products, error: productsError } = useProducts()
  const { clients, error: clientsError } = useClients()
  const { quotes, error: quotesError } = useQuotes()
  const { materials, error: materialsError } = useFinancialMaterials()
  const { transactions, error: transactionsError } = useFinancialTransactions()
  const { purchases, error: purchasesError } = usePurchases()
  const inputRef = useRef(null)
  const [query, setQuery] = useState('')
  const [focused, setFocused] = useState(false)
  const [activeIndex, setActiveIndex] = useState(0)
  const searchErrors = [salesError, productsError, clientsError, quotesError, materialsError, transactionsError, purchasesError].filter(Boolean)
  const matches = useMemo(() => {
    const term = normalizeSearch(query)
    const pages = navigation.map((item) => ({
      key: `page-${item.path}`,
      label: item.label,
      detail: item.path === '/' ? 'Página inicial' : item.path.replace('/', ''),
      path: item.path,
      glyph: item.glyph,
      kind: 'page',
      ...item,
      keywords: `${item.label} ${item.path.replace('/', ' ')} ${({
        '/': 'inicio painel principal',
        '/vendas': 'orçamento orcamento comprovante venda externa',
        '/clientes': 'consumidor cadastro contato cpf',
        '/financeiro': 'contas despesas receitas dinheiro',
        '/produtos': 'catalogo catálogo cadastrar sku',
        '/producao': 'fabricação fabricação fila imprimir',
        '/estoque': 'inventário material insumo quantidade',
        '/relatorios': 'relatório exportar excel resumo',
        '/agenda': 'tarefas calendário compromissos',
        '/configuracoes': 'configuração empresa perfil dados',
      })[item.path] || ''}`,
    }))
    if (!term) return pages.filter((item) => ['/', '/vendas', '/produtos', '/estoque'].includes(item.path)).slice(0, 6)

    const records = [
      ...sales.map((sale) => {
        const itemNames = (sale.items || []).map((item) => item.description).filter(Boolean).join(', ')
        const label = `${sale.client?.name || 'Cliente'} · Pedido #${sale.id.slice(0, 7).toUpperCase()}`
        return { key: `sale-${sale.id}`, label, detail: `Pedido/venda · ${itemNames || 'sem itens'} · ${sale.soldAt || ''}`, path: '/admin/vendas', glyph: '▤', kind: 'record', searchable: `${label} ${sale.id} ${sale.client?.phone || ''} ${sale.client?.email || ''} ${itemNames} ${sale.channel || ''}` }
      }),
      ...quotes.map((quote) => {
        const itemNames = (quote.items || []).map((item) => item.description).filter(Boolean).join(', ')
        const label = `${quote.client?.name || 'Cliente'} · ${quote.quoteNumber || `ORC-${quote.id.slice(0, 8).toUpperCase()}`}`
        return { key: `quote-${quote.id}`, label, detail: `Orçamento · ${itemNames || 'sem itens'} · ${quote.quoteDate || ''}`, path: '/admin/vendas', glyph: '▤', kind: 'record', searchable: `${label} ${quote.id} ${quote.client?.phone || ''} ${itemNames}` }
      }),
      ...products.map((product) => ({ key: `product-${product.id}`, label: product.name, detail: `Produto · ${product.sku || 'sem SKU'} · ${product.category || 'sem categoria'}`, path: '/admin/produtos', glyph: '◇', kind: 'record', searchable: `${product.name} ${product.sku || ''} ${product.category || ''} ${product.description || ''}` })),
      ...clients.map((client) => ({ key: `client-${client.id}`, label: client.name, detail: `Cliente · ${client.phone || client.email || client.taxId || 'cadastro'}`, path: '/admin/clientes', glyph: '♧', kind: 'record', searchable: `${client.name} ${client.phone || ''} ${client.email || ''} ${client.taxId || ''} ${client.city || ''}` })),
      ...materials.map((material) => ({ key: `material-${material.id}`, label: material.name, detail: `Material/insumo · estoque ${material.quantity ?? 0}`, path: '/admin/financeiro', glyph: '▥', kind: 'record', searchable: `${material.name} ${material.category || ''} ${material.unit || ''}` })),
      ...transactions.map((transaction) => ({ key: `transaction-${transaction.id}`, label: transaction.description || 'Lançamento financeiro', detail: `${transaction.type === 'income' ? 'Receita' : 'Despesa'} · ${transaction.category || 'sem categoria'} · ${transaction.date || ''}`, path: '/admin/financeiro', glyph: '◉', kind: 'record', searchable: `${transaction.description || ''} ${transaction.category || ''} ${transaction.notes || ''} ${transaction.sourcePurchaseId || ''}` })),
      ...purchases.map((purchase) => ({ key: `purchase-${purchase.id}`, label: purchase.productName || 'Compra', detail: `Histórico de compra · ${purchase.supplier || 'fornecedor não informado'} · ${purchase.date || ''}`, path: '/admin/financeiro', glyph: '＋', kind: 'record', searchable: `${purchase.productName || ''} ${purchase.supplier || ''} ${purchase.notes || ''} ${purchase.id}` })),
    ]
    if ([accountName, user?.displayName, user?.email].filter(Boolean).some((value) => normalizeSearch(value).includes(term))) {
      records.push({ key: 'current-user', label: accountName || user?.displayName || 'Usuário da conta', detail: `Usuário da conta · ${user?.email || ''}`, path: '/admin/configuracoes', glyph: '●', kind: 'record', searchable: `${accountName || ''} ${user?.displayName || ''} ${user?.email || ''}` })
    }
    const matchingRecords = records.filter((record) => normalizeSearch(record.searchable).includes(term))
      .sort((left, right) => Number(!normalizeSearch(left.label).startsWith(term)) - Number(!normalizeSearch(right.label).startsWith(term)))
      .slice(0, 8)
    const matchingPages = pages.filter((item) => normalizeSearch(item.keywords).includes(term)).slice(0, 3)
    return [...matchingRecords, ...matchingPages].slice(0, 10)
  }, [query, sales, products, clients, quotes, materials, transactions, purchases, accountName, user?.displayName, user?.email])

  useEffect(() => {
    setQuery('')
    setFocused(false)
    setActiveIndex(0)
  }, [location.pathname])

  useEffect(() => {
    function handleShortcut(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  function choosePage(page) {
    if (!page) return
    navigate(page.path)
    setQuery('')
    setFocused(false)
    onNavigate()
  }

  function handleKeyDown(event) {
    if (event.key === 'ArrowDown' && matches.length) {
      event.preventDefault()
      setActiveIndex((index) => (index + 1) % matches.length)
    } else if (event.key === 'ArrowUp' && matches.length) {
      event.preventDefault()
      setActiveIndex((index) => (index - 1 + matches.length) % matches.length)
    } else if (event.key === 'Enter' && matches.length) {
      event.preventDefault()
      choosePage(matches[activeIndex])
    } else if (event.key === 'Escape') {
      setFocused(false)
      inputRef.current?.blur()
    }
  }

  return <div className="global-search">
    <span className="global-search-icon" aria-hidden="true">⌕</span>
    <input
      ref={inputRef}
      type="search"
      role="combobox"
      aria-label="Buscar páginas, pedidos, produtos, clientes e lançamentos"
      aria-autocomplete="list"
      aria-expanded={focused && (matches.length > 0 || Boolean(query.trim()))}
      aria-controls="global-search-suggestions"
      aria-activedescendant={focused && matches[activeIndex] ? `global-search-option-${activeIndex}` : undefined}
      placeholder="Buscar pedidos, produtos, clientes..."
      value={query}
      onChange={(event) => { setQuery(event.target.value); setActiveIndex(0) }}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={handleKeyDown}
    />
    <kbd>Ctrl K</kbd>
    {focused && (matches.length > 0 || query.trim()) && <div className="global-search-suggestions" id="global-search-suggestions" role="listbox" aria-label="Resultados da busca">
      <div className="global-search-caption">{query.trim() ? 'Resultados e sugestões' : 'Acesso rápido'}</div>
      {searchErrors.length > 0 && <div className="global-search-warning" role="status">Alguns registros não puderam ser pesquisados. Verifique a conexão e as permissões do Firestore.</div>}
      {matches.length === 0 && <div className="global-search-no-results">Nenhum registro ou área encontrado.</div>}
      {matches.map((page, index) => <button
        id={`global-search-option-${index}`}
        key={page.key}
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        className={`global-search-option ${index === activeIndex ? 'global-search-option-active' : ''}`}
        onMouseEnter={() => setActiveIndex(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choosePage(page)}
      >
        <span className="global-search-option-icon" aria-hidden="true">{page.glyph}</span>
        <span><strong>{page.label}</strong><small>{page.detail || (page.path === '/' ? 'Página inicial' : page.path.replace('/', ''))}</small></span>
        <span className="global-search-enter" aria-hidden="true">↵</span>
      </button>)}
    </div>}
  </div>
}

export default function AdminLayout() {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const { user, signOut } = useAuth()
  const { preferences, profile } = usePreferences()
  const current = navigation.find((item) => item.path === location.pathname)?.label ?? 'Dashboard'
  const displayName = profile.displayName || user?.displayName || 'Administrador'

  return <div className="admin-shell">
    {menuOpen && <button className="mobile-scrim" aria-label="Fechar menu" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <Brand />
      <div className="sidebar-label">ESPAÇO DE TRABALHO</div>
      <nav className="side-nav" aria-label="Navegação principal">
        {navigation.map((item) => <NavLink key={item.path} to={item.path} end={item.path === '/admin'} className={({ isActive }) => `nav-item ${isActive ? 'nav-item-active' : ''}`} onClick={() => setMenuOpen(false)}>
          <span className="nav-glyph" aria-hidden="true">{item.glyph}</span>{item.label}{item.path === '/pedidos' && <span className="nav-shortcut">›</span>}
        </NavLink>)}
      </nav>
      <div className="sidebar-bottom"><div className="sidebar-user">
        <span className="user-avatar">{profile.photoURL ? <img src={profile.photoURL} alt="" /> : displayName.charAt(0).toUpperCase()}</span>
        <span className="user-meta"><strong>{displayName}</strong><small>{user?.email}</small></span>
      </div></div>
    </aside>
    <div className="main-column">
      <div className="floating-cajus" aria-hidden="true">
        <img className="floating-caju floating-caju-one" src="/printcaju-mark.png" alt="" />
        <img className="floating-caju floating-caju-two" src="/printcaju-mark.png" alt="" />
        <img className="floating-caju floating-caju-three" src="/printcaju-mark.png" alt="" />
        <img className="floating-caju floating-caju-four" src="/printcaju-mark.png" alt="" />
      </div>
      <header className="topbar">
        <button className="mobile-menu-button" onClick={() => setMenuOpen(true)} aria-label="Abrir menu">☰</button>
        <div className="topbar-heading"><span>{preferences.businessName || 'Print Caju'} Admin</span><h1>{current}</h1></div>
        <GlobalNavigationSearch accountName={displayName} onNavigate={() => setMenuOpen(false)} />
        <div className="topbar-actions"><span className="private-chip"><span />Área privada</span><Link className="icon-button settings-shortcut" aria-label="Configurações" to="/admin/configuracoes">⚙</Link><button className="button button-quiet signout-button" onClick={signOut}>Sair</button></div>
      </header>
      <main className="page-content"><DailySystemAlerts preferences={preferences} /><Outlet /></main>
      <footer className="app-footer">{preferences.businessName || 'Print Caju'} Admin <span>•</span> Ambiente privado</footer>
    </div>
  </div>
}
