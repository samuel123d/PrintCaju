import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import useBusinessDetails from '../hooks/useBusinessDetails.js'
import useClients from '../hooks/useClients.js'
import useExternalSales from '../hooks/useExternalSales.js'
import useProducts from '../hooks/useProducts.js'
import useQuotes from '../hooks/useQuotes.js'
import usePreferences from '../hooks/usePreferences.js'
import { approveWebsiteOrder, cancelExternalSale, cancelQuote, convertQuoteToSale, createExternalSale, createQuote, deleteExternalSale, deleteQuote, restoreConvertedQuoteSale, updateExternalSale, updateQuote } from '../services/sales/externalSales.js'
import { saveClient } from '../services/clients/clients.js'
import { printSalesDocument } from '../services/sales/printDocument.js'
import { formatBrazilianPhone, formatBrazilianTaxId } from '../utils/inputMasks.js'
import { savePreferences } from '../services/settings/settings.js'
import { calculateSalesGoalTotals } from '../services/sales/salesGoals.js'

const channelLabels = { whatsapp: 'WhatsApp', instagram: 'Instagram', mercadolivre: 'Mercado Livre (manual)', presencial: 'Presencial', website: 'Site institucional', outro: 'Outro' }
const paymentLabels = { pending: 'Pendente', partial: 'Parcial', paid: 'Recebido' }
const paymentMethodLabels = { dinheiro: 'Dinheiro', transferencia: 'Transferência', outro: 'Outro' }
const deliveryLabels = { pending: 'A combinar', preparing: 'Em preparação', ready: 'Pronto', shipped: 'Enviado', delivered: 'Entregue', pickup: 'Retirada' }
const emptyItem = () => ({ productId: '', description: '', quantity: '1', unitPrice: '' })

function localToday() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function datePlusDays(days) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function emptyForm() {
  return {
    clientName: '', taxId: '', phone: '', email: '', channel: 'whatsapp', soldAt: localToday(), validUntil: datePlusDays(7),
    deliveryMethod: 'delivery', address: '', city: '', state: '', postalCode: '',
    items: [emptyItem()], discount: '0', fees: '0', extraAmount: '0', receivedAmount: '0',
    deliveryStatus: 'pending', dueDate: '', orderType: 'physical', productionStatus: 'not_started', paymentMethod: 'dinheiro', notes: '',
  }
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
}

function amount(value) {
  return Number.parseFloat(String(value ?? '0').replace(',', '.')) || 0
}

function dateLabel(value) {
  if (!value) return '—'
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR').format(new Date(year, month - 1, day))
}

const needsProductionOrDelivery = (sale) => sale.deliveryStatus !== 'delivered' && sale.productionStatus !== 'ready'

function dateTimeLabel(value) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : null
  return date && !Number.isNaN(date.getTime())
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : '—'
}

function paymentStatus(total, received) {
  if (received <= 0) return 'pending'
  if (received + 0.005 >= total) return 'paid'
  return 'partial'
}

function formFromSale(sale) {
  return {
    clientName: sale.client?.name ?? '', taxId: formatBrazilianTaxId(sale.client?.taxId), phone: formatBrazilianPhone(sale.client?.phone), email: sale.client?.email ?? '',
    channel: sale.channel ?? 'whatsapp', soldAt: sale.soldAt ?? localToday(),
    deliveryMethod: sale.deliveryMethod ?? 'delivery', address: sale.delivery?.address ?? '',
    city: sale.delivery?.city ?? '', state: sale.delivery?.state ?? '', postalCode: sale.delivery?.postalCode ?? '',
    items: (sale.items ?? []).map((item) => ({ productId: item.productId ?? '', description: item.description, quantity: String(item.quantity), unitPrice: String(item.unitPrice) })),
    discount: String(sale.discount ?? 0), fees: String(sale.fees ?? 0), extraAmount: String(sale.extraAmount ?? 0), receivedAmount: String(sale.receivedAmount ?? 0),
    deliveryStatus: sale.deliveryStatus ?? 'pending', dueDate: sale.dueDate ?? '', orderType: sale.orderType ?? 'physical', productionStatus: sale.productionStatus ?? (sale.deliveryStatus === 'preparing' ? 'preparing' : 'not_started'), paymentMethod: ['dinheiro', 'transferencia', 'outro'].includes(sale.paymentMethod) ? sale.paymentMethod : 'dinheiro', notes: sale.notes ?? '',
  }
}

function formFromQuote(quote) {
  return {
    clientName: quote.client?.name ?? '', taxId: formatBrazilianTaxId(quote.client?.taxId), phone: formatBrazilianPhone(quote.client?.phone), email: quote.client?.email ?? '',
    channel: quote.channel ?? 'whatsapp', soldAt: quote.quoteDate ?? localToday(), validUntil: quote.validUntil ?? datePlusDays(7),
    deliveryMethod: quote.deliveryMethod ?? 'delivery', address: quote.delivery?.address ?? '',
    city: quote.delivery?.city ?? '', state: quote.delivery?.state ?? '', postalCode: quote.delivery?.postalCode ?? '',
    items: (quote.items ?? []).map((item) => ({ productId: item.productId ?? '', description: item.description, quantity: String(item.quantity), unitPrice: String(item.unitPrice) })),
    discount: String(quote.discount ?? 0), fees: String(quote.fees ?? 0), extraAmount: String(quote.extraAmount ?? 0), receivedAmount: '0',
    deliveryStatus: 'pending', dueDate: quote.dueDate ?? '', orderType: quote.orderType ?? 'physical',
    productionStatus: 'not_started', paymentMethod: 'dinheiro', notes: quote.notes ?? '',
  }
}

function firestoreErrorMessage(error) {
  if (error.code === 'permission-denied') return 'O Firestore recusou a operação. Confirme se as regras publicadas permitem acesso a clientes, vendas e orçamentos.'
  if (error.code === 'unavailable' || error.code === 'network-request-failed') return 'Sem conexão com o Firestore. Verifique sua internet e tente novamente.'
  return error.message || 'Não foi possível salvar a venda ou o orçamento. Revise os dados e tente novamente.'
}

function SaleForm({ sale, quote, mode, business, onClose, onSaved }) {
  const { user, workspaceUid } = useAuth()
  const { clients } = useClients()
  const { products } = useProducts()
  const isQuote = mode === 'quote'
  const [form, setForm] = useState(() => sale ? formFromSale(sale) : quote ? formFromQuote(quote) : emptyForm())
  const [selectedClientId, setSelectedClientId] = useState(sale?.clientId ?? quote?.clientId ?? '')
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const subtotal = form.items.reduce((sum, item) => sum + Math.max(0, amount(item.quantity)) * Math.max(0, amount(item.unitPrice)), 0)
  const discount = Math.max(0, amount(form.discount))
  const fees = Math.max(0, amount(form.fees))
  const extraAmount = Math.max(0, amount(form.extraAmount))
  const total = Math.max(0, subtotal - discount + extraAmount)
  const received = Math.max(0, amount(form.receivedAmount))
  const due = Math.max(0, total - received)

  function change(field, value) { setForm((current) => ({ ...current, [field]: value })) }
  function selectClient(clientId) {
    setSelectedClientId(clientId)
    const client = clients.find((item) => item.id === clientId)
    if (!client) return
    setForm((current) => ({
      ...current,
      clientName: client.name || '',
      taxId: formatBrazilianTaxId(client.taxId),
      phone: formatBrazilianPhone(client.phone),
      email: client.email || '',
      address: client.address || '',
      city: client.city || '',
      state: client.state || '',
      postalCode: client.postalCode || '',
    }))
  }
  function changeItem(index, field, value) {
    setForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) }))
  }
  function selectProduct(index, productId) {
    const product = products.find((item) => item.id === productId)
    setForm((current) => ({ ...current, items: current.items.map((item, itemIndex) => itemIndex === index
      ? product ? { ...item, productId, description: product.name, unitPrice: String(product.price ?? '') } : { ...item, productId: '' }
      : item) }))
  }

  async function submit(event) {
    event.preventDefault()
    setFormError('')
    if (!form.clientName.trim()) return setFormError('Informe o nome do cliente.')
    if (!form.soldAt) return setFormError(isQuote ? 'Informe a data do orçamento.' : 'Informe a data da venda.')
    if (isQuote && !form.validUntil) return setFormError('Informe até quando o orçamento será válido.')
    if (isQuote && form.validUntil < form.soldAt) return setFormError('A validade do orçamento não pode ser anterior à data de emissão.')
    if (!form.items.length || form.items.some((item) => !item.description.trim() || !Number.isFinite(Number(item.quantity)) || Number(item.quantity) < 1 || !Number.isFinite(amount(item.unitPrice)) || amount(item.unitPrice) < 0 || item.unitPrice === '')) {
      return setFormError('Preencha o produto, a quantidade e o valor unitário de cada item.')
    }
    if (![form.discount, form.fees, form.extraAmount, form.receivedAmount].every((value) => Number.isFinite(amount(value)) && amount(value) >= 0)) return setFormError('Desconto, taxas, valor extra e valor recebido precisam ser números iguais ou maiores que zero.')
    if (![subtotal, total].every(Number.isFinite)) return setFormError('O total calculado está fora do intervalo permitido. Revise as quantidades e os valores.')
    if (discount > subtotal) return setFormError('O desconto não pode ser maior que o subtotal.')
    if (total <= 0) return setFormError('O total da venda precisa ser maior que zero.')
    if (!isQuote && received > total) return setFormError('O valor recebido não pode ser maior que o total da venda.')
    if (form.deliveryMethod === 'delivery' && !form.address.trim() && !(sale && !sale.delivery?.address)) return setFormError('Informe o endereço para a entrega.')

    setSaving(true)
    try {
      const clientId = await saveClient(workspaceUid, {
        name: form.clientName,
        taxId: form.taxId,
        phone: form.phone,
        email: form.email,
        address: form.address,
        city: form.city,
        state: form.state,
        postalCode: form.postalCode,
      }, selectedClientId)
      const commonData = {
        clientId,
        channel: form.channel,
        client: { name: form.clientName.trim(), taxId: form.taxId.trim(), phone: form.phone.trim(), email: form.email.trim() },
        deliveryMethod: form.deliveryMethod,
        delivery: form.deliveryMethod === 'delivery'
          ? { address: form.address.trim(), city: form.city.trim(), state: form.state.trim().toUpperCase(), postalCode: form.postalCode.trim() }
          : null,
        items: form.items.map((item) => ({
          ...(item.productId ? { productId: item.productId } : {}),
          description: item.description.trim(),
          quantity: Number(item.quantity),
          unitPrice: amount(item.unitPrice),
          lineTotal: Number((Number(item.quantity) * amount(item.unitPrice)).toFixed(2)),
        })),
        subtotal: Number(subtotal.toFixed(2)),
        discount: Number(discount.toFixed(2)),
        fees: Number(fees.toFixed(2)),
        extraAmount: Number(extraAmount.toFixed(2)),
        total: Number(total.toFixed(2)),
        receivedAmount: Number(received.toFixed(2)),
        outstandingAmount: Number(due.toFixed(2)),
        estimatedNet: Number((total - fees).toFixed(2)),
        paymentStatus: paymentStatus(total, received),
        paymentMethod: form.paymentMethod,
        orderType: form.orderType,
        dueDate: form.dueDate,
        notes: form.notes.trim(),
        seller: business,
      }
      const quoteData = {
        ...commonData,
        quoteDate: form.soldAt,
        validUntil: form.validUntil,
        subtotal: Number(subtotal.toFixed(2)),
        discount: Number(discount.toFixed(2)),
        fees: Number(fees.toFixed(2)),
        total: Number(total.toFixed(2)),
      }
      const saleData = {
        ...commonData,
        soldAt: form.soldAt,
        productionStatus: form.productionStatus,
        deliveryStatus: form.deliveryStatus,
        receivedAmount: Number(received.toFixed(2)),
        outstandingAmount: Number(due.toFixed(2)),
        estimatedNet: Number((total - fees).toFixed(2)),
        paymentStatus: paymentStatus(total, received),
      }

      if (isQuote) {
        if (quote) {
          await updateQuote(workspaceUid, quote.id, quoteData)
          onSaved('Orçamento atualizado.')
        } else {
          await createQuote(workspaceUid, quoteData, user.uid)
          onSaved('Orçamento salvo. Gere a impressão na lista de orçamentos.')
        }
      } else if (quote) {
        await convertQuoteToSale(workspaceUid, quote.id, saleData, user.uid)
        onSaved('Orçamento convertido em venda. O comprovante está disponível no histórico.')
      } else if (sale) {
        await updateExternalSale(workspaceUid, sale.id, saleData)
        onSaved('Venda atualizada.')
      } else {
        await createExternalSale(workspaceUid, saleData, user.uid)
        onSaved('Venda registrada. Gere o comprovante pelo histórico.')
      }
    } catch (error) {
      setFormError(error.code ? firestoreErrorMessage(error) : error.message || 'Não foi possível salvar o cliente da venda.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="sale-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="sale-modal" role="dialog" aria-modal="true" aria-labelledby="sale-form-title">
        <header className="sale-modal-header">
          <div><p className="eyebrow">{isQuote ? 'ORÇAMENTO COMERCIAL' : 'VENDAS EXTERNAS'}</p><h2 id="sale-form-title">{isQuote ? quote ? 'Editar orçamento' : 'Novo orçamento' : sale ? 'Editar venda' : quote ? 'Converter orçamento em venda' : 'Registrar venda'}</h2><p>{!isQuote && quote ? 'Revise os valores e ajuste desconto e taxas antes de confirmar a venda.' : 'Preencha os dados do cliente e dos itens. CPF é opcional.'}</p></div>
          <button className="modal-close" type="button" onClick={onClose} aria-label="Fechar formulário">×</button>
        </header>
        <form className="sale-form" onSubmit={submit}>
          <section className="form-section">
            <div className="form-section-title"><span>01</span><div><h3>Cliente e venda</h3><p>Informações para identificar este atendimento.</p></div></div>
            <div className="form-grid form-grid-two">
              <label className="field-span-two">Cliente cadastrado<select value={selectedClientId} onChange={(event) => selectClient(event.target.value)}><option value="">Digitar os dados manualmente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}{client.phone ? ` · ${client.phone}` : ''}</option>)}</select></label>
              <label className="field-span-two">Nome do cliente <b>*</b><input required maxLength={120} value={form.clientName} onChange={(event) => change('clientName', event.target.value)} placeholder="Nome e sobrenome" /></label>
              <label>CPF <span className="optional-label">opcional</span><input inputMode="numeric" maxLength={18} value={formatBrazilianTaxId(form.taxId)} onChange={(event) => change('taxId', formatBrazilianTaxId(event.target.value))} placeholder="000.000.000-00" /></label>
              <label>WhatsApp / telefone<input type="tel" inputMode="tel" maxLength={16} value={formatBrazilianPhone(form.phone)} onChange={(event) => change('phone', formatBrazilianPhone(event.target.value))} placeholder="(00) 00000-0000" /></label>
              <label>E-mail <span className="optional-label">opcional</span><input type="email" maxLength={160} value={form.email} onChange={(event) => change('email', event.target.value)} placeholder="cliente@email.com" /></label>
              <label>Canal da venda <b>*</b><select value={form.channel} onChange={(event) => change('channel', event.target.value)}>{form.channel === 'mercadolivre' && <option value="mercadolivre">Mercado Livre (registro antigo)</option>}<option value="whatsapp">WhatsApp</option><option value="instagram">Instagram</option><option value="presencial">Presencial</option><option value="outro">Outro</option></select></label>
              <label>Tipo de pedido<select value={form.orderType} onChange={(event) => change('orderType', event.target.value)}><option value="physical">Produto físico</option><option value="online">Pedido online</option></select></label>
              <label>{isQuote ? 'Data do orçamento' : 'Data da venda'} <b>*</b><input type="date" required value={form.soldAt} onChange={(event) => change('soldAt', event.target.value)} /></label>
              {isQuote && <label>Orçamento válido até <b>*</b><input type="date" required min={form.soldAt} value={form.validUntil} onChange={(event) => change('validUntil', event.target.value)} /></label>}
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-title"><span>02</span><div><h3>Itens do {isQuote ? 'orçamento' : 'venda'}</h3><p>{isQuote ? 'Selecione itens do catálogo ou informe uma descrição manualmente; o estoque baixa quando o orçamento virar venda.' : 'Itens do catálogo têm saída automática no estoque; itens manuais não movimentam o estoque.'}</p></div></div>
            <div className="sale-items-head"><span>Produto do catálogo</span><span>Descrição</span><span>Qtd.</span><span>Valor unitário</span><span>Total</span><span /></div>
            <div className="sale-item-list">
              {form.items.map((item, index) => <div className="sale-item-row" key={index}>
                <select aria-label="Selecionar produto cadastrado (opcional)" value={item.productId} onChange={(event) => selectProduct(index, event.target.value)}><option value="">Item manual</option>{products.filter((product) => product.active !== false).map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}</select>
                <input aria-label="Descrição do produto" required maxLength={140} value={item.description} onChange={(event) => changeItem(index, 'description', event.target.value)} placeholder="Ex.: Suporte personalizado" />
                <input aria-label="Quantidade" type="number" required min="1" step="1" value={item.quantity} onChange={(event) => changeItem(index, 'quantity', event.target.value)} />
                <input aria-label="Valor unitário em reais" type="number" required min="0" step="0.01" value={item.unitPrice} onChange={(event) => changeItem(index, 'unitPrice', event.target.value)} placeholder="0,00" />
                <strong>{money(amount(item.quantity) * amount(item.unitPrice))}</strong>
                <button className="remove-item" type="button" aria-label={`Remover item ${index + 1}`} disabled={form.items.length === 1} onClick={() => setForm((current) => ({ ...current, items: current.items.filter((_, itemIndex) => itemIndex !== index) }))}>×</button>
              </div>)}
            </div>
            <button type="button" className="add-item-button" onClick={() => setForm((current) => ({ ...current, items: [...current.items, emptyItem()] }))}>＋ Adicionar produto</button>
            <div className="sale-totals">
              <div><span>Subtotal</span><strong>{money(subtotal)}</strong></div>
              <label>Desconto<input type="number" min="0" step="0.01" value={form.discount} onChange={(event) => change('discount', event.target.value)} /></label>
              <label>Agrado / doação (R$)<input type="number" min="0" step="0.01" value={form.extraAmount} onChange={(event) => change('extraAmount', event.target.value)} /><small>Valor voluntário pago além do preço dos produtos.</small></label>
              <label>Taxas da venda<input type="number" min="0" step="0.01" value={form.fees} onChange={(event) => change('fees', event.target.value)} /></label>
              <div className="sale-total"><span>Total da venda</span><strong>{money(total)}</strong></div>
            </div>
          </section>

          <section className="form-section">
            <div className="form-section-title"><span>03</span><div><h3>{isQuote ? 'Entrega e condições' : 'Pagamento e entrega'}</h3><p>{isQuote ? 'Combine o formato de entrega antes de enviar a proposta.' : 'O saldo pendente é calculado com o valor já recebido.'}</p></div></div>
            <div className="form-grid form-grid-two">
            {!isQuote && <><label>Forma de pagamento<select value={form.paymentMethod} onChange={(event) => change('paymentMethod', event.target.value)}><option value="dinheiro">Dinheiro</option><option value="transferencia">Transferência</option><option value="outro">Outra</option></select></label>
              <label>Valor recebido (R$)<input type="number" min="0" step="0.01" value={form.receivedAmount} onChange={(event) => change('receivedAmount', event.target.value)} /></label>
            <div className="payment-summary"><span>Status do pagamento</span><strong className={`status-pill payment-${paymentStatus(total, received)}`}>{paymentLabels[paymentStatus(total, received)]}</strong><small>{due > 0 ? `${money(due)} pendente` : 'Venda totalmente recebida'}</small></div></>}
              <label>Entrega / retirada<select value={form.deliveryMethod} onChange={(event) => change('deliveryMethod', event.target.value)}><option value="delivery">Entrega</option><option value="pickup">Retirada pelo cliente</option></select></label>
              <label>Prazo de entrega<input type="date" value={form.dueDate} onChange={(event) => change('dueDate', event.target.value)} /><small>Usado para alertas de pedidos próximos do prazo.</small></label>
              <label>Status da produção<select value={form.productionStatus} onChange={(event) => change('productionStatus', event.target.value)}><option value="not_started">Ainda não começou</option><option value="preparing">Em preparo</option><option value="producing">Em produção</option><option value="ready">Produção concluída</option></select><small>Todas as vendas ficam em Produção para você acompanhar e marcar como concluídas.</small></label>
              <label>Status da entrega<select value={form.deliveryStatus} onChange={(event) => change('deliveryStatus', event.target.value)}><option value="pending">A combinar</option><option value="preparing">Em preparação</option><option value="ready">Pronto</option><option value="shipped">Enviado</option><option value="delivered">Entregue</option><option value="pickup">Retirada</option></select></label>
            </div>
            {form.deliveryMethod === 'delivery' && <div className="form-grid address-grid">
              <label className="field-span-two">Endereço de entrega <b>*</b><input required maxLength={180} value={form.address} onChange={(event) => change('address', event.target.value)} placeholder="Rua, número e complemento" /></label>
              <label>Cidade<input maxLength={80} value={form.city} onChange={(event) => change('city', event.target.value)} /></label>
              <label>Estado<input maxLength={2} value={form.state} onChange={(event) => change('state', event.target.value)} placeholder="UF" /></label>
              <label>CEP<input inputMode="numeric" maxLength={10} value={form.postalCode} onChange={(event) => change('postalCode', event.target.value)} placeholder="00000-000" /></label>
            </div>}
          </section>

          <section className="form-section form-section-last">
            <div className="form-section-title"><span>04</span><div><h3>Observações</h3><p>Detalhes internos que ajudem no acompanhamento.</p></div></div>
            <label className="notes-field"><span>Observações <span className="optional-label">opcional</span></span><textarea rows="3" maxLength={1000} value={form.notes} onChange={(event) => change('notes', event.target.value)} placeholder="Cor, personalização, combinado de retirada…" /></label>
          </section>

          {formError && <div className="alert alert-error sale-form-error" role="alert">{formError}</div>}
          <footer className="sale-form-footer"><span><b>*</b> Campo obrigatório {!isQuote && <span className="estimate-note">Desconto reduz o total; taxas reduzem o líquido estimado: {money(total - fees)}</span>}</span><div><button className="button button-secondary" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : isQuote ? quote ? 'Salvar alterações' : 'Salvar orçamento' : sale ? 'Salvar alterações' : quote ? 'Confirmar venda' : 'Salvar venda'}</button></div></footer>
        </form>
      </section>
    </div>
  )
}

export default function ExternalSalesPage() {
  const [searchParams] = useSearchParams()
  const alertFilter = searchParams.get('alert') || ''
  const { user, workspaceUid } = useAuth()
  const { sales, loading, error } = useExternalSales()
  const { quotes, loading: quotesLoading, error: quotesError } = useQuotes()
  const { business, error: businessError } = useBusinessDetails()
  const { preferences } = usePreferences()
  const [formSale, setFormSale] = useState(null)
  const [formQuote, setFormQuote] = useState(null)
  const [formMode, setFormMode] = useState('sale')
  const [formOpen, setFormOpen] = useState(false)
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') === 'quotes' ? 'quotes' : 'sales')
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState('all')
  const [stateFilter, setStateFilter] = useState('active')
  const [toast, setToast] = useState('')
  const [cancelError, setCancelError] = useState('')
  const [approvingSaleId, setApprovingSaleId] = useState('')
  const [documentError, setDocumentError] = useState('')
  const [salesGoal, setSalesGoal] = useState(String(preferences.monthlySalesGoal || 5000))
  const [weeklySalesGoal, setWeeklySalesGoal] = useState(String(preferences.weeklySalesGoal || ''))
  const [annualSalesGoal, setAnnualSalesGoal] = useState(String(preferences.annualSalesGoal || ''))
  const [goalMessage, setGoalMessage] = useState('')
  const [goalSaving, setGoalSaving] = useState(false)
  useEffect(() => {
    if (searchParams.get('tab') === 'quotes' || alertFilter === 'expired-quotes') setActiveTab('quotes')
    else if (alertFilter) setActiveTab('sales')
  }, [searchParams, alertFilter])
  useEffect(() => {
    if (preferences.monthlySalesGoal) setSalesGoal(String(preferences.monthlySalesGoal))
  }, [preferences.monthlySalesGoal])
  useEffect(() => { setWeeklySalesGoal(String(preferences.weeklySalesGoal || '')) }, [preferences.weeklySalesGoal])
  useEffect(() => { setAnnualSalesGoal(String(preferences.annualSalesGoal || '')) }, [preferences.annualSalesGoal])

  const today = localToday()
  const filteredSales = useMemo(() => sales.filter((sale) => {
    const needle = search.trim().toLocaleLowerCase('pt-BR')
    const matchesSearch = !needle || [sale.id, sale.client?.name, sale.client?.phone, ...(sale.items ?? []).map((item) => item.description)]
      .some((value) => String(value ?? '').toLocaleLowerCase('pt-BR').includes(needle))
    const matchesChannel = channel === 'all' || sale.channel === channel
    const matchesState = stateFilter === 'all' || (stateFilter === 'active' ? sale.status !== 'cancelled' : sale.status === 'cancelled')
    const matchesAlert = alertFilter === 'overdue' ? sale.status !== 'cancelled' && needsProductionOrDelivery(sale) && sale.dueDate && sale.dueDate < today
      : alertFilter === 'due-soon' ? sale.status !== 'cancelled' && needsProductionOrDelivery(sale) && sale.dueDate && sale.dueDate >= today && sale.dueDate <= datePlusDays(Number(preferences.dueAlertDays || 3))
        : !alertFilter
    return matchesSearch && matchesChannel && matchesState && matchesAlert
  }), [sales, search, channel, stateFilter, alertFilter, today, preferences.dueAlertDays])
  const filteredQuotes = useMemo(() => alertFilter === 'expired-quotes' ? quotes.filter((quote) => quote.status === 'open' && quote.validUntil && quote.validUntil < today) : quotes, [quotes, alertFilter, today])

  const activeSales = sales.filter((sale) => sale.status !== 'cancelled' && sale.orderApprovalStatus !== 'pending')
  const grossTotal = activeSales.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0)
  const outstandingTotal = activeSales.reduce((sum, sale) => sum + (Number(sale.outstandingAmount) || 0), 0)
  const { monthKey, weekStart, weekEnd, yearKey, weeklySalesTotal, monthlySalesTotal, annualSalesTotal } = calculateSalesGoalTotals(sales)
  const goalCards = [
    { key: 'week', label: 'da semana', heading: 'META DA SEMANA', total: weeklySalesTotal, value: weeklySalesGoal, setValue: setWeeklySalesGoal, range: `${weekStart} a ${weekEnd}` },
    { key: 'month', label: 'do mês', heading: 'META DO MÊS', total: monthlySalesTotal, value: salesGoal, setValue: setSalesGoal, range: new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(Number(monthKey.slice(0, 4)), Number(monthKey.slice(5, 7)) - 1, 1)) },
    { key: 'year', label: 'do ano', heading: 'META DO ANO', total: annualSalesTotal, value: annualSalesGoal, setValue: setAnnualSalesGoal, range: yearKey },
  ]

  async function saveSalesGoal(period, valueInput, event) {
    event.preventDefault()
    const value = amount(valueInput)
    if (value <= 0) { setGoalMessage('Informe uma meta maior que zero.'); return }
    setGoalSaving(true)
    setGoalMessage('')
    try {
      const preferenceKey = { week: 'weeklySalesGoal', month: 'monthlySalesGoal', year: 'annualSalesGoal' }[period]
      await savePreferences(user.uid, { [preferenceKey]: value })
      setGoalMessage('Meta salva com sucesso.')
    } catch (cause) { setGoalMessage(cause.message || 'Não foi possível salvar a meta.') }
    finally { setGoalSaving(false) }
  }

  function notify(message) {
    setToast(message)
    window.setTimeout(() => setToast(''), 3500)
    setFormOpen(false)
    setFormSale(null)
    setFormQuote(null)
  }

  function openDocument(documentData, type) {
    setDocumentError('')
    try {
      const data = {
        ...documentData,
        channelLabel: channelLabels[documentData.channel] || documentData.channel,
        paymentMethodLabel: type === 'quote' ? 'A combinar' : paymentMethodLabels[documentData.paymentMethod] || documentData.paymentMethod,
        paymentStatusLabel: paymentLabels[documentData.paymentStatus] || 'Pendente',
      }
      printSalesDocument(data, business, type, preferences.accentColor)
    } catch (cause) {
      setDocumentError(cause.message || 'Não foi possível abrir o documento para impressão.')
    }
  }

  function startNewSale() {
    setFormMode('sale')
    setFormSale(null)
    setFormQuote(null)
    setFormOpen(true)
  }

  function startNewQuote() {
    setActiveTab('quotes')
    setFormMode('quote')
    setFormSale(null)
    setFormQuote(null)
    setFormOpen(true)
  }

  function startQuoteEdit(quote) {
    setActiveTab('quotes')
    setFormMode('quote')
    setFormSale(null)
    setFormQuote(quote)
    setFormOpen(true)
  }

  function startQuoteConversion(quote) {
    if (quote.validUntil && quote.validUntil < localToday() && !window.confirm('Este orçamento venceu. Deseja continuar e registrar a venda mesmo assim?')) return
    setActiveTab('sales')
    setFormMode('sale')
    setFormSale(null)
    setFormQuote(quote)
    setFormOpen(true)
  }

  async function cancelSale(sale) {
    if (!window.confirm(`Cancelar a venda de ${sale.client?.name || 'cliente'}? O registro será preservado no histórico.`)) return
    setCancelError('')
    try {
      await cancelExternalSale(workspaceUid, sale.id)
      notify('Venda cancelada. O histórico foi preservado.')
    } catch (cause) {
      setCancelError(firestoreErrorMessage(cause))
    }
  }

  async function approveSale(sale) {
    setCancelError('')
    setApprovingSaleId(sale.id)
    try {
      await approveWebsiteOrder(workspaceUid, sale.id)
      notify(`Solicitação #${sale.id.slice(0, 7).toUpperCase()} confirmada. O estoque físico foi atualizado.`)
    } catch (cause) {
      const scheduledRequest = sale.scheduledPurchase || sale.items?.some((item) => item.scheduledPurchase)
      const message = firestoreErrorMessage(cause)
      setCancelError(scheduledRequest && message.toLocaleLowerCase('pt-BR').includes('estoque insuficiente')
        ? `O agendamento continua pendente. Reponha o estoque dos itens solicitados antes de confirmar: ${message}`
        : message)
    } finally {
      setApprovingSaleId('')
    }
  }

  async function removeSale(sale) {
    if (!window.confirm(`Excluir permanentemente a venda e o comprovante de ${sale.client?.name || 'cliente'}? O registro será removido do Firestore e não poderá ser recuperado.`)) return
    setCancelError('')
    try {
      await deleteExternalSale(workspaceUid, sale.id)
      notify('Venda e comprovante excluídos permanentemente.')
    } catch (cause) {
      setCancelError(firestoreErrorMessage(cause))
    }
  }

  async function cancelSavedQuote(quote) {
    if (!window.confirm(`Cancelar o orçamento ${quote.quoteNumber || ''}? O registro continuará disponível no histórico.`)) return
    setCancelError('')
    try {
      await cancelQuote(workspaceUid, quote.id)
      setToast('Orçamento cancelado. O registro foi preservado.')
      window.setTimeout(() => setToast(''), 3500)
    } catch (cause) {
      setCancelError(firestoreErrorMessage(cause))
    }
  }

  async function restoreMissingSale(quote) {
    setCancelError('')
    try {
      const saleId = await restoreConvertedQuoteSale(workspaceUid, quote.id, user.uid)
      setToast(`Venda restaurada a partir do orçamento. Código #${saleId.slice(0, 7).toUpperCase()}.`)
      window.setTimeout(() => setToast(''), 4500)
    } catch (cause) {
      setCancelError(cause.message || 'Não foi possível restaurar a venda.')
    }
  }

  async function removeQuote(quote) {
    const convertedWarning = quote.status === 'converted'
      ? ' A venda convertida e seu comprovante permanecerão no histórico.'
      : ''
    if (!window.confirm(`Excluir permanentemente o orçamento ${quote.quoteNumber || ''}? O registro será removido do Firestore e não poderá ser recuperado.${convertedWarning}`)) return
    setCancelError('')
    try {
      await deleteQuote(workspaceUid, quote.id)
      setToast('Orçamento excluído permanentemente.')
      window.setTimeout(() => setToast(''), 3500)
    } catch (cause) {
      setCancelError(firestoreErrorMessage(cause))
    }
  }

  return (
    <div className="page-stack sales-page">
      <div className="page-intro sales-intro"><div><p className="eyebrow">COMERCIAL</p><h2>Vendas externas</h2><p>Registre e acompanhe as vendas feitas por canais externos.</p></div><div className="sales-intro-actions"><button className="button button-secondary" onClick={startNewQuote}>＋ Novo orçamento</button><button className="button button-primary new-sale-button" onClick={startNewSale}>＋ Nova venda externa</button></div></div>

      {activeTab === 'sales' && <div className="sales-summary-grid">
        <article className="sales-summary-card"><span>Vendas ativas</span><strong>{activeSales.length}</strong><small>Registros não cancelados</small></article>
        <article className="sales-summary-card"><span>Valor vendido</span><strong>{money(grossTotal)}</strong><small>Soma das vendas ativas</small></article>
        <article className="sales-summary-card"><span>A receber</span><strong>{money(outstandingTotal)}</strong><small>Saldo pendente dos clientes</small></article>
      </div>}

            {activeTab === 'sales' && <section className="sales-goals-grid" aria-label="Metas de vendas">
        {goalCards.map((goal) => { const target = Math.max(0, amount(goal.value)); const progress = target > 0 ? Math.min(100, (goal.total / target) * 100) : 0; return <article className="panel sales-goal-card" key={goal.key}>
          <div className="sales-goal-copy"><p className="eyebrow">{goal.heading}</p><h3>{target > 0 && goal.total >= target ? 'Meta alcançada!' : target > 0 ? `${Math.floor(progress)}% da meta` : 'Defina sua meta'}</h3><p>{money(goal.total)} de {target > 0 ? money(target) : '—'} em vendas ativas acumuladas até hoje · {goal.range}</p><div className="sales-goal-track" role="progressbar" aria-label={`Progresso da meta ${goal.label}`} aria-valuemin="0" aria-valuemax="100" aria-valuenow={Math.round(progress)}><span style={{ width: `${progress}%` }} /></div><small>{target > 0 ? `${Math.floor(progress)}% concluído${goal.total < target ? ` · faltam ${money(target - goal.total)}` : ' · objetivo alcançado!'}` : 'Informe um valor para acompanhar o progresso.'}</small></div>
          <form className="sales-goal-form" onSubmit={(event) => saveSalesGoal(goal.key, goal.value, event)}><label htmlFor={`sales-goal-${goal.key}`}>Meta {goal.label} (R$)</label><div><input id={`sales-goal-${goal.key}`} type="number" min="1" step="0.01" value={goal.value} onChange={(event) => goal.setValue(event.target.value)} /><button className="button button-secondary" disabled={goalSaving}>{goalSaving ? 'Salvando…' : 'Salvar'}</button></div>{goalMessage && <small role="status">{goalMessage}</small>}</form>
        </article> })}
      </section>}

      <div className="sales-view-tabs" role="tablist" aria-label="Vendas e orçamentos">
        <button type="button" role="tab" aria-selected={activeTab === 'sales'} className={activeTab === 'sales' ? 'active' : ''} onClick={() => setActiveTab('sales')}>Vendas <b>{sales.length}</b></button>
        <button type="button" role="tab" aria-selected={activeTab === 'quotes'} className={activeTab === 'quotes' ? 'active' : ''} onClick={() => setActiveTab('quotes')}>Orçamentos <b>{quotes.filter((quote) => quote.status === 'open').length}</b></button>
      </div>

      {documentError && <div className="sales-error" role="alert">{documentError}</div>}
      {businessError && <div className="sales-error" role="alert">{businessError}</div>}
      {cancelError && <div className="sales-error" role="alert"><strong>Não foi possível concluir a ação</strong><span>{cancelError}</span></div>}
      {activeTab === 'sales' ? <section className="panel sales-list-panel">
        <div className="sales-list-heading"><div><h3>Histórico de vendas</h3><p>Atualizado em tempo real a partir do Firestore.</p></div><span className="sales-count-chip">{filteredSales.length} {filteredSales.length === 1 ? 'registro' : 'registros'}</span></div>
        <div className="sales-filters">
          <label className="search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente, produto ou código" /></label>
          <select aria-label="Filtrar por canal" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">Todos os canais</option>{Object.entries(channelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          <select aria-label="Filtrar por situação" value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}><option value="active">Vendas ativas</option><option value="cancelled">Canceladas</option><option value="all">Todas</option></select>
        </div>

        {(error || quotesError) && <div className="sales-error" role="alert"><strong>Falha ao carregar vendas</strong><span>{error || quotesError}</span></div>}
        {alertFilter === 'overdue' && <div className="sales-alert-filter-note" role="status">Exibindo vendas atrasadas e ainda não entregues ({filteredSales.length}).</div>}
        {alertFilter === 'due-soon' && <div className="sales-alert-filter-note" role="status">Exibindo vendas que vencem em até {preferences.dueAlertDays} dia(s) ({filteredSales.length}).</div>}
        {loading ? <div className="sales-loading"><span className="spinner" />Carregando vendas…</div> : filteredSales.length === 0 ? (
          <div className="sales-empty"><span className="sales-empty-icon">↗</span><h3>{sales.length ? 'Nenhuma venda corresponde aos filtros' : 'Comece registrando uma venda'}</h3><p>{sales.length ? 'Ajuste a busca ou os filtros para ver os outros registros.' : 'As vendas ficarão salvas na sua conta e poderão ser consultadas por aqui.'}</p>{!sales.length && <button className="button button-secondary" onClick={startNewSale}>Registrar primeira venda</button>}</div>) : (
          <div className="sales-table-scroll"><table className="sales-table"><thead><tr><th>Venda</th><th>Cliente</th><th>Canal</th><th>Data</th><th>Pagamento</th><th>Entrega</th><th>Total</th><th>Ações</th></tr></thead><tbody>
            {filteredSales.map((sale) => { const overdue = sale.status !== 'cancelled' && needsProductionOrDelivery(sale) && sale.dueDate && sale.dueDate < today; const daysLate = overdue ? Math.floor((new Date(`${today}T00:00:00`) - new Date(`${sale.dueDate}T00:00:00`)) / 86400000) : 0; return <tr key={sale.id} className={`${sale.status === 'cancelled' ? 'cancelled-row ' : ''}${overdue ? 'sale-overdue-row' : ''}`}>
              <td><strong className="sale-code">#{sale.id.slice(0, 7).toUpperCase()}</strong><small>{(sale.items ?? []).length} {(sale.items ?? []).length === 1 ? 'item' : 'itens'}</small></td>
              <td><strong className="table-primary-text">{sale.client?.name || 'Cliente'}</strong><small>{sale.client?.phone || sale.client?.email || 'Sem contato'}</small></td>
              <td>{channelLabels[sale.channel] || 'Outro'}{sale.orderApprovalStatus === 'pending' && <small><span className="status-pill payment-pending">{sale.scheduledPurchase || sale.items?.some((item) => item.scheduledPurchase) ? 'Agendamento pendente' : 'Solicitação pendente'}</span></small>}{sale.orderApprovalStatus === 'pending' && sale.scheduledPurchase && <small>Confirme após a reposição do estoque.</small>}</td><td>{dateLabel(sale.soldAt)}</td>
              <td><span className={`status-pill payment-${sale.paymentStatus || 'pending'}`}>{sale.status === 'cancelled' ? 'Cancelada' : paymentLabels[sale.paymentStatus] || 'Pendente'}</span></td>
              <td><span className={`status-pill delivery-${sale.deliveryStatus || 'pending'}`}>{deliveryLabels[sale.deliveryStatus] || 'A combinar'}</span>{overdue && <small className="deadline-overdue">Atrasada há {daysLate} dia(s) · prazo {dateLabel(sale.dueDate)}</small>}</td>
              <td><strong className="table-primary-text">{money(sale.total)}</strong><small>{sale.outstandingAmount > 0 ? `${money(sale.outstandingAmount)} a receber` : 'Sem saldo pendente'}</small></td>
              <td><div className="sale-actions">{sale.orderApprovalStatus === 'pending' && <button disabled={approvingSaleId === sale.id} title={sale.scheduledPurchase ? 'Confirme após repor o estoque dos itens agendados' : 'Confirmar solicitação do cliente'} onClick={() => approveSale(sale)}>{approvingSaleId === sale.id ? 'Confirmando…' : sale.scheduledPurchase ? 'Confirmar após reposição' : 'Confirmar pedido'}</button>}<button aria-label={`Editar venda ${sale.id.slice(0, 7)}`} title={sale.orderApprovalStatus === 'pending' ? 'Confirme a solicitação antes de editar' : 'Editar venda'} disabled={sale.status === 'cancelled' || sale.orderApprovalStatus === 'pending'} onClick={() => { setFormMode('sale'); setFormQuote(null); setFormSale(sale); setFormOpen(true) }}>Editar</button>{sale.status !== 'cancelled' && <button title="Imprimir comprovante de venda" onClick={() => openDocument(sale, 'sale')}>Comprovante</button>}{sale.status !== 'cancelled' && <button className="cancel-action" title="Cancelar venda e manter o comprovante no histórico" onClick={() => cancelSale(sale)}>Cancelar</button>}<button className="cancel-action" title="Excluir venda e comprovante permanentemente" onClick={() => removeSale(sale)}>Excluir</button></div></td>
            </tr>})}
          </tbody></table></div>
        )}
        <footer className="sales-list-footer"><span>Cancelar preserva o registro. Excluir remove permanentemente a venda e seu comprovante.</span><span>{sales.length} no total</span></footer>
      </section> : <section className="panel sales-list-panel">
        <div className="sales-list-heading"><div><h3>Orçamentos</h3><p>Imprima e converta propostas aceitas em vendas sem redigitar os dados.</p></div><span className="sales-count-chip">{quotes.length} {quotes.length === 1 ? 'orçamento' : 'orçamentos'}</span></div>
        {quotesError && <div className="sales-error" role="alert">{quotesError}</div>}{alertFilter === 'expired-quotes' && <div className="sales-alert-filter-note" role="status">Exibindo orçamentos vencidos que ainda não viraram venda ({filteredQuotes.length}).</div>}
        {quotesLoading ? <div className="sales-loading"><span className="spinner" />Carregando orçamentos…</div> : filteredQuotes.length === 0 ? <div className="sales-empty"><span className="sales-empty-icon">▤</span><h3>{alertFilter === 'expired-quotes' ? 'Nenhum orçamento vencido' : 'Nenhum orçamento cadastrado'}</h3><p>{alertFilter === 'expired-quotes' ? 'Os orçamentos vencidos aparecerão aqui até serem convertidos ou cancelados.' : 'Crie uma proposta com os produtos do catálogo ou itens manuais.'}</p>{!quotes.length && <button className="button button-secondary" onClick={startNewQuote}>Criar primeiro orçamento</button>}</div> : <div className="sales-table-scroll"><table className="sales-table quote-table"><thead><tr><th>Orçamento</th><th>Cliente</th><th>Emitido</th><th>Validade</th><th>Status</th><th>Total</th><th>Ações</th></tr></thead><tbody>{filteredQuotes.map((quote) => {
          const expired = quote.status === 'open' && quote.validUntil && quote.validUntil < localToday()
          return <tr key={quote.id} className={expired ? 'quote-expired-row' : ''}>
            <td><strong className="sale-code">{quote.quoteNumber || `ORC-${quote.id.slice(0, 8).toUpperCase()}`}</strong><small>{quote.items?.length || 0} {(quote.items?.length || 0) === 1 ? 'item' : 'itens'}</small></td>
            <td><strong className="table-primary-text">{quote.client?.name || 'Cliente'}</strong><small>{quote.client?.taxId || quote.client?.phone || 'Sem CPF/contato'}</small></td>
            <td>{dateTimeLabel(quote.createdAt)}</td><td>{dateLabel(quote.validUntil)}</td>
            <td><span className={`status-pill ${quote.status === 'converted' ? 'payment-paid' : quote.status === 'cancelled' ? 'delivery-shipped' : expired ? 'delivery-shipped' : 'payment-pending'}`}>{quote.status === 'converted' ? 'Convertido' : quote.status === 'cancelled' ? 'Cancelado' : expired ? 'Vencido' : 'Aberto'}</span></td>
            <td><strong className="table-primary-text">{money(quote.total)}</strong></td>
            <td><div className="sale-actions"><button title="Imprimir orçamento" onClick={() => openDocument(quote, 'quote')}>Imprimir</button>{quote.status === 'converted' && !quotesLoading && !loading && !sales.some((sale) => sale.id === quote.saleId) && <button className="cancel-action" title="Recriar a venda ausente a partir dos dados deste orçamento" onClick={() => restoreMissingSale(quote)}>Restaurar venda</button>}{quote.status === 'open' && <><button onClick={() => startQuoteEdit(quote)}>Editar</button><button className="cancel-action" onClick={() => startQuoteConversion(quote)}>Converter em venda</button><button className="cancel-action" title="Cancelar e preservar o orçamento" onClick={() => cancelSavedQuote(quote)}>Cancelar</button></>}<button className="cancel-action" title="Excluir orçamento permanentemente" onClick={() => removeQuote(quote)}>Excluir</button></div></td>
          </tr>
        })}</tbody></table></div>}
      </section>}
      <div className="info-banner"><span>i</span><p>Orçamentos e comprovantes são documentos comerciais para controle e apresentação ao cliente; não substituem nota fiscal. CPF/CNPJ pode ser adicionado depois nas Configurações.</p></div>
      {formOpen && <SaleForm key={formSale?.id ?? formQuote?.id ?? formMode} sale={formSale} quote={formQuote} mode={formMode} business={business} onClose={() => { setFormOpen(false); setFormSale(null); setFormQuote(null) }} onSaved={notify} />}
      {toast && <div className="toast-success" role="status"><span>✓</span>{toast}</div>}
    </div>
  )
}
