import {
  collection,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  query,
} from 'firebase/firestore'
import { db } from './firebase/config.js'

const normalizeEmail = (email) => String(email || '').trim().toLocaleLowerCase('pt-BR')
const customerCollection = (workspaceUid) => collection(db, 'users', workspaceUid, 'clients')
const salesCollection = (workspaceUid) => collection(db, 'users', workspaceUid, 'externalSales')

function customerProfileScore(client) {
  const fields = ['name', 'phone', 'taxId', 'address', 'city', 'state', 'postalCode']
  return fields.filter((field) => String(client[field] || '').trim()).length
    + (['google-forms', 'public-form', 'website-form'].includes(client.registrationSource) ? 2 : 0)
}

async function findCustomerMatches(workspaceUid, email) {
  const clients = customerCollection(workspaceUid)
  const normalizedEmail = normalizeEmail(email)
  const [byNormalizedEmail, byExactEmail] = await Promise.all([
    getDocs(query(clients, where('emailNormalized', '==', normalizedEmail))),
    getDocs(query(clients, where('email', '==', String(email || '').trim()))),
  ])
  return [...new Map([...byNormalizedEmail.docs, ...byExactEmail.docs].map((snapshot) => [
    snapshot.id,
    { id: snapshot.id, ref: snapshot.ref, ...snapshot.data() },
  ])).values()]
}

export async function linkCustomerAccount(uid, email) {
  if (!uid || !email) throw new Error('Entre na sua conta para localizar seu cadastro.')
  const content = await getDoc(doc(db, 'siteContent', 'main'))
  const workspaceUid = content.data()?.workspaceUid
  if (!workspaceUid) throw new Error('A loja ainda não foi inicializada. Peça ao administrador para abrir “Site institucional” no painel uma vez e tente novamente.')

  const linkedClients = await getDocs(query(customerCollection(workspaceUid), where('linkedAuthUid', '==', uid)))
  if (!linkedClients.empty) return linkedClients.docs[0].id

  const matches = await findCustomerMatches(workspaceUid, email)
  const alreadyLinked = matches.find((client) => client.linkedAuthUid === uid)
  if (alreadyLinked) return alreadyLinked.id
  if (matches.some((client) => client.linkedAuthUid)) {
    throw new Error('Este e-mail já está vinculado a outra conta. Fale com a Print Caju.')
  }
  if (!matches.length) return ''

  const client = matches.sort((first, second) => customerProfileScore(second) - customerProfileScore(first))[0]
  await updateDoc(client.ref, {
    email: String(client.email || email).trim(),
    emailNormalized: normalizeEmail(email),
    linkedAuthUid: uid,
    linkedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return client.id
}

function saleOrder(sale) {
  return {
    id: sale.id,
    soldAt: String(sale.soldAt || ''),
    dueDate: String(sale.dueDate || ''),
    items: (Array.isArray(sale.items) ? sale.items : []).slice(0, 30).map((item) => ({
      description: String(item.description || '').slice(0, 120),
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      scheduledPurchase: item.scheduledPurchase === true,
      scheduledQuantity: Number(item.scheduledQuantity) || 0,
    })),
    total: Number(sale.total) || 0,
    receivedAmount: Number(sale.receivedAmount) || 0,
    outstandingAmount: Number(sale.outstandingAmount) || 0,
    paymentStatus: String(sale.paymentStatus || 'pending'),
    productionStatus: String(sale.productionStatus || 'not_started'),
    deliveryStatus: String(sale.deliveryStatus || 'pending'),
    orderApprovalStatus: String(sale.orderApprovalStatus || 'approved'),
    status: sale.status === 'cancelled' ? 'cancelled' : 'active',
  }
}

export async function loadCustomerPortalData(uid, email) {
  const contentSnapshot = await getDoc(doc(db, 'siteContent', 'main'))
  const content = contentSnapshot.data() || {}
  const workspaceUid = content.workspaceUid
  if (!workspaceUid) return { linked: false, client: null, orders: [], whatsapp: '5584987115381' }

  const linkedClients = await getDocs(query(customerCollection(workspaceUid), where('linkedAuthUid', '==', uid)))
  const clientDocument = linkedClients.docs[0]
  if (!clientDocument) return { linked: false, client: null, orders: [], whatsapp: String(content.whatsapp || '5584987115381').replace(/\D/g, '') }

  const client = { id: clientDocument.id, ...clientDocument.data() }
  const normalizedEmail = normalizeEmail(email)
  const sales = salesCollection(workspaceUid)
  const salesQueries = [
    getDocs(query(sales, where('customerAuthUid', '==', uid))),
    getDocs(query(sales, where('clientId', '==', client.id))),
  ]
  const snapshots = await Promise.all(salesQueries)
  const uniqueSales = new Map(snapshots.flatMap((snapshot) => snapshot.docs.map((sale) => [
    sale.id,
    { id: sale.id, ...sale.data() },
  ])))
  const orders = [...uniqueSales.values()]
    .sort((first, second) => String(second.soldAt || '').localeCompare(String(first.soldAt || '')))
    .slice(0, 100)
    .map(saleOrder)

  return {
    linked: true,
    client: {
      id: client.id,
      name: String(client.name || '').slice(0, 120),
      email: String(client.email || normalizedEmail).slice(0, 160),
      phone: String(client.phone || '').slice(0, 30),
      taxId: String(client.taxId || '').slice(0, 24),
      address: String(client.address || '').slice(0, 180),
      city: String(client.city || '').slice(0, 80),
      state: String(client.state || '').slice(0, 2),
      postalCode: String(client.postalCode || '').slice(0, 12),
    },
    whatsapp: String(content.whatsapp || '5584987115381').replace(/\D/g, ''),
    orders,
  }
}

export async function createCustomerOrderRequest(uid, email, clientId, items, requestId) {
  if (!uid || !email || !clientId) throw new Error('Entre na sua conta e conclua seu cadastro para solicitar a compra.')
  if (!Array.isArray(items) || items.length < 1 || items.length > 30) throw new Error('A sacola deve conter de 1 a 30 produtos.')
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new Error('Não foi possível validar esta tentativa de compra. Atualize a página e tente novamente.')
  }

  const contentSnapshot = await getDoc(doc(db, 'siteContent', 'main'))
  const workspaceUid = contentSnapshot.data()?.workspaceUid
  if (!workspaceUid) throw new Error('A loja ainda não foi inicializada para receber solicitações. Peça ao administrador para abrir “Site institucional” no painel.')
  const normalizedEmail = normalizeEmail(email)
  const saleId = `site_${uid}_${requestId}`
  const saleRef = doc(salesCollection(workspaceUid), saleId)
  const clientRef = doc(customerCollection(workspaceUid), clientId)
  const quantities = new Map()
  for (const item of items) {
    if (typeof item?.productId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(item.productId)) throw new Error('Um produto da sacola é inválido.')
    const quantity = Number(item.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) throw new Error('A quantidade por produto deve estar entre 1 e 50.')
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + quantity)
    if (quantities.get(item.productId) > 50) throw new Error('A quantidade máxima por produto é 50.')
  }
  const productRefs = [...quantities.keys()].map((productId) => doc(db, 'publicSiteProducts', productId))

  const sale = await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(saleRef)
    if (existing.exists()) return { id: saleId, total: Number(existing.data().total) || 0 }

    const [clientSnapshot, ...productSnapshots] = await Promise.all([
      transaction.get(clientRef),
      ...productRefs.map((ref) => transaction.get(ref)),
    ])
    if (!clientSnapshot.exists()
      || clientSnapshot.data().linkedAuthUid !== uid
      || normalizeEmail(clientSnapshot.data().emailNormalized || clientSnapshot.data().email) !== normalizedEmail) {
      throw new Error('Não foi possível confirmar o cadastro da sua conta. Atualize seus dados e tente novamente.')
    }

    const orderItems = []
    let total = 0
    for (let index = 0; index < productSnapshots.length; index += 1) {
      const product = productSnapshots[index].data()
      const productId = [...quantities.keys()][index]
      if (!productSnapshots[index].exists() || product.published !== true) throw new Error('Um produto da sacola não está mais disponível. Atualize o catálogo.')
      const quantity = quantities.get(productId)
      const unitPrice = Number(product.price)
      if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new Error('O preço de um produto está inválido. Fale com a Print Caju.')
      const availableQuantity = product.hasInventory ? Math.max(0, Math.floor(Number(product.quantity) || 0)) : quantity
      const scheduledQuantity = Math.max(0, quantity - availableQuantity)
      total += unitPrice * quantity
      orderItems.push({
        ...(product.hasInventory ? { productId } : {}),
        description: String(product.name || 'Produto').slice(0, 120),
        quantity,
        unitPrice,
        scheduledPurchase: scheduledQuantity > 0,
        scheduledQuantity,
      })
    }

    const scheduledItems = orderItems.filter((item) => item.scheduledPurchase)
    const scheduledSummary = scheduledItems.map((item) => `${item.description}: ${item.scheduledQuantity} unidade(s)`).join(', ')
    const customer = clientSnapshot.data()
    const soldAt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(new Date())
    transaction.set(saleRef, {
      source: 'website',
      channel: 'website',
      status: 'active',
      orderApprovalStatus: 'pending',
      scheduledPurchase: scheduledItems.length > 0,
      inventoryApplied: false,
      clientId,
      client: {
        name: String(customer.name || '').slice(0, 120),
        email: normalizedEmail,
        phone: String(customer.phone || '').slice(0, 30),
        taxId: String(customer.taxId || '').slice(0, 24),
      },
      items: orderItems,
      soldAt,
      total,
      discount: 0,
      fees: 0,
      extraAmount: 0,
      receivedAmount: 0,
      outstandingAmount: total,
      paymentStatus: 'pending',
      paymentMethod: 'outro',
      deliveryMethod: 'delivery',
      delivery: {
        address: String(customer.address || '').slice(0, 180),
        city: String(customer.city || '').slice(0, 80),
        state: String(customer.state || '').slice(0, 2),
        postalCode: String(customer.postalCode || '').slice(0, 12),
      },
      deliveryStatus: 'pending',
      productionStatus: 'not_started',
      orderType: 'physical',
      notes: `Solicitação enviada pelo site. Aguardando confirmação da Print Caju.${scheduledSummary ? ` Compra agendada, aguardando reposição: ${scheduledSummary}.` : ''}`,
      customerAuthUid: uid,
      createdBy: 'website-customer',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return { id: saleId, total }
  })

  return {
    orderId: sale.id,
    total: sale.total,
    orderCode: sale.id.slice(0, 7).toUpperCase(),
    whatsapp: String(contentSnapshot.data()?.whatsapp || '5584987115381').replace(/\D/g, ''),
  }
}
