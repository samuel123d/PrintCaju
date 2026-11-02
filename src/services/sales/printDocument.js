function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character])
}

function money(value) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
}

function dateTime(value, dateFallback) {
  const date = value?.toDate ? value.toDate() : value ? new Date(value) : dateFallback ? new Date(`${dateFallback}T12:00:00`) : new Date()
  if (Number.isNaN(date.getTime())) return '—'
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeStyle: 'short' }).format(date)
}

function companyAddress(company) {
  return [company.address, [company.city, company.state].filter(Boolean).join(' - '), company.postalCode && `CEP ${company.postalCode}`].filter(Boolean).join(' · ')
}

export function printSalesDocument(documentData, company, type, accentColor) {
  const quote = type === 'quote'
  const brandColor = /^#[0-9a-f]{6}$/i.test(accentColor || '') ? accentColor : '#FF8A00'
  const colorChannels = [1, 3, 5].map((offset) => Number.parseInt(brandColor.slice(offset, offset + 2), 16) / 255)
  const linearChannels = colorChannels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  const brandInk = 0.2126 * linearChannels[0] + 0.7152 * linearChannels[1] + 0.0722 * linearChannels[2] > 0.18 ? '#17212f' : brandColor
  const popup = window.open('', '_blank')
  if (!popup) throw new Error('O navegador bloqueou a janela de impressão. Permita pop-ups e tente novamente.')

  const number = quote
    ? documentData.quoteNumber || `ORC-${documentData.id?.slice(0, 8).toUpperCase()}`
    : `VND-${documentData.id?.slice(0, 8).toUpperCase()}`
  const items = (documentData.items || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.description)}</td>
      <td class="number">${Number(item.quantity) || 0}</td>
      <td class="number">${money(item.unitPrice)}</td>
      <td class="number">${money(item.lineTotal ?? Number(item.quantity) * Number(item.unitPrice))}</td>
    </tr>`).join('')
  const sellerDetails = [
    company.taxId && `CPF/CNPJ: ${escapeHtml(company.taxId)}`,
    companyAddress(company) && escapeHtml(companyAddress(company)),
    company.phone && `Telefone: ${escapeHtml(company.phone)}`,
    company.email && escapeHtml(company.email),
  ].filter(Boolean).map((item) => `<div>${item}</div>`).join('')
  const customer = documentData.client || {}
  popup.opener = null
  const customerDetails = [
    company.showCustomerTaxId !== false && customer.taxId && `CPF/CNPJ: ${escapeHtml(customer.taxId)}`,
    company.showCustomerContact !== false && customer.phone && `Telefone: ${escapeHtml(customer.phone)}`,
    company.showCustomerContact !== false && customer.email && escapeHtml(customer.email),
    documentData.delivery?.address && `Endereço: ${escapeHtml(documentData.delivery.address)}`,
    [documentData.delivery?.city, documentData.delivery?.state].filter(Boolean).join(' - '),
    documentData.delivery?.postalCode && `CEP: ${escapeHtml(documentData.delivery.postalCode)}`,
  ].filter(Boolean).map((item) => `<div>${item}</div>`).join('')
  const issued = dateTime(documentData.createdAt, quote ? documentData.quoteDate : documentData.soldAt)
  const subtotal = Number(documentData.subtotal) || (documentData.items || []).reduce((sum, item) => sum + (Number(item.quantity) || 0) * (Number(item.unitPrice) || 0), 0)
  const disclaimer = quote
    ? 'Este orçamento é uma proposta comercial e não representa confirmação de pagamento ou documento fiscal.'
    : 'Este comprovante registra uma venda comercial entre as partes e não substitui nota fiscal ou outro documento fiscal obrigatório.'
  const documentTitle = quote
    ? `${company.quoteTitle || 'ORÇAMENTO'}${documentData.status === 'cancelled' ? ' · CANCELADO' : ''}`
    : company.receiptTitle || 'COMPROVANTE DE VENDA'
  const documentFooter = quote ? company.quoteFooter : company.receiptFooter
  const summaryDetails = [
    company.showSalesChannel !== false && `<div>Canal: ${escapeHtml(documentData.channelLabel || documentData.channel || 'Venda direta')}</div>`,
    company.showPaymentDetails !== false && `<div>Pagamento: ${escapeHtml(documentData.paymentMethodLabel || documentData.paymentMethod || 'A combinar')}</div>`,
    company.showPaymentDetails !== false && !quote && `<div>Status do pagamento: ${escapeHtml(documentData.paymentStatusLabel || 'Pendente')}</div>`,
    company.showDeliveryDetails !== false && `<div>Entrega: ${escapeHtml(documentData.deliveryMethod === 'pickup' ? 'Retirada' : 'Entrega')}</div>`,
    documentData.dueDate && `<div>Prazo: ${escapeHtml(dateTime(null, documentData.dueDate).split(' às ')[0])}</div>`,
  ].filter(Boolean).join('')
  const configuredText = quote ? company.quoteIntro : ''

  popup.document.open()
  popup.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${quote ? 'Orçamento' : 'Comprovante de venda'} ${escapeHtml(number)}</title>
  <style>
    *{box-sizing:border-box}body{margin:0;padding:42px;color:#202b3c;font:14px Arial,sans-serif}.document{max-width:800px;margin:0 auto}.top{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:24px;border-bottom:3px solid var(--brand-color)}.brand{display:flex;align-items:center;gap:16px}.brand img{width:160px;max-height:76px;object-fit:contain}.brand h1{margin:0 0 6px;font-size:20px}.brand p,.meta,.muted{margin:4px 0;color:#657184;font-size:12px;line-height:1.5}.doc-type{text-align:right}.doc-type h2{margin:0 0 8px;color:var(--brand-ink);font-size:20px}.doc-type strong{font-size:13px}.people{display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:23px 0}.people section{padding:15px;border:1px solid #e4e8ee;border-radius:8px}.people h3{margin:0 0 10px;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:#667085}.people .name{font-size:15px;font-weight:700}.people div{margin-top:5px;color:#596578;font-size:12px;line-height:1.5}.items{width:100%;border-collapse:collapse}.items th{background:#f5f6f8;text-align:left;font-size:11px}.items th,.items td{padding:12px 10px;border-bottom:1px solid #e5e7eb}.number{text-align:right;white-space:nowrap}.totals{width:min(100%,330px);margin:20px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:6px 0;color:#596578}.totals .total{margin-top:6px;padding-top:12px;border-top:2px solid #253247;color:#202b3c;font-size:17px;font-weight:700}.notes{margin-top:25px;padding:14px;border-radius:8px;background:#f7f8fa;white-space:pre-wrap}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:50px;margin-top:65px;text-align:center}.signatures div{padding-top:9px;border-top:1px solid #687386;font-size:11px}.disclaimer{margin-top:25px;padding-top:12px;border-top:1px solid #e5e7eb;color:#7a8493;font-size:10px;line-height:1.5}.footer{margin-top:18px;text-align:center;color:#98a1ae;font-size:10px}@media print{body{padding:0}.document{max-width:none}.people section{break-inside:avoid}}
  </style>
</head>
<body style="--brand-color:${brandColor};--brand-ink:${brandInk}"><main class="document">
  <header class="top"><div class="brand"><img src="${escapeHtml(new URL('/printcaju-logo.png', window.location.origin).href)}" alt="Logo Print Caju"><div><h1>${escapeHtml(company.name || 'Print Caju')}</h1>${company.showCompanyDetails !== false ? `<div class="meta">${sellerDetails}</div>` : ''}</div></div><div class="doc-type"><h2>${escapeHtml(documentTitle)}</h2><strong>${escapeHtml(number)}</strong><p class="meta">${quote ? 'Emitido em' : 'Venda registrada em'} ${escapeHtml(issued)}</p>${quote && documentData.status === 'cancelled' ? '<p class="meta">Este orçamento foi cancelado.</p>' : ''}${quote && documentData.validUntil ? `<p class="meta">Válido até ${escapeHtml(dateTime(null, documentData.validUntil).split(' às ')[0])}</p>` : ''}</div></header>
  ${configuredText ? `<section class="notes">${escapeHtml(configuredText)}</section>` : ''}
  <div class="people" ${summaryDetails ? '' : 'style="grid-template-columns:1fr"'}><section><h3>${quote ? 'Proposta para' : 'Cliente'}</h3><div class="name">${escapeHtml(customer.name || 'Cliente')}</div>${customerDetails}</section>${summaryDetails ? `<section><h3>Resumo</h3>${summaryDetails}</section>` : ''}</div>
  <table class="items"><thead><tr><th>Produto / descrição</th><th class="number">Qtd.</th><th class="number">Valor unitário</th><th class="number">Total</th></tr></thead><tbody>${items}</tbody></table>
  <section class="totals"><div><span>Subtotal</span><strong>${money(subtotal)}</strong></div>${Number(documentData.discount) > 0 ? `<div><span>Desconto</span><strong>− ${money(documentData.discount)}</strong></div>` : ''}${Number(documentData.extraAmount) > 0 ? `<div><span>Agrado / doação</span><strong>+ ${money(documentData.extraAmount)}</strong></div>` : ''}<div class="total"><span>Total</span><strong>${money(documentData.total)}</strong></div>${!quote ? `<div><span>Recebido</span><strong>${money(documentData.receivedAmount)}</strong></div><div><span>Saldo pendente</span><strong>${money(documentData.outstandingAmount)}</strong></div>` : ''}</section>
  ${documentData.notes ? `<section class="notes"><strong>Observações</strong><div>${escapeHtml(documentData.notes)}</div></section>` : ''}
  ${company.showDocumentSignatures !== false ? `<div class="signatures"><div>${escapeHtml('Samuel Anderson Machado Lopes')}</div><div>${escapeHtml(customer.name || 'Cliente')}</div></div>` : ''}
  <p class="disclaimer">${disclaimer}</p>${documentFooter ? `<section class="notes">${escapeHtml(documentFooter)}</section>` : ''}<footer class="footer">${escapeHtml(company.name || 'Print Caju')} · ${escapeHtml(number)}</footer>
</main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),250))</script></body></html>`)
  popup.document.close()
  popup.focus()
}
