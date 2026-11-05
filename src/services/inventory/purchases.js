import { collection, deleteDoc, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase/config.js'
import { publicSiteProductData } from '../site.js'

const purchasesCollection = (uid) => collection(db, 'users', uid, 'purchases')

export function watchPurchases(uid, onRows, onError) {
  return onSnapshot(query(purchasesCollection(uid), orderBy('date', 'desc')), (snapshot) => {
    onRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
  }, onError)
}

export function createPurchase(uid, purchase) {
  const purchaseRef = doc(purchasesCollection(uid))
  const productRef = doc(db, 'users', uid, 'products', purchase.productId)
  const movementRef = doc(collection(db, 'users', uid, 'stockMovements'))
  return runTransaction(db, async (transaction) => {
    const product = await transaction.get(productRef)
    if (!product.exists()) throw new Error('Produto não encontrado.')
    const before = Number(product.data().quantity) || 0
    const after = before + purchase.quantity
    transaction.update(productRef, { quantity: after, updatedAt: serverTimestamp() })
    if (product.data().active !== false) transaction.set(doc(db, 'publicSiteProducts', purchase.productId), publicSiteProductData({ ...product.data(), quantity: after }))
    transaction.set(movementRef, { productId: purchase.productId, productName: product.data().name, delta: purchase.quantity, before, after, reason: `Compra${purchase.supplier ? ` · ${purchase.supplier}` : ''}`, purchaseId: purchaseRef.id, createdAt: serverTimestamp() })
    transaction.set(purchaseRef, { ...purchase, productName: product.data().name, status: 'active', createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
    return purchaseRef.id
  })
}

export function addPurchaseToExpenses(uid, purchaseId, createdBy = uid) {
  const purchaseRef = doc(db, 'users', uid, 'purchases', purchaseId)
  const expenseRef = doc(collection(db, 'users', uid, 'financialTransactions'))
  return runTransaction(db, async (transaction) => {
    const purchase = await transaction.get(purchaseRef)
    if (!purchase.exists()) throw new Error('Compra não encontrada.')
    const data = purchase.data()
    if (data.expenseId) return data.expenseId
    transaction.set(expenseRef, {
      type: 'expense', date: data.date, description: `Compra: ${data.productName}`,
      category: 'materials', amount: data.total, paymentMethod: data.paymentMethod || 'other',
      notes: [data.supplier && `Fornecedor: ${data.supplier}`, data.notes, `Compra ${purchaseId}`].filter(Boolean).join(' · '),
      status: 'active', createdBy, sourcePurchaseId: purchaseId, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
    transaction.update(purchaseRef, { expenseId: expenseRef.id, expenseCreatedAt: serverTimestamp(), updatedAt: serverTimestamp() })
    return expenseRef.id
  })
}

export function deleteLegacyPurchaseFromHistory(uid, transactionId) {
  const expenseRef = doc(db, 'users', uid, 'financialTransactions', transactionId)
  return runTransaction(db, async (transaction) => {
    const expenseSnapshot = await transaction.get(expenseRef)
    if (!expenseSnapshot.exists()) throw new Error('O lançamento financeiro não foi encontrado.')
    const expense = expenseSnapshot.data()
    if (!expense.sourcePurchaseId) throw new Error('Este lançamento não está vinculado a uma compra de produto.')
    const purchaseRef = doc(db, 'users', uid, 'purchases', expense.sourcePurchaseId)
    const purchaseSnapshot = await transaction.get(purchaseRef)
    if (!purchaseSnapshot.exists()) throw new Error('A compra vinculada ao estoque não foi encontrada.')
    const purchase = purchaseSnapshot.data()
    const productRef = doc(db, 'users', uid, 'products', purchase.productId)
    const productSnapshot = await transaction.get(productRef)
    if (!productSnapshot.exists()) throw new Error('O produto vinculado à compra não foi encontrado.')
    const currentQuantity = Number(productSnapshot.data().quantity) || 0
    const purchasedQuantity = Number(purchase.quantity) || 0
    const nextQuantity = currentQuantity - purchasedQuantity
    if (!Number.isFinite(purchasedQuantity) || purchasedQuantity <= 0 || nextQuantity < 0) {
      throw new Error('O estoque atual já foi consumido ou ajustado. Não é seguro excluir esta compra.')
    }
    transaction.update(productRef, { quantity: nextQuantity, updatedAt: serverTimestamp() })
    if (productSnapshot.data().active !== false) transaction.set(doc(db, 'publicSiteProducts', purchase.productId), publicSiteProductData({ ...productSnapshot.data(), quantity: nextQuantity }))
    transaction.delete(purchaseRef)
    transaction.delete(expenseRef)
  })
}
