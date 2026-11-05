import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, orderBy, query, serverTimestamp, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '../firebase/config.js'

const transactionsCollection = (uid) => collection(db, 'users', uid, 'financialTransactions')

export function watchFinancialTransactions(uid, onRows, onError) {
  return onSnapshot(query(transactionsCollection(uid), orderBy('date', 'desc')), (snapshot) => {
    onRows(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() })))
  }, onError)
}

export function createFinancialTransaction(uid, transaction, createdBy = uid) {
  return addDoc(transactionsCollection(uid), {
    ...transaction,
    status: 'active',
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export function updateFinancialTransaction(uid, transactionId, transaction) {
  return updateDoc(doc(db, 'users', uid, 'financialTransactions', transactionId), {
    ...transaction,
    updatedAt: serverTimestamp(),
  })
}

export async function reclassifyMaterialExpensesAsInvestments(uid) {
  if (!uid) throw new Error('Não foi possível identificar a conta do Financeiro.')
  const snapshot = await getDocs(transactionsCollection(uid))
  const entries = snapshot.docs.filter((item) => {
    const data = item.data()
    return data.type === 'expense'
      && ['materials', 'packaging'].includes(data.category)
      && data.status !== 'cancelled'
  })

  for (let start = 0; start < entries.length; start += 450) {
    const batch = writeBatch(db)
    entries.slice(start, start + 450).forEach((item) => {
      batch.update(item.ref, {
        category: 'investment',
        paymentStatus: 'paid',
        fundingSource: 'business_cash',
        investmentMaterialPurchase: true,
        updatedAt: serverTimestamp(),
      })
    })
    await batch.commit()
  }

  return entries.length
}

export function voidFinancialTransaction(uid, transactionId) {
  return updateDoc(doc(db, 'users', uid, 'financialTransactions', transactionId), {
    status: 'cancelled',
    cancelledAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export function deleteFinancialTransaction(uid, transactionId) {
  return deleteDoc(doc(db, 'users', uid, 'financialTransactions', transactionId))
}
