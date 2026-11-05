import { collection, deleteDoc, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '../firebase/config.js'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { firebaseApp } from '../firebase/config.js'
import { publicSiteProductData } from '../site.js'

const functions = getFunctions(firebaseApp, 'southamerica-east1')

export async function createPublicOrderFormLink(saleId) {
  return (await httpsCallable(functions, 'createPublicOrderForm')({ saleId })).data.token
}

export async function createCustomerRegistrationFormLink(uid) {
  return (await httpsCallable(functions, 'createCustomerRegistrationForm')({ uid })).data.token
}

export async function loadPublicOrderForm(token) {
  return (await httpsCallable(functions, 'getPublicOrderForm')({ token })).data
}

export async function submitPublicOrderForm(token, profile) {
  return (await httpsCallable(functions, 'submitPublicOrderForm')({ token, profile })).data
}

export async function submitWebsiteCustomerRegistration(profile) {
  return (await httpsCallable(functions, 'submitWebsiteCustomerRegistration')({ profile })).data
}

export async function createCustomerOrderRequest(items, requestId) {
  return (await httpsCallable(functions, 'createCustomerOrderRequest')({ items, requestId })).data
}

function salesCollection(uid) {
  return collection(db, 'users', uid, 'externalSales')
}

export function watchExternalSales(uid, onRows, onError) {
  const salesQuery = query(salesCollection(uid), orderBy('soldAt', 'desc'))
  return onSnapshot(salesQuery, (snapshot) => {
    onRows(snapshot.docs.map((sale) => ({ id: sale.id, ...sale.data() })))
  }, onError)
}

export function watchQuotes(uid, onRows, onError) {
  return onSnapshot(query(collection(db, 'users', uid, 'quotes'), orderBy('createdAt', 'desc')), (snapshot) => {
    onRows(snapshot.docs.map((quote) => ({ id: quote.id, ...quote.data() })))
  }, onError)
}

export function createQuote(uid, quote, createdBy = uid) {
  const quoteRef = doc(collection(db, 'users', uid, 'quotes'))
  return setDoc(quoteRef, {
    ...quote,
    quoteNumber: `ORC-${quoteRef.id.slice(0, 8).toUpperCase()}`,
    status: 'open',
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export function updateQuote(uid, quoteId, quote) {
  return updateDoc(doc(db, 'users', uid, 'quotes', quoteId), {
    ...quote,
    updatedAt: serverTimestamp(),
  })
}

export function createExternalSale(uid, sale, createdBy = uid) {
  const saleRef = doc(salesCollection(uid))
  return runTransaction(db, async (transaction) => {
    await adjustProductDeltas(transaction, uid, inventoryDeltas(sale.items, -1), `Venda #${saleRef.id.slice(0, 7).toUpperCase()}`, saleRef.id)
    transaction.set(saleRef, {
      ...sale, source: 'manual', status: 'active', createdBy, inventoryApplied: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
    return saleRef.id
  })
}

export function approveWebsiteOrder(uid, saleId) {
  const saleRef = doc(db, 'users', uid, 'externalSales', saleId)
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(saleRef)
    if (!snapshot.exists()) throw new Error('A solicitação de compra não foi encontrada.')
    const sale = snapshot.data()
    if (sale.source !== 'website' || sale.orderApprovalStatus !== 'pending') {
      throw new Error('Esta solicitação já foi confirmada ou não pode ser aprovada.')
    }
    const physicalItems = (Array.isArray(sale.items) ? sale.items : []).filter((item) => item?.productId)
    const productSnapshots = await Promise.all(physicalItems.map((item) => transaction.get(doc(db, 'users', uid, 'products', item.productId))))
    for (let index = 0; index < physicalItems.length; index += 1) {
      const product = productSnapshots[index].data()
      if (!productSnapshots[index].exists()) {
        throw new Error(`O produto ${physicalItems[index].description || ''} não existe mais no estoque.`)
      }
      if (Number(product.price) !== Number(physicalItems[index].unitPrice)) {
        throw new Error(`O preço de ${product.name || physicalItems[index].description} mudou desde a solicitação. Revise o pedido antes de confirmar.`)
      }
    }
    await adjustProductDeltas(
      transaction,
      uid,
      inventoryDeltas(sale.items, -1),
      `Pedido do site #${saleId.slice(0, 7).toUpperCase()}`,
      saleId,
    )
    transaction.update(saleRef, {
      orderApprovalStatus: 'approved',
      inventoryApplied: true,
      notes: `${String(sale.notes || '').trim()}\nPedido aprovado pela Print Caju.`,
      updatedAt: serverTimestamp(),
    })
  })
}

export function convertQuoteToSale(uid, quoteId, sale, createdBy = uid) {
  const quoteRef = doc(db, 'users', uid, 'quotes', quoteId)
  const saleRef = doc(collection(db, 'users', uid, 'externalSales'))
  return runTransaction(db, async (transaction) => {
    const quoteSnapshot = await transaction.get(quoteRef)
    if (!quoteSnapshot.exists()) throw new Error('O orçamento não foi encontrado.')
    if (quoteSnapshot.data().status !== 'open') throw new Error('Este orçamento já foi convertido ou encerrado.')
    await adjustProductDeltas(transaction, uid, inventoryDeltas(sale.items, -1), `Venda #${saleRef.id.slice(0, 7).toUpperCase()} (orçamento)`, saleRef.id)
    transaction.update(quoteRef, { status: 'converted', saleId: saleRef.id, convertedAt: serverTimestamp(), updatedAt: serverTimestamp() })
    transaction.set(saleRef, {
      ...sale,
      source: 'quote',
      quoteId,
      status: 'active',
      createdBy,
      inventoryApplied: true,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return saleRef.id
  })
}

export function restoreConvertedQuoteSale(uid, quoteId, createdBy = uid) {
  const quoteRef = doc(db, 'users', uid, 'quotes', quoteId)
  const saleRef = doc(collection(db, 'users', uid, 'externalSales'))
  const missingSaleRef = (saleId) => saleId ? doc(db, 'users', uid, 'externalSales', saleId) : null
  return runTransaction(db, async (transaction) => {
    const quoteSnapshot = await transaction.get(quoteRef)
    if (!quoteSnapshot.exists() || quoteSnapshot.data().status !== 'converted') throw new Error('Este orçamento não está marcado como convertido.')
    const quote = quoteSnapshot.data()
    const oldSaleRef = missingSaleRef(quote.saleId)
    if (oldSaleRef && (await transaction.get(oldSaleRef)).exists()) throw new Error('A venda vinculada a este orçamento ainda existe; atualize a lista de vendas.')
    const total = Number(quote.total) || 0
    await adjustProductDeltas(transaction, uid, inventoryDeltas(quote.items, -1), `Venda #${saleRef.id.slice(0, 7).toUpperCase()} (restaurada do orçamento)`, saleRef.id)
    transaction.set(saleRef, {
      ...quote,
      source: 'quote', quoteId, status: 'active', createdBy,
      soldAt: quote.quoteDate || new Date().toISOString().slice(0, 10),
      receivedAmount: 0, outstandingAmount: total, paymentStatus: 'pending', paymentMethod: 'dinheiro',
      productionStatus: 'not_started', deliveryStatus: 'pending',
      restoredFromMissingSale: true,
      inventoryApplied: true,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
    transaction.update(quoteRef, { saleId: saleRef.id, restoredAt: serverTimestamp(), updatedAt: serverTimestamp() })
    return saleRef.id
  })
}

export function updateExternalSale(uid, saleId, sale) {
  const saleRef = doc(db, 'users', uid, 'externalSales', saleId)
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(saleRef)
    if (!snapshot.exists()) throw new Error('A venda não foi encontrada.')
    const current = snapshot.data()
    let inventoryApplied = current.inventoryApplied === true
    if (Object.prototype.hasOwnProperty.call(sale, 'items') && current.status !== 'cancelled') {
      const delta = inventoryApplied
        ? differenceDeltas(current.items, sale.items)
        : inventoryDeltas(sale.items, -1)
      await adjustProductDeltas(transaction, uid, delta, `Ajuste da venda #${saleId.slice(0, 7).toUpperCase()}`, saleId)
      inventoryApplied = true
    }
    transaction.update(saleRef, { ...sale, inventoryApplied, updatedAt: serverTimestamp() })
  })
}

export function cancelExternalSale(uid, saleId) {
  const saleRef = doc(db, 'users', uid, 'externalSales', saleId)
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(saleRef)
    if (!snapshot.exists()) throw new Error('A venda não foi encontrada.')
    const sale = snapshot.data()
    if (sale.inventoryApplied) await adjustProductDeltas(transaction, uid, inventoryDeltas(sale.items, 1), `Cancelamento da venda #${saleId.slice(0, 7).toUpperCase()}`, saleId)
    transaction.update(saleRef, { status: 'cancelled', inventoryApplied: false, cancelledAt: serverTimestamp(), updatedAt: serverTimestamp() })
  })
}

export function deleteExternalSale(uid, saleId) {
  const saleRef = doc(db, 'users', uid, 'externalSales', saleId)
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(saleRef)
    if (!snapshot.exists()) return
    const sale = snapshot.data()
    if (sale.inventoryApplied) await adjustProductDeltas(transaction, uid, inventoryDeltas(sale.items, 1), `Exclusão da venda #${saleId.slice(0, 7).toUpperCase()}`, saleId)
    transaction.delete(saleRef)
  })
}

function inventoryDeltas(items = [], multiplier) {
  const deltas = new Map()
  for (const item of items || []) {
    if (!item?.productId) continue
    const quantity = Number(item.quantity)
    if (!Number.isFinite(quantity) || quantity <= 0) continue
    deltas.set(item.productId, (deltas.get(item.productId) || 0) + quantity * multiplier)
  }
  return deltas
}

function differenceDeltas(oldItems = [], newItems = []) {
  const oldQuantities = inventoryDeltas(oldItems, 1)
  const newQuantities = inventoryDeltas(newItems, 1)
  const deltas = new Map()
  for (const productId of new Set([...oldQuantities.keys(), ...newQuantities.keys()])) {
    const delta = (oldQuantities.get(productId) || 0) - (newQuantities.get(productId) || 0)
    if (delta) deltas.set(productId, delta)
  }
  return deltas
}

async function adjustProductDeltas(transaction, uid, deltas, reason, saleId) {
  const rows = [...deltas].filter(([, delta]) => delta).map(([productId, delta]) => ({
    productId, delta, ref: doc(db, 'users', uid, 'products', productId), movementRef: doc(collection(db, 'users', uid, 'stockMovements')),
  }))
  const snapshots = await Promise.all(rows.map((row) => transaction.get(row.ref)))
  const updates = rows.map((row, index) => {
    const snapshot = snapshots[index]
    if (!snapshot.exists()) throw new Error(`O produto ${row.productId} desta venda não existe mais no estoque.`)
    const product = snapshot.data()
    const before = Number(product.quantity) || 0
    const after = before + row.delta
    if (after < 0) throw new Error(`Estoque insuficiente para ${product.name || 'um produto'}: disponível ${before}, solicitado ${Math.abs(row.delta)}.`)
    return { ...row, product, productName: product.name || 'Produto', before, after }
  })
  for (const row of updates) {
    transaction.update(row.ref, { quantity: row.after, updatedAt: serverTimestamp() })
    if (row.product.active !== false) transaction.set(doc(db, 'publicSiteProducts', row.productId), publicSiteProductData({ ...row.product, quantity: row.after }))
    transaction.set(row.movementRef, {
      productId: row.productId, productName: row.productName, delta: row.delta,
      before: row.before, after: row.after, reason, saleId, createdAt: serverTimestamp(),
    })
  }
}

export function cancelQuote(uid, quoteId) {
  return updateDoc(doc(db, 'users', uid, 'quotes', quoteId), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export function deleteQuote(uid, quoteId) {
  return deleteDoc(doc(db, 'users', uid, 'quotes', quoteId))
}
