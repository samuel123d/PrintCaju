import { collection, doc, onSnapshot, orderBy, query, runTransaction, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '../firebase/config.js'
import { publicSiteProductData } from '../site.js'

const productCollection = (uid) => collection(db, 'users', uid, 'products')

export function watchProducts(uid, onRows, onError) {
  return onSnapshot(query(productCollection(uid), orderBy('name')), (snapshot) => {
    onRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
  }, onError)
}

export function createProduct(uid, product) {
  const productRef = doc(productCollection(uid))
  const sku = String(product.sku || '').trim() || (product.type === 'fisico' ? `FIS-${productRef.id.slice(0, 8).toUpperCase()}` : '')
  const data = {
    ...product,
    sku,
    active: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  const batch = writeBatch(db)
  batch.set(productRef, data)
  batch.set(doc(db, 'publicSiteProducts', productRef.id), publicSiteProductData(data))
  return batch.commit()
}

export function createPhysicalProductsBatch(uid, products) {
  if (!uid || !products?.length || products.length > 150) throw new Error('Adicione de 1 a 150 produtos para continuar.')
  const batch = writeBatch(db)
  const createdAt = serverTimestamp()
  const today = new Date()
  const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  let writeCount = 0
  let expenseTotal = 0
  let businessCashTotal = 0
  let investmentFundsTotal = 0
  for (const input of products) {
    if (!['business_cash', 'investment_funds'].includes(input.fundingSource)) throw new Error('Selecione de qual saldo saiu o valor do estoque inicial de cada produto.')
    const productRef = doc(productCollection(uid))
    const movementRef = doc(collection(db, 'users', uid, 'stockMovements'))
    const quantity = Number(input.quantity)
    const cost = Number(input.cost) || 0
    const stockValue = Number((quantity * cost).toFixed(2))
    if (!Number.isFinite(stockValue)) throw new Error('O custo total do estoque inicial está fora do intervalo permitido.')
    const price = Number(input.price) || 0
    const minStock = Number(input.minStock) || 0
    const sku = `FIS-${productRef.id.slice(0, 8).toUpperCase()}`
    const product = {
      name: String(input.name).trim(), sku, type: 'fisico', category: '', description: '',
      cost, price, suggestedPrice: null, quantity, minStock, recipe: [],
      filamentMaterialId: '', filamentMaterialName: '', filamentColor: '#000000', filamentGrams: 0,
      filamentUnitCost: 0, filamentCost: 0, otherFixedCost: cost, energyCost: 0, manualEnergyCost: 0,
      printHours: 0, electricityRate: 0, laborHours: 0, laborRate: 0, marginPercent: 50, feePercent: 0,
      active: true, createdAt, updatedAt: createdAt,
    }
    product.initialStockFundingSource = input.fundingSource
    product.initialStockValue = stockValue
    batch.set(productRef, product)
    batch.set(doc(db, 'publicSiteProducts', productRef.id), publicSiteProductData(product))
    writeCount += 2
    if (quantity > 0) batch.set(movementRef, {
      productId: productRef.id, productName: String(input.name).trim(), delta: quantity,
      before: 0, after: quantity, reason: 'Saldo inicial (cadastro rápido)', createdAt,
    })
    if (quantity > 0) writeCount += 1
    if (stockValue > 0) {
      const expenseRef = doc(collection(db, 'users', uid, 'financialTransactions'))
      batch.set(expenseRef, {
        type: 'expense',
        date,
        description: `Estoque inicial: ${String(input.name).trim()}`,
        category: 'investment',
        amount: stockValue,
        paymentMethod: 'other',
        paymentStatus: 'paid',
        fundingSource: input.fundingSource,
        notes: `Cadastro de ${quantity} unidade(s) a ${cost.toFixed(2)} cada.`,
        status: 'active',
        sourcePhysicalProductId: productRef.id,
        createdAt,
        updatedAt: createdAt,
      })
      writeCount += 1
      expenseTotal += stockValue
      if (input.fundingSource === 'investment_funds') investmentFundsTotal += stockValue
      else businessCashTotal += stockValue
    }
  }
  if (writeCount > 500) throw new Error('Este lote excede o limite de gravações. Cadastre menos produtos por vez.')
  return batch.commit().then(() => ({ count: products.length, expenseTotal, businessCashTotal, investmentFundsTotal }))
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
      return { ...row, product, productName: product.name, before, after: before + row.total, existingColors: product.filamentColors || (product.filamentColor ? [product.filamentColor] : []) }
    })
    for (const row of updates) {
      const colors = [...new Set([...row.existingColors, ...row.colors.flatMap((item) => item.colors)])]
      const updatedProduct = { ...row.product, quantity: row.after }
      transaction.update(row.productRef, { quantity: row.after, filamentColor: row.colors.at(-1).colors.at(-1), filamentColors: colors, updatedAt: serverTimestamp() })
      transaction.set(doc(db, 'publicSiteProducts', row.productId), publicSiteProductData(updatedProduct))
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
  const batch = writeBatch(db)
  batch.update(doc(db, 'users', uid, 'products', productId), { ...product, sku, updatedAt: serverTimestamp() })
  const publicRef = doc(db, 'publicSiteProducts', productId)
  if (product.active === false) batch.delete(publicRef)
  else batch.set(publicRef, publicSiteProductData({ ...product, sku, active: true }))
  return batch.commit()
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
    const updatedProduct = { ...snapshot.data(), quantity: after }
    transaction.update(productRef, { quantity: after, updatedAt: serverTimestamp() })
    if (snapshot.data().active !== false) transaction.set(doc(db, 'publicSiteProducts', productId), publicSiteProductData(updatedProduct))
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
  const batch = writeBatch(db)
  batch.update(doc(db, 'users', uid, 'products', productId), { active: false, updatedAt: serverTimestamp() })
  batch.delete(doc(db, 'publicSiteProducts', productId))
  return batch.commit()
}

export function deleteArchivedProduct(uid, productId) {
  const batch = writeBatch(db)
  batch.delete(doc(db, 'users', uid, 'products', productId))
  batch.delete(doc(db, 'publicSiteProducts', productId))
  return batch.commit()
}
