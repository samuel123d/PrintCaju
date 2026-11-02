import { collection, deleteDoc, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch } from 'firebase/firestore'
import { db } from '../firebase/config.js'

const productCollection = (uid) => collection(db, 'users', uid, 'products')

export function watchProducts(uid, onRows, onError) {
  return onSnapshot(query(productCollection(uid), orderBy('name')), (snapshot) => {
    onRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
  }, onError)
}

export function createProduct(uid, product) {
  const productRef = doc(productCollection(uid))
  const sku = String(product.sku || '').trim() || (product.type === 'fisico' ? `FIS-${productRef.id.slice(0, 8).toUpperCase()}` : '')
  return setDoc(productRef, {
    ...product,
    sku,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
}

export function createPhysicalProductsBatch(uid, products) {
  if (!uid || !products?.length || products.length > 200) throw new Error('Adicione de 1 a 200 produtos para continuar.')
  const batch = writeBatch(db)
  const createdAt = serverTimestamp()
  for (const input of products) {
    const productRef = doc(productCollection(uid))
    const movementRef = doc(collection(db, 'users', uid, 'stockMovements'))
    const quantity = Number(input.quantity)
    const cost = Number(input.cost) || 0
    const price = Number(input.price) || 0
    const minStock = Number(input.minStock) || 0
    const sku = `FIS-${productRef.id.slice(0, 8).toUpperCase()}`
    batch.set(productRef, {
      name: String(input.name).trim(), sku, type: 'fisico', category: '', description: '',
      cost, price, suggestedPrice: null, quantity, minStock, recipe: [],
      filamentMaterialId: '', filamentMaterialName: '', filamentColor: '#000000', filamentGrams: 0,
      filamentUnitCost: 0, filamentCost: 0, otherFixedCost: cost, energyCost: 0, manualEnergyCost: 0,
      printHours: 0, electricityRate: 0, laborHours: 0, laborRate: 0, marginPercent: 50, feePercent: 0,
      active: true, createdAt, updatedAt: createdAt,
    })
    if (quantity > 0) batch.set(movementRef, {
      productId: productRef.id, productName: String(input.name).trim(), delta: quantity,
      before: 0, after: quantity, reason: 'Saldo inicial (cadastro rápido)', createdAt,
    })
  }
  return batch.commit()
}

export function restockProductsBatch(uid, entries, reason = 'Reposi??o de estoque') {
  const grouped = new Map()
  for (const entry of entries || []) {
    const quantity = Number(entry.quantity)
    if (!entry.productId || !Number.isInteger(quantity) || quantity < 1) throw new Error('Selecione um produto e informe uma quantidade inteira maior que zero.')
    const productEntries = grouped.get(entry.productId) || []
    const rawColors = Array.isArray(entry.colors) ? entry.colors : [entry.color || '#000000']
    const colors = [...new Set(rawColors.map((color) => String(color).toUpperCase()).filter((color) => /^#[0-9A-F]{6}$/.test(color)))]
    if (!colors.length) throw new Error('Escolha pelo menos uma cor para cada combinação de peças.')
    productEntries.push({ quantity, colors, movementRef: doc(collection(db, 'users', uid, 'stockMovements')) })
    grouped.set(entry.productId, productEntries)
  }
  if (!grouped.size || grouped.size > 200) throw new Error('Adicione de 1 a 200 produtos para repor.')
  return runTransaction(db, async (transaction) => {
    const rows = [...grouped].map(([productId, colors]) => ({
      productId, colors, total: colors.reduce((sum, item) => sum + item.quantity, 0),
      productRef: doc(db, 'users', uid, 'products', productId),
    }))
    const snapshots = await Promise.all(rows.map((row) => transaction.get(row.productRef)))
    const updates = rows.map((row, index) => {
      const snapshot = snapshots[index]
      if (!snapshot.exists() || snapshot.data().active === false || snapshot.data().type !== 'fisico') throw new Error('Um dos produtos escolhidos n?o est? ativo no estoque f?sico.')
      const product = snapshot.data()
      const before = Number(product.quantity) || 0
      return { ...row, productName: product.name, before, after: before + row.total, existingColors: product.filamentColors || (product.filamentColor ? [product.filamentColor] : []) }
    })
    for (const row of updates) {
      const colors = [...new Set([...row.existingColors, ...row.colors.flatMap((item) => item.colors)])]
      transaction.update(row.productRef, { quantity: row.after, filamentColor: row.colors.at(-1).colors.at(-1), filamentColors: colors, updatedAt: serverTimestamp() })
      let movementBefore = row.before
      for (const item of row.colors) {
        transaction.set(item.movementRef, {
          productId: row.productId, productName: row.productName, delta: item.quantity,
          before: movementBefore, after: movementBefore + item.quantity, colors: item.colors,
          ...(item.colors.length === 1 ? { color: item.colors[0] } : {}),
          reason: String(reason || 'Reposi??o de estoque').trim().slice(0, 160), createdAt: serverTimestamp(),
        })
        movementBefore += item.quantity
      }
    }
    return updates.length
  })
}

export function updateProduct(uid, productId, product) {
  const sku = String(product.sku || '').trim() || (product.type === 'fisico' ? `FIS-${productId.slice(0, 8).toUpperCase()}` : '')
  return updateDoc(doc(db, 'users', uid, 'products', productId), { ...product, sku, updatedAt: serverTimestamp() })
}

export function adjustProductStock(uid, productId, delta, reason) {
  const productRef = doc(db, 'users', uid, 'products', productId)
  const movementRef = doc(collection(db, 'users', uid, 'stockMovements'))
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(productRef)
    if (!snapshot.exists()) throw new Error('O produto não foi encontrado.')
    const before = Number(snapshot.data().quantity) || 0
    const after = before + Number(delta)
    if (after < 0) throw new Error('O saldo não pode ficar negativo.')
    transaction.update(productRef, { quantity: after, updatedAt: serverTimestamp() })
    transaction.set(movementRef, {
      productId,
      productName: snapshot.data().name,
      delta: Number(delta),
      before,
      after,
      reason: String(reason || '').trim(),
      createdAt: serverTimestamp(),
    })
    return after
  })
}

export function archiveProduct(uid, productId) {
  return updateDoc(doc(db, 'users', uid, 'products', productId), { active: false, updatedAt: serverTimestamp() })
}

export function deleteArchivedProduct(uid, productId) {
  return deleteDoc(doc(db, 'users', uid, 'products', productId))
}
