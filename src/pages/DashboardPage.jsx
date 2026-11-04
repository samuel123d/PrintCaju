import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import useExternalSales from '../hooks/useExternalSales.js'
import useProducts from '../hooks/useProducts.js'
import useFinancialTransactions from '../hooks/useFinancialTransactions.js'
import usePreferences from '../hooks/usePreferences.js'
import { calculateFinancialControl } from '../services/finance/control.js'
import { calculateSalesGoalTotals } from '../services/sales/salesGoals.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { watchAgendaItems } from '../services/agenda/agenda.js'

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const formatDate = (value) => {
  if (!value) return 'Sem prazo'
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(year, month - 1, day))
}
const itemStatus = (item) => item.status || (item.completed ? 'completed' : 'open')

function FinanceCards({ sales, loading, error }) {
  const active = sales.filter((sale) => sale.status !== 'cancelled')
  const totals = [
    active.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0),
    active.reduce((sum, sale) => sum + (Number(sale.receivedAmount) || 0), 0),
    active.reduce((sum, sale) => sum + (Number(sale.fees) || 0), 0),
    active.reduce((sum, sale) => sum + (Number(sale.outstandingAmount) || 0), 0),
  ]
  const labels = [
    ['Faturamento bruto', 'Vendas externas ativas', '↗', 'purple'],
    ['Recebido', 'Valor recebido dos clientes', '↓', 'green'],
    ['Taxas de venda', 'Taxas informadas nos registros', '↙', 'orange'],
    ['A receber', 'Saldo pendente dos clientes', '◷', 'blue'],
  ]
  return <div className="metric-grid">{labels.map(([label, detail, icon, tone], index) => <article className="metric-card" key={label}><div className="metric-card-top"><span>{label}</span><span className={`metric-icon metric-${tone}`}>{icon}</span></div><strong className="metric-value">{loading ? '…' : error ? '—' : money(totals[index])}</strong><small>{error ? 'Falha ao carregar vendas' : loading ? 'Carregando registros…' : detail}</small></article>)}</div>
}

function SalesGoals({ sales, loading, error, preferences }) {
  const now = new Date()
  const { weekStart, weekEnd, yearKey, weeklySalesTotal, monthlySalesTotal, annualSalesTotal } = calculateSalesGoalTotals(sales, now)
  const periods = [
    { label: 'Esta semana', range: `${weekStart} a ${weekEnd}`, value: weeklySalesTotal, target: Number(preferences.weeklySalesGoal) || 0 },
    { label: 'Este mês', range: new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(now), value: monthlySalesTotal, target: Number(preferences.monthlySalesGoal) || 0 },
    { label: 'Este ano', range: yearKey, value: annualSalesTotal, target: Number(preferences.annualSalesGoal) || 0 },
  ]
  return <section className="panel dashboard-sales-goals" aria-labelledby="dashboard-goals-heading">
    <div className="panel-heading"><div><h2 id="dashboard-goals-heading">Metas de vendas</h2><p>Acompanhe as vendas acumuladas até hoje dentro de cada período.</p></div><Link className="text-link" to="/vendas">Gerenciar metas <span>→</span></Link></div>
    <div className="dashboard-goals-grid">{periods.map((period) => { const progress = period.target > 0 ? Math.min(100, period.value / period.target * 100) : 0; return <article className="dashboard-goal-card" key={period.label}>
      <div><span>{period.label}</span><small>{period.range}</small></div><strong>{loading ? '…' : error ? '—' : money(period.value)}</strong><small>{period.target > 0 ? `Meta ${money(period.target)}` : 'Meta não definida'}</small><div className="sales-goal-track" role="progressbar" aria-label={`Progresso da meta ${period.label.toLocaleLowerCase('pt-BR')}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div><small>{period.target > 0 ? `${Math.floor(progress)}% alcançado` : 'Defina a meta em Vendas'}</small>
    </article> })}</div>
  </section>
}

const monthKey = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`

function SalesAnalytics({ sales }) {
  const [clientQuery, setClientQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const active = sales.filter((sale) => sale.status !== 'cancelled')
  const filtered = active.filter((sale) => {
    const name = sale.client?.name || 'Cliente'
    return (!clientQuery || name.toLocaleLowerCase('pt-BR').includes(clientQuery.trim().toLocaleLowerCase('pt-BR')))
      && (!dateFrom || sale.soldAt >= dateFrom) && (!dateTo || sale.soldAt <= dateTo)
  })
  const now = new Date()
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 11 + index, 1)
    const key = monthKey(date)
    return { key, label: new Intl.DateTimeFormat('pt-BR', { month: 'short' }).format(date).replace('.', ''), count: filtered.filter((sale) => sale.soldAt?.startsWith(key)).length }
  })
  const maxMonth = Math.max(1, ...months.map((month) => month.count))
  const byClient = Object.values(filtered.reduce((groups, sale) => {
    const name = (sale.client?.name || 'Cliente sem nome').trim()
    groups[name] ||= { name, count: 0, total: 0 }
    groups[name].count += 1
    groups[name].total += Number(sale.total) || 0
    return groups
  }, {})).sort((a, b) => b.count - a.count)
  const topClients = byClient.slice(0, 5)
  const colors = ['#e48723', '#43864e', '#657db5', '#ba70a2', '#37a4a0']
  const all = filtered.length
  const plannedDays = filtered.filter((sale) => sale.soldAt && sale.dueDate).map((sale) => Math.max(0, (new Date(`${sale.dueDate}T00:00:00`) - new Date(`${sale.soldAt}T00:00:00`)) / 86400000))
  const averageDays = plannedDays.length ? plannedDays.reduce((sum, days) => sum + days, 0) / plannedDays.length : null
  const chartTotal = topClients.reduce((sum, client) => sum + client.count, 0)
  const circumference = 2 * Math.PI * 45
  return <section className="panel sales-analytics" aria-labelledby="sales-analytics-heading">
    <div className="panel-heading"><div><h2 id="sales-analytics-heading">Análise de vendas e clientes</h2><p>Compare meses, pedidos por cliente e prazo médio previsto de entrega.</p></div><span className="period-chip">{all} pedidos no filtro</span></div>
    <div className="sales-analytics-filters"><label>Buscar cliente<input type="search" value={clientQuery} onChange={(event) => setClientQuery(event.target.value)} placeholder="Digite o nome do cliente" /></label><label>De<input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label><label>Até<input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label><button type="button" className="button button-secondary" onClick={() => { setClientQuery(''); setDateFrom(''); setDateTo('') }}>Limpar filtros</button></div>
    <div className="sales-analytics-kpis"><article><small>Pedidos</small><strong>{all}</strong></article><article><small>Faturamento</small><strong>{money(filtered.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0))}</strong></article><article><small>Clientes únicos</small><strong>{byClient.length}</strong></article><article><small>Prazo previsto médio</small><strong>{averageDays === null ? '—' : `${averageDays.toFixed(1).replace('.', ',')} dias`}</strong></article></div>
    <div className="sales-analytics-charts"><article className="sales-analytics-chart"><h3>Pedidos por mês</h3><div className="sales-month-bars">{months.map((item) => {
      const [year, month] = item.key.split('-').map(Number)
      const from = `${item.key}-01`
      const to = `${item.key}-${String(new Date(year, month, 0).getDate()).padStart(2, '0')}`
      const selected = dateFrom === from && dateTo === to
      return <button type="button" key={item.key} className={`sales-month-bar${selected ? ' is-selected' : ''}`} aria-pressed={selected} title={`${item.label}/${item.key.slice(0,4)}: ${item.count} pedidos. Clique para filtrar este m?s.`} onClick={() => { if (selected) { setDateFrom(''); setDateTo('') } else { setDateFrom(from); setDateTo(to) } }}><span><i style={{ height: `${item.count ? Math.max(5, item.count / maxMonth * 100) : 2}%` }} /></span><small>{item.label}</small></button>
    })}</div></article>
      <article className="sales-analytics-chart"><h3>Pedidos por cliente</h3>{topClients.length ? <div className="sales-client-chart"><div className="sales-client-donut" role="img" aria-label={`Gr?fico interativo: ${chartTotal} pedidos entre os cinco principais clientes`}><svg viewBox="0 0 120 120" aria-label="Selecione uma fatia para filtrar por cliente">{topClients.map((client, index) => {
        const segment = chartTotal ? client.count / chartTotal * circumference : 0
        const offset = topClients.slice(0, index).reduce((sum, item) => sum + (chartTotal ? item.count / chartTotal * circumference : 0), 0)
        const selected = clientQuery.trim().toLocaleLowerCase('pt-BR') === client.name.toLocaleLowerCase('pt-BR')
        return <circle key={client.name} cx="60" cy="60" r="45" fill="none" stroke={colors[index % colors.length]} strokeWidth="25" strokeDasharray={`${segment} ${circumference - segment}`} strokeDashoffset={-offset} transform="rotate(-90 60 60)" className={selected ? 'is-selected' : ''} role="button" tabIndex="0" aria-label={`${client.name}: ${client.count} pedidos. Clique para filtrar.`} aria-pressed={selected} onClick={() => setClientQuery(selected ? '' : client.name)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setClientQuery(selected ? '' : client.name) } }} />
      })}</svg><span>{chartTotal}<small>top pedidos</small></span></div><div className="sales-client-legend">{topClients.map((client, index) => <button type="button" key={client.name} className="sales-client-legend-item" aria-pressed={clientQuery.trim().toLocaleLowerCase('pt-BR') === client.name.toLocaleLowerCase('pt-BR')} title={`Filtrar por ${client.name}`} onClick={() => setClientQuery(clientQuery.trim().toLocaleLowerCase('pt-BR') === client.name.toLocaleLowerCase('pt-BR') ? '' : client.name)}><i style={{ background: colors[index % colors.length] }} /><span>{client.name}</span><strong>{client.count}</strong></button>)}{byClient.length > 5 && <small>Exibindo 5 de {byClient.length} clientes</small>}</div></div> : <div className="dashboard-empty-small">Nenhuma venda para os filtros selecionados.</div>}</article></div>
  </section>
}

export default function DashboardPage() {
  const { sales, loading: salesLoading, error: salesError } = useExternalSales()
  const { products, loading: productsLoading } = useProducts()
  const { transactions, loading: financeLoading, error: financeError } = useFinancialTransactions()
  const { preferences } = usePreferences()
  const { workspaceUid } = useAuth()
  const [agendaItems, setAgendaItems] = useState([])
  const [agendaLoading, setAgendaLoading] = useState(true)
  const now = new Date()
  const today = dateKey(now)
  const [period, setPeriod] = useState('all')
  const month = period === 'all' ? null : period

  useEffect(() => {
    if (!workspaceUid) { setAgendaItems([]); setAgendaLoading(false); return undefined }
    setAgendaLoading(true)
    return watchAgendaItems(workspaceUid, (rows) => { setAgendaItems(rows); setAgendaLoading(false) }, () => { setAgendaItems([]); setAgendaLoading(false) })
  }, [workspaceUid])

  const activeSales = sales.filter((sale) => sale.status !== 'cancelled')
  const lateOrders = activeSales.filter((sale) => sale.dueDate && sale.dueDate < today && sale.deliveryStatus !== 'delivered' && sale.productionStatus !== 'ready')
  const lowStock = products.filter((product) => product.active !== false && Number(product.quantity) <= Number(product.minStock))
  const unfinishedAgenda = agendaItems.filter((item) => ['open', 'in_progress'].includes(itemStatus(item)))
  const financialControl = calculateFinancialControl({ sales, transactions, products, month })
  const agendaSoon = useMemo(() => unfinishedAgenda.filter((item) => item.date >= today).sort((a, b) => `${a.date}T${a.time || ''}`.localeCompare(`${b.date}T${b.time || ''}`)).slice(0, 5), [unfinishedAgenda, today])
  const recentSales = useMemo(() => [...activeSales].sort((a, b) => (b.soldAt || '').localeCompare(a.soldAt || '')).slice(0, 5), [activeSales])
  const monthLabel = month ? new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1)) : 'Todo o período'

  return <div className="page-stack dashboard-page">
    <section className="welcome-banner">
      <div><p className="eyebrow">VISÃO GERAL</p><h2>Seu negócio, em um só lugar.</h2><p>Acompanhe vendas, pedidos, estoque, agenda e resultados financeiros da Print Caju.</p></div>
      <img className="banner-mark" src="/printcaju-mark.png" alt="Caju, símbolo da Print Caju" />
    </section>

    <section aria-labelledby="finance-heading">
      <div className="section-heading dashboard-period-heading"><div><h2 id="finance-heading">Resumo das vendas externas</h2><p>Visão consolidada dos registros persistidos no Firestore</p></div><div className="dashboard-period-controls"><label>Período<select value={period === 'all' ? 'all' : 'month'} onChange={(event) => setPeriod(event.target.value === 'all' ? 'all' : today.slice(0, 7))}><option value="all">Todo o período</option><option value="month">Selecionar mês</option></select></label>{period !== 'all' && <label>Mês<input type="month" value={period} onChange={(event) => setPeriod(event.target.value)} /></label>}<Link className="period-chip dashboard-period-link" to="/vendas">Ver vendas ↗</Link></div></div>
      <FinanceCards sales={sales} loading={salesLoading} error={salesError} />
    </section>

    <SalesGoals sales={sales} loading={salesLoading} error={salesError} preferences={preferences} />
    {salesLoading ? <section className="panel sales-analytics"><div className="dashboard-loading">Carregando análise de vendas…</div></section> : <SalesAnalytics sales={sales} />}

    <section aria-labelledby="operation-heading">
      <div className="section-heading"><div><h2 id="operation-heading">Visão da operação</h2><p>O que precisa de atenção hoje</p></div><span className="period-chip">Atualizado em tempo real</span></div>
      <div className="dashboard-operation-grid">
        <Link to="/vendas" className="dashboard-operation-card"><span className="dashboard-operation-icon dashboard-tone-blue">▤</span><span><small>Vendas externas</small><strong>{salesLoading ? '…' : activeSales.length}</strong><em>{lateOrders.length ? `${lateOrders.length} atrasado(s)` : 'Nenhum atraso'}</em></span></Link>
        <Link to="/estoque" className="dashboard-operation-card"><span className="dashboard-operation-icon dashboard-tone-orange">▦</span><span><small>Estoque baixo</small><strong>{productsLoading ? '…' : lowStock.length}</strong><em>{lowStock.length ? 'Produto(s) precisam de reposição' : 'Tudo dentro do mínimo'}</em></span></Link>
        <Link to="/agenda" className="dashboard-operation-card"><span className="dashboard-operation-icon dashboard-tone-purple">◷</span><span><small>Tarefas em aberto</small><strong>{agendaLoading ? '…' : unfinishedAgenda.length}</strong><em>{agendaItems.filter((item) => itemStatus(item) === 'in_progress').length} em andamento</em></span></Link>
        <Link to="/financeiro" className="dashboard-operation-card"><span className="dashboard-operation-icon dashboard-tone-green">R$</span><span><small>Saldo livre do período</small><strong>{financeLoading || salesLoading ? '…' : financeError || salesError ? '—' : money(financialControl.freeCash)}</strong><em>{monthLabel}</em></span></Link>
      </div>
    </section>

    <section className="panel dashboard-cash-control" aria-labelledby="cash-control-heading">
      <div className="panel-heading"><div><h2 id="cash-control-heading">Controle de finanças</h2><p>Referência do caixa para decidir quanto separar e quanto pode ficar livre · {monthLabel}</p></div><Link className="text-link" to="/financeiro">Ver detalhes <span>→</span></Link></div>
      <div className="dashboard-cash-metrics">
        <div><small>Destinado à reposição</small><strong>{financeLoading || salesLoading ? '…' : financeError || salesError ? '—' : money(financialControl.replenishment)}</strong><em>Despesas e taxas registradas</em></div>
        <div><small>Lucro operacional de caixa</small><strong>{financeLoading || salesLoading ? '…' : financeError || salesError ? '—' : money(financialControl.operatingResult)}</strong><em>Entradas menos despesas e taxas; sem aportes</em></div>
        <div><small>Disponível para gastar</small><strong>{financeLoading || salesLoading ? '…' : financeError || salesError ? '—' : money(financialControl.freeCash)}</strong><em>{financeError || salesError ? 'Falha ao carregar os dados financeiros' : financialControl.freeCash < 0 ? 'Caixa abaixo das saídas registradas' : 'Caixa após separar a reposição; inclui aportes'}</em></div>
      </div>
      <p className="dashboard-cash-note">Estimativa baseada nos registros de {monthLabel.toLocaleLowerCase('pt-BR')}; não representa o saldo bancário e não inclui saldo inicial não lançado. Sem histórico das parcelas, recebimentos são atribuídos ao mês da venda.</p>
    </section>

    <section className="panel orders-summary dashboard-recent-panel">
        <div className="panel-heading"><div><h2>Vendas recentes</h2><p>Últimos registros ativos</p></div><Link className="text-link" to="/vendas">Ver todas <span>→</span></Link></div>
        {salesLoading ? <div className="dashboard-loading">Carregando vendas…</div> : recentSales.length ? <div className="dashboard-recent-list">{recentSales.map((sale) => <div className="dashboard-recent-row" key={sale.id}><span className="dashboard-recent-avatar">{(sale.client?.name || 'C').charAt(0).toUpperCase()}</span><span className="dashboard-recent-copy"><strong>{sale.client?.name || 'Cliente'}</strong><small>{sale.soldAt ? formatDate(sale.soldAt) : 'Data não informada'} · {sale.deliveryStatus === 'delivered' ? 'Entregue' : 'Em andamento'}</small></span><b>{money(sale.total)}</b></div>)}</div> : <div className="dashboard-empty-small">Ainda não há vendas registradas.</div>}
    </section>

    <section className="panel dashboard-agenda-panel">
      <div className="panel-heading"><div><h2>Próximas tarefas e reuniões</h2><p>Compromissos em aberto e em andamento</p></div><Link className="text-link" to="/agenda">Abrir agenda <span>→</span></Link></div>
      {agendaLoading ? <div className="dashboard-loading">Carregando agenda…</div> : agendaSoon.length ? <div className="dashboard-upcoming-list">{agendaSoon.map((item) => <div className="dashboard-upcoming-row" key={item.id}><span className="dashboard-upcoming-date"><strong>{formatDate(item.date)}</strong><small>{item.time || 'Dia todo'}</small></span><span className="dashboard-upcoming-copy"><strong>{item.title}</strong><small>{item.type === 'meeting' ? 'Reunião' : item.type === 'reminder' ? 'Lembrete' : 'Tarefa'} · {itemStatus(item) === 'in_progress' ? 'Em andamento' : 'Em aberto'}</small></span><span className="dashboard-upcoming-status">{itemStatus(item) === 'in_progress' ? 'Em andamento' : 'Em aberto'}</span></div>)}</div> : <div className="dashboard-empty-small">Nenhum compromisso futuro em aberto. <Link to="/agenda">Adicionar à agenda</Link></div>}
    </section>

    <section className="quick-links dashboard-quick-links">
      <div><span className="quick-link-icon">＋</span><span><strong>Acesso rápido</strong><small>Abra uma área para continuar trabalhando</small></span></div>
      <div className="dashboard-quick-actions"><Link to="/vendas" className="text-link">Registrar venda <span>→</span></Link><Link to="/produtos" className="text-link">Ver produtos <span>→</span></Link><Link to="/agenda" className="text-link">Nova tarefa <span>→</span></Link></div>
    </section>
  </div>
}
