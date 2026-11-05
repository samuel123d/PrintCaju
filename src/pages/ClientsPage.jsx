import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import useClients from '../hooks/useClients.js'
import useExternalSales from '../hooks/useExternalSales.js'
import useQuotes from '../hooks/useQuotes.js'
import { deleteClient, saveClient } from '../services/clients/clients.js'
import { createCustomerRegistrationFormLink } from '../services/sales/externalSales.js'
import { formatBrazilianPhone, formatBrazilianTaxId } from '../utils/inputMasks.js'

const emptyClient = () => ({ name: '', taxId: '', phone: '', email: '', address: '', city: '', state: '', postalCode: '' })
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
const dateLabel = (value) => {
  if (!value) return '—'
  const date = value?.toDate ? value.toDate() : new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(date)
}
const normalize = (value) => String(value || '').trim().toLocaleLowerCase('pt-BR')
const onlyDigits = (value) => String(value || '').replace(/\D/g, '')
function saleStatus(sale) {
  if (sale.status === 'cancelled') return { label: 'Cancelado', className: 'delivery-shipped' }
  if (sale.deliveryStatus === 'delivered') return { label: 'Entregue', className: 'delivery-delivered' }
  if (sale.deliveryStatus === 'shipped') return { label: 'Enviado', className: 'delivery-shipped' }
  if (sale.deliveryStatus === 'pickup') return { label: 'Retirada', className: 'delivery-pickup' }
  if (sale.deliveryStatus === 'ready') return { label: 'Pronto', className: 'delivery-ready' }
  if (sale.productionStatus === 'ready') return { label: 'Produção concluída', className: 'payment-paid' }
  if (sale.productionStatus === 'producing') return { label: 'Em produção', className: 'delivery-preparing' }
  if (sale.productionStatus === 'preparing' || sale.deliveryStatus === 'preparing') return { label: 'Em preparo', className: 'delivery-preparing' }
  return { label: 'A combinar', className: 'delivery-pending' }
}

export default function ClientsPage() {
  const { workspaceUid } = useAuth()
  const { clients, loading, error } = useClients()
  const { sales, loading: salesLoading, error: salesError } = useExternalSales()
  const { quotes, loading: quotesLoading, error: quotesError } = useQuotes()
  const [form, setForm] = useState(emptyClient)
  const [editingId, setEditingId] = useState('')
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [deletingId, setDeletingId] = useState('')
  const [formLinkMessage, setFormLinkMessage] = useState('')
  const [formLinkError, setFormLinkError] = useState('')
  const [registrationLink, setRegistrationLink] = useState('')
  const [creatingFormLink, setCreatingFormLink] = useState(false)
  const [selectedClient, setSelectedClient] = useState(null)
  const filteredClients = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-BR')
    return clients.filter((client) => !term || [client.name, client.taxId, client.phone, client.email]
      .some((value) => String(value || '').toLocaleLowerCase('pt-BR').includes(term)))
  }, [clients, search])
  const clientSales = useMemo(() => {
    if (!selectedClient) return []
    const matchByLegacyDetails = (record) => {
      if (record.clientId) return false
      const saved = record.client || {}
      return (selectedClient.taxId && onlyDigits(saved.taxId) === onlyDigits(selectedClient.taxId))
        || (selectedClient.phone && onlyDigits(saved.phone) === onlyDigits(selectedClient.phone))
        || (selectedClient.email && normalize(saved.email) === normalize(selectedClient.email))
        || normalize(saved.name) === normalize(selectedClient.name)
    }
    return sales.filter((sale) => sale.clientId === selectedClient.id || matchByLegacyDetails(sale))
      .sort((left, right) => String(right.soldAt || '').localeCompare(String(left.soldAt || '')))
  }, [sales, selectedClient])
  const clientQuotes = useMemo(() => {
    if (!selectedClient) return []
    const matchByLegacyDetails = (record) => {
      if (record.clientId) return false
      const saved = record.client || {}
      return (selectedClient.taxId && onlyDigits(saved.taxId) === onlyDigits(selectedClient.taxId))
        || (selectedClient.phone && onlyDigits(saved.phone) === onlyDigits(selectedClient.phone))
        || (selectedClient.email && normalize(saved.email) === normalize(selectedClient.email))
        || normalize(saved.name) === normalize(selectedClient.name)
    }
    return quotes.filter((quote) => quote.clientId === selectedClient.id || matchByLegacyDetails(quote))
      .sort((left, right) => String(right.quoteDate || '').localeCompare(String(left.quoteDate || '')))
  }, [quotes, selectedClient])

  async function copyCustomerRegistrationLink() {
    setFormLinkMessage('')
    setFormLinkError('')
    setCreatingFormLink(true)
    try {
      if (!workspaceUid) throw new Error('Não foi possível identificar o espaço de trabalho.')
      const token = await createCustomerRegistrationFormLink(workspaceUid)
      const link = `${window.location.origin}/formulario-cliente/${token}`
      setRegistrationLink(link)
      try {
        await navigator.clipboard.writeText(link)
        setFormLinkMessage('Link seguro do formulário copiado. Envie ao cliente pelo WhatsApp ou e-mail.')
      } catch {
        setFormLinkMessage('O link foi gerado. Se não foi copiado automaticamente, abra o formulário e copie o endereço.')
      }
    } catch (cause) {
      setFormLinkError(cause.message || 'Não foi possível gerar o formulário de cadastro.')
    } finally {
      setCreatingFormLink(false)
    }
  }

  function resetForm() {
    setForm(emptyClient())
    setEditingId('')
    setSaveError('')
  }

  function editClient(client) {
    setEditingId(client.id)
    setSelectedClient(client)
    setForm({
      name: client.name || '',
      taxId: formatBrazilianTaxId(client.taxId),
      phone: formatBrazilianPhone(client.phone),
      email: client.email || '',
      address: client.address || '',
      city: client.city || '',
      state: client.state || '',
      postalCode: client.postalCode || '',
    })
    setMessage('')
    setSaveError('')
  }

  async function submit(event) {
    event.preventDefault()
    setMessage('')
    setSaveError('')
    if (!form.name.trim()) return setSaveError('Informe o nome do cliente.')
    setSaving(true)
    try {
      await saveClient(workspaceUid, form, editingId)
      setMessage(editingId ? 'Cliente atualizado.' : 'Cliente cadastrado.')
      resetForm()
    } catch (cause) {
      setSaveError(cause.code === 'permission-denied'
        ? 'O Firestore bloqueou o cadastro. Confira as regras publicadas.'
        : cause.message || 'Não foi possível salvar o cliente.')
    } finally {
      setSaving(false)
    }
  }

  async function removeClient(client) {
    const confirmed = window.confirm(`Excluir o cadastro de ${client.name}? Os registros anteriores de vendas e orçamentos serão mantidos, mas o cliente deixará de aparecer na lista.`)
    if (!confirmed) return
    setSaveError('')
    setMessage('')
    setDeletingId(client.id)
    try {
      await deleteClient(workspaceUid, client.id)
      if (selectedClient?.id === client.id) setSelectedClient(null)
      if (editingId === client.id) resetForm()
      setMessage(`Cadastro de ${client.name} excluído. O histórico comercial foi preservado.`)
    } catch (cause) {
      setSaveError(cause.code === 'permission-denied'
        ? 'O Firestore bloqueou a exclusão. Confira as regras publicadas.'
        : cause.message || 'Não foi possível excluir o cliente.')
    } finally {
      setDeletingId('')
    }
  }

  return <div className="page-stack">
    <div className="page-intro"><div><p className="eyebrow">RELACIONAMENTO</p><h2>Clientes</h2><p>Gere um link seguro para o cliente preencher o cadastro, que será salvo no sistema e poderá ser associado à conta dele após confirmar o e-mail.</p></div><div className="client-form-link-actions"><button type="button" className="button button-primary" disabled={creatingFormLink} onClick={copyCustomerRegistrationLink}>{creatingFormLink ? 'Gerando link…' : registrationLink ? 'Gerar novo link' : 'Gerar e copiar formulário'}</button>{registrationLink && <a className="button button-secondary" href={registrationLink} target="_blank" rel="noreferrer">Abrir formulário</a>}</div></div>
    {formLinkMessage && <div className="alert alert-success" role="status">{formLinkMessage} {registrationLink && <a href={registrationLink} target="_blank" rel="noreferrer">Abrir formulário</a>}</div>}
    {formLinkError && <div className="alert alert-error" role="alert">{formLinkError}</div>}
    {(error || saveError) && <div className="sales-error" role="alert">{saveError || error}</div>}
    {message && <div className="alert alert-success" role="status">{message}</div>}
    <section className="panel finance-entry-panel">
      <header className="finance-section-heading"><div><p className="eyebrow">CADASTRO</p><h3>{editingId ? 'Editar cliente' : 'Adicionar cliente'}</h3><p>Clientes informados em uma venda ou orçamento também são salvos automaticamente.</p></div></header>
      <form className="finance-form clients-form" onSubmit={submit}>
        <label>Nome completo <b>*</b><input required maxLength={120} value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>CPF/CNPJ<input inputMode="numeric" maxLength={18} placeholder="000.000.000-00" value={formatBrazilianTaxId(form.taxId)} onChange={(event) => setForm((current) => ({ ...current, taxId: formatBrazilianTaxId(event.target.value) }))} /></label>
        <label>Telefone<input type="tel" inputMode="tel" maxLength={16} placeholder="(00) 00000-0000" value={formatBrazilianPhone(form.phone)} onChange={(event) => setForm((current) => ({ ...current, phone: formatBrazilianPhone(event.target.value) }))} /></label>
        <label>E-mail<input type="email" maxLength={160} value={form.email} onChange={(event) => setForm((current) => ({ ...current, email: event.target.value }))} /></label>
        <label className="finance-description-field">Endereço<input maxLength={180} value={form.address} onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))} /></label>
        <label>Cidade<input maxLength={80} value={form.city} onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))} /></label>
        <label>Estado<input maxLength={2} value={form.state} onChange={(event) => setForm((current) => ({ ...current, state: event.target.value.toUpperCase() }))} placeholder="UF" /></label>
        <label>CEP<input maxLength={10} value={form.postalCode} onChange={(event) => setForm((current) => ({ ...current, postalCode: event.target.value }))} /></label>
        <div className="finance-form-actions">{editingId && <button type="button" className="button button-secondary" onClick={resetForm}>Cancelar</button>}<button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Salvar cliente'}</button></div>
      </form>
    </section>
    <section className="panel finance-ledger-panel">
      <header className="finance-section-heading finance-ledger-heading"><div><p className="eyebrow">CADASTRADOS</p><h3>Lista de clientes</h3></div><span className="count-chip">{filteredClients.length} clientes</span></header>
      <div className="products-toolbar"><label className="search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, CPF, telefone ou e-mail" /></label></div>
      {loading ? <div className="sales-loading">Carregando clientes…</div> : filteredClients.length === 0 ? <div className="finance-empty"><strong>Nenhum cliente cadastrado</strong><small>Gere o link acima para o cliente preencher o cadastro, ou cadastre aqui manualmente.</small></div> : <div className="finance-table-scroll"><table className="finance-table clients-table"><thead><tr><th>Cliente</th><th>CPF/CNPJ</th><th>Telefone</th><th>E-mail</th><th>Localização</th><th>Ação</th></tr></thead><tbody>{filteredClients.map((client) => <tr key={client.id} className={selectedClient?.id === client.id ? 'client-selected-row' : ''}><td><button type="button" className="client-name-button" onClick={() => setSelectedClient(client)}>{client.name}</button></td><td>{client.taxId || '—'}</td><td>{client.phone || '—'}</td><td>{client.email || '—'}</td><td>{[client.city, client.state].filter(Boolean).join(' / ') || '—'}</td><td><div className="sale-actions"><button type="button" onClick={() => setSelectedClient(client)}>Histórico</button><button type="button" onClick={() => editClient(client)}>Editar</button><button type="button" className="cancel-action" disabled={deletingId === client.id} onClick={() => removeClient(client)}>{deletingId === client.id ? 'Excluindo…' : 'Excluir'}</button></div></td></tr>)}</tbody></table></div>}
    </section>
    {selectedClient && <section id="client-orders-form-links" className="panel client-history-panel">
      <header className="finance-section-heading"><div><p className="eyebrow">HISTÓRICO DO CLIENTE</p><h3>{selectedClient.name}</h3><p>Pedidos, vendas e orçamentos vinculados a este cliente.</p></div><button type="button" className="button button-secondary" onClick={() => setSelectedClient(null)}>Fechar</button></header>
      {(salesError || quotesError) && <div className="sales-error" role="alert">{salesError || quotesError}</div>}
      {salesLoading || quotesLoading ? <div className="sales-loading">Carregando histórico…</div> : <>
        <div className="client-history-summary"><span>{clientSales.length} pedidos/vendas</span><span>{clientQuotes.length} orçamentos</span><span>{clientSales.filter((sale) => sale.status !== 'cancelled' && sale.deliveryStatus !== 'delivered').length} em andamento</span></div>
        <h4 className="client-history-subheading">Pedidos e vendas</h4>
        {clientSales.length ? <div className="finance-table-scroll"><table className="finance-table client-history-table"><thead><tr><th>Pedido</th><th>Data</th><th>Itens</th><th>Entrega / status</th><th>Pagamento</th><th>Total</th></tr></thead><tbody>{clientSales.map((sale) => <tr key={sale.id}><td><strong>#{sale.id.slice(0, 7).toUpperCase()}</strong></td><td>{dateLabel(sale.soldAt)}</td><td>{(sale.items || []).map((item) => `${item.description} × ${item.quantity}`).join(', ') || '—'}</td><td><span className={`status-pill ${saleStatus(sale).className}`}>{saleStatus(sale).label}</span></td><td>{sale.status === 'cancelled' ? 'Venda cancelada' : sale.paymentStatus === 'paid' ? 'Pago' : sale.paymentStatus === 'partial' ? 'Parcial' : 'Pendente'}</td><td>{money(sale.total)}</td></tr>)}</tbody></table></div> : <p className="client-history-empty">Nenhum pedido ou venda encontrado para este cliente.</p>}
        <h4 className="client-history-subheading">Orçamentos</h4>
        {clientQuotes.length ? <div className="finance-table-scroll"><table className="finance-table client-history-table"><thead><tr><th>Orçamento</th><th>Emissão</th><th>Validade</th><th>Status</th><th>Total</th></tr></thead><tbody>{clientQuotes.map((quote) => <tr key={quote.id}><td><strong>{quote.quoteNumber || `ORC-${quote.id.slice(0, 8).toUpperCase()}`}</strong></td><td>{dateLabel(quote.quoteDate)}</td><td>{dateLabel(quote.validUntil)}</td><td>{quote.status === 'converted' ? 'Convertido em venda' : quote.status === 'cancelled' ? 'Cancelado' : quote.status === 'open' && quote.validUntil && quote.validUntil < new Date().toISOString().slice(0, 10) ? 'Vencido' : 'Aberto'}</td><td>{money(quote.total)}</td></tr>)}</tbody></table></div> : <p className="client-history-empty">Nenhum orçamento encontrado para este cliente.</p>}
      </>}
      <div className="client-history-link"><Link className="button button-secondary" to="/admin/vendas">Abrir histórico comercial completo</Link></div>
    </section>}
  </div>
}
