import { collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, orderBy, query, runTransaction, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { db } from '../firebase/config.js'
import { calculatePurchaseBaseQuantity, purchaseUnits } from './units.js'
import { calculateWeightedUnitCost } from './costing.js'

const materialsCollection = (uid) => collection(db, 'users', uid, 'materials')

export function archiveMaterial(uid, materialId) {
  return updateDoc(doc(db, 'users', uid, 'materials', materialId), { active: false, updatedAt: serverTimestamp() })
}

export function restoreMaterial(uid, materialId) {
  return updateDoc(doc(db, 'users', uid, 'materials', materialId), { active: true, updatedAt: serverTimestamp() })
}

export async function deleteArchivedMaterial(uid, materialId) {
  const purchases = await getDocs(query(
    collection(db, 'users', uid, 'materialPurchases'),
    where('materialId', '==', materialId),
  ))
  if (!purchases.empty) throw new Error('Este material ainda tem compras no histórico. Exclua primeiro os lançamentos vinculados no Financeiro para preservar os saldos.')
  return deleteDoc(doc(db, 'users', uid, 'materials', materialId))
}

export function watchMaterials(uid, onRows, onError) {
  return onSnapshot(query(materialsCollection(uid), orderBy('name')), (snapshot) => {
    onRows(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })))
  }, onError)
}

export function updateMaterialStock(uid, materialId, stockQuantity, minStock, createdBy = uid) {
  const materialRef = doc(db, 'users', uid, 'materials', materialId)
  const movementRef = doc(collection(db, 'users', uid, 'materialStockMovements'))
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(materialRef)
    if (!snapshot.exists()) throw new Error('O material não foi encontrado.')
    const current = snapshot.data()
    const before = Number(current.stockQuantity) || 0
    const quantity = Number(stockQuantity)
    const minimum = Number(minStock)
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('O saldo precisa ser um número igual ou maior que zero.')
    if (!Number.isFinite(minimum) || minimum < 0) throw new Error('O estoque mínimo precisa ser um número igual ou maior que zero.')
    transaction.update(materialRef, { stockQuantity: quantity, minStock: minimum, updatedAt: serverTimestamp() })
    transaction.set(movementRef, {
      materialId,
      materialName: current.name,
      before,
      after: quantity,
      delta: quantity - before,
      reason: 'Ajuste manual de saldo',
      createdBy,
      createdAt: serverTimestamp(),
    })
  })
}

export async function loadMaterialPurchaseForTransaction(uid, transactionId) {
  const expenseRef = doc(db, 'users', uid, 'financialTransactions', transactionId)
  const expenseSnapshot = await getDoc(expenseRef)
  if (!expenseSnapshot.exists()) throw new Error('O lançamento financeiro não foi encontrado.')
  const expense = expenseSnapshot.data()
  if (!expense.sourceMaterialPurchaseId) throw new Error('Este lançamento não está vinculado a uma compra de material.')
  const purchaseRef = doc(db, 'users', uid, 'materialPurchases', expense.sourceMaterialPurchaseId)
  const purchaseSnapshot = await getDoc(purchaseRef)
  if (!purchaseSnapshot.exists()) throw new Error('A compra vinculada ao estoque não foi encontrada.')
  return { ...purchaseSnapshot.data(), id: purchaseSnapshot.id }
}

export function updateMaterialPurchaseFromHistory(uid, transactionId, packageQuantity, packageUnit, dimensions = {}, updatedBy = uid, materialName = '') {
  const expenseRef = doc(db, 'users', uid, 'financialTransactions', transactionId)
  return runTransaction(db, async (transaction) => {
    const expenseSnapshot = await transaction.get(expenseRef)
    if (!expenseSnapshot.exists()) throw new Error('O lançamento financeiro não foi encontrado.')
    const expense = expenseSnapshot.data()
    if (!expense.sourceMaterialPurchaseId || expense.status === 'cancelled') throw new Error('Esta compra não está ativa no estoque.')
    const purchaseRef = doc(db, 'users', uid, 'materialPurchases', expense.sourceMaterialPurchaseId)
    const purchaseSnapshot = await transaction.get(purchaseRef)
    if (!purchaseSnapshot.exists()) throw new Error('A compra vinculada ao estoque não foi encontrada.')
    const purchase = purchaseSnapshot.data()
    const materialRef = doc(db, 'users', uid, 'materials', purchase.materialId)
    const materialSnapshot = await transaction.get(materialRef)
    if (!materialSnapshot.exists()) throw new Error('O material vinculado à compra não foi encontrado.')
    const material = materialSnapshot.data()
    const selectedUnit = purchaseUnits.find((item) => item.value === packageUnit)
    const quantity = Number(packageQuantity)
    const name = String(materialName).trim()
    if (!selectedUnit || selectedUnit.baseUnit !== material.baseUnit) throw new Error('A unidade precisa corresponder à unidade cadastrada para este material.')
    if (!name || name.length > 120) throw new Error('Informe um nome de material com até 120 caracteres.')
    if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('A quantidade comprada precisa ser maior que zero.')
    const nextBaseQuantity = calculatePurchaseBaseQuantity(quantity, packageUnit, dimensions)
    const oldBaseQuantity = Number(purchase.baseQuantity) || 0
    const currentStock = Number(material.stockQuantity) || 0
    const nextStock = currentStock - oldBaseQuantity + nextBaseQuantity
    if (!Number.isFinite(nextStock) || nextStock < 0) throw new Error('Não é possível reduzir a compra: o estoque atual já foi ajustado abaixo desse saldo.')
    const averageCost = Number(material.unitCost) || 0
    const purchaseTotal = Number(purchase.total) || Number(expense.amount) || 0
    const nextValue = currentStock * averageCost - oldBaseQuantity * averageCost + purchaseTotal
    const nextUnitCost = nextStock > 0 ? nextValue / nextStock : Number(material.unitCost) || 0
    if (!Number.isFinite(nextUnitCost)) throw new Error('O custo médio calculado está fora do intervalo permitido.')

    transaction.update(materialRef, { name, stockQuantity: nextStock, unitCost: nextUnitCost, updatedAt: serverTimestamp() })
    transaction.update(purchaseRef, {
      materialName: name,
      packageQuantity: quantity,
      packageUnit,
      ...(selectedUnit.dimensions ? {
        packageWidth: Number(dimensions.width),
        packageLength: Number(dimensions.length),
        dimensionUnit: dimensions.dimensionUnit,
      } : {}),
      baseQuantity: nextBaseQuantity,
      baseUnit: selectedUnit.baseUnit,
      updatedAt: serverTimestamp(),
      updatedBy,
    })
    transaction.update(expenseRef, {
      description: `Compra de material: ${name}`,
      notes: `Entrada de ${quantity} ${packageUnit} no estoque de materiais.`,
      updatedAt: serverTimestamp(),
    })
  })
}

export function deleteMaterialPurchaseFromHistory(uid, transactionId) {
  const expenseRef = doc(db, 'users', uid, 'financialTransactions', transactionId)
  return runTransaction(db, async (transaction) => {
    const expenseSnapshot = await transaction.get(expenseRef)
    if (!expenseSnapshot.exists()) throw new Error('O lançamento financeiro não foi encontrado.')
    const expense = expenseSnapshot.data()
    if (!expense.sourceMaterialPurchaseId || expense.status === 'cancelled') throw new Error('Esta compra não está ativa no estoque.')
    const purchaseRef = doc(db, 'users', uid, 'materialPurchases', expense.sourceMaterialPurchaseId)
    const purchaseSnapshot = await transaction.get(purchaseRef)
    if (!purchaseSnapshot.exists()) throw new Error('A compra vinculada ao estoque não foi encontrada.')
    const purchase = purchaseSnapshot.data()
    const materialRef = doc(db, 'users', uid, 'materials', purchase.materialId)
    const materialSnapshot = await transaction.get(materialRef)
    if (!materialSnapshot.exists()) throw new Error('O material vinculado à compra não foi encontrado; não foi possível ajustar o estoque.')
    const material = materialSnapshot.data()
    const currentQuantity = Number(material.stockQuantity) || 0
    const purchasedQuantity = Number(purchase.baseQuantity) || 0
    const nextQuantity = currentQuantity - purchasedQuantity
    if (!Number.isFinite(purchasedQuantity) || purchasedQuantity <= 0 || nextQuantity < -1e-8) {
      throw new Error('O estoque atual já foi consumido ou ajustado. Não é seguro excluir esta compra.')
    }
    const remainingValue = currentQuantity * (Number(material.unitCost) || 0) - (Number(purchase.total) || Number(expense.amount) || 0)
    if (nextQuantity > 0 && remainingValue < -1e-8) {
      throw new Error('Não foi possível recalcular o custo médio com o saldo atual. Ajuste o estoque antes de excluir esta compra.')
    }
    transaction.update(materialRef, {
      stockQuantity: Math.max(0, nextQuantity),
      unitCost: nextQuantity > 1e-8 ? Math.max(0, remainingValue) / nextQuantity : 0,
      updatedAt: serverTimestamp(),
    })
    transaction.delete(purchaseRef)
    transaction.delete(expenseRef)
  })
}

export function createMaterialPurchase(uid, purchase, createdBy = uid, materialId = '') {
  if (!['investment', 'materials'].includes(purchase.financialCategory)) throw new Error('Selecione uma classificação financeira válida.')
  if (!['paid', 'pending'].includes(purchase.paymentStatus)) throw new Error('Selecione uma situação de pagamento válida.')
  if (!['business_cash', 'investment_funds'].includes(purchase.fundingSource)) throw new Error('Selecione de qual saldo saiu o valor da compra.')
  const materialRef = materialId
    ? doc(db, 'users', uid, 'materials', materialId)
    : doc(materialsCollection(uid))
  const purchaseRef = doc(collection(db, 'users', uid, 'materialPurchases'))
  const expenseRef = doc(collection(db, 'users', uid, 'financialTransactions'))

  return runTransaction(db, async (transaction) => {
    if (!Number.isFinite(Number(purchase.packageQuantity)) || Number(purchase.packageQuantity) <= 0) throw new Error('A quantidade comprada precisa ser maior que zero.')
    if (!Number.isFinite(Number(purchase.packageCost)) || Number(purchase.packageCost) <= 0) throw new Error('O valor da compra precisa ser maior que zero.')
    const existing = materialId ? await transaction.get(materialRef) : null
    if (existing && !existing.exists()) throw new Error('O material não foi encontrado.')
    const current = existing?.data()
    const selectedUnit = purchaseUnits.find((item) => item.value === purchase.packageUnit)
    if (!selectedUnit || selectedUnit.baseUnit !== purchase.baseUnit) throw new Error('A unidade da compra não corresponde à unidade base do material.')
    if (current && current.baseUnit !== purchase.baseUnit) throw new Error('Use a mesma unidade de medida cadastrada para este material.')
    const purchasedQuantity = calculatePurchaseBaseQuantity(purchase.packageQuantity, purchase.packageUnit, purchase)
    const previousQuantity = Number(current?.stockQuantity) || 0
    const nextQuantity = previousQuantity + purchasedQuantity
    const unitCost = calculateWeightedUnitCost(previousQuantity, current?.unitCost, purchasedQuantity, purchase.packageCost)
    if (!Number.isFinite(nextQuantity) || !Number.isFinite(unitCost)) throw new Error('O estoque ou o custo calculado está fora do intervalo permitido.')
    const minimumStock = current ? Number(current.minStock) || 0 : Number(purchase.minStock) || 0
    if (!Number.isFinite(minimumStock) || minimumStock < 0) throw new Error('O estoque mínimo não pode ser negativo.')
    const material = {
      name: current?.name || purchase.name.trim(),
      baseUnit: purchase.baseUnit,
      stockQuantity: nextQuantity,
      minStock: minimumStock,
      unitCost,
      active: true,
      updatedAt: serverTimestamp(),
      ...(Object.hasOwn(purchase, 'photoBytes') ? { photoBytes: purchase.photoBytes, photoContentType: purchase.photoContentType } : {}),
    }

    if (current) {
      transaction.update(materialRef, material)
    } else {
      transaction.set(materialRef, { ...material, createdAt: serverTimestamp() })
    }

    transaction.set(purchaseRef, {
      materialId: materialRef.id,
      materialName: material.name,
      date: purchase.date,
      packageQuantity: Number(purchase.packageQuantity),
      packageUnit: purchase.packageUnit,
      ...(selectedUnit.dimensions ? {
        packageWidth: Number(purchase.packageWidth),
        packageLength: Number(purchase.packageLength),
        dimensionUnit: purchase.dimensionUnit,
      } : {}),
      baseQuantity: purchasedQuantity,
      baseUnit: purchase.baseUnit,
      total: Number(purchase.packageCost),
      paymentMethod: purchase.paymentMethod,
      createdBy,
      createdAt: serverTimestamp(),
    })
    transaction.set(expenseRef, {
      type: 'expense',
      date: purchase.date,
      description: `Compra de material: ${material.name}`,
      category: purchase.financialCategory,
      amount: Number(purchase.packageCost),
      paymentMethod: purchase.paymentMethod,
      paymentStatus: purchase.paymentStatus,
      fundingSource: purchase.fundingSource,
      notes: `Entrada de ${purchase.packageQuantity} ${purchase.packageUnit} no estoque de materiais.`,
      status: 'active',
      sourceMaterialPurchaseId: purchaseRef.id,
      createdBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    return materialRef.id
  })
}

export function importHistoricalMaterialPurchase(uid, transactionId, purchase, createdBy = uid, materialId = '') {
  const expenseRef = doc(db, 'users', uid, 'financialTransactions', transactionId)
  const materialRef = materialId
    ? doc(db, 'users', uid, 'materials', materialId)
    : doc(materialsCollection(uid))
  const purchaseRef = doc(collection(db, 'users', uid, 'materialPurchases'))

  return runTransaction(db, async (transaction) => {
    const expenseSnapshot = await transaction.get(expenseRef)
    if (!expenseSnapshot.exists()) throw new Error('O lançamento financeiro não foi encontrado.')
    const expense = expenseSnapshot.data()
    if (expense.type !== 'expense'
      || (!['materials', 'packaging'].includes(expense.category) && expense.investmentMaterialPurchase !== true)
      || expense.status === 'cancelled') {
      throw new Error('Somente despesas ativas das categorias Materiais e insumos ou Embalagens podem ser vinculadas ao estoque.')
    }
    if (expense.sourceMaterialPurchaseId) throw new Error('Este lançamento já foi vinculado ao estoque.')
    if (!Number.isFinite(Number(purchase.packageQuantity)) || Number(purchase.packageQuantity) <= 0) throw new Error('A quantidade comprada precisa ser maior que zero.')
    const packageCost = Number(expense.amount)
    if (!Number.isFinite(packageCost) || packageCost <= 0) throw new Error('O lançamento precisa ter um valor maior que zero.')
    const selectedUnit = purchaseUnits.find((item) => item.value === purchase.packageUnit)
    if (!selectedUnit) throw new Error('Selecione uma unidade de compra válida.')
    if (!materialId && !purchase.name.trim()) throw new Error('Informe o nome do material.')

    const existing = materialId ? await transaction.get(materialRef) : null
    if (existing && !existing.exists()) throw new Error('O material selecionado não foi encontrado.')
    const current = existing?.data()
    if (current && current.baseUnit !== selectedUnit.baseUnit) throw new Error('A unidade de compra não corresponde à unidade base do material selecionado.')
    const purchasedQuantity = calculatePurchaseBaseQuantity(purchase.packageQuantity, purchase.packageUnit, purchase)
    const previousQuantity = Number(current?.stockQuantity) || 0
    const nextQuantity = previousQuantity + purchasedQuantity
    const unitCost = calculateWeightedUnitCost(previousQuantity, current?.unitCost, purchasedQuantity, packageCost)
    if (!Number.isFinite(purchasedQuantity) || purchasedQuantity <= 0 || !Number.isFinite(nextQuantity) || !Number.isFinite(unitCost)) {
      throw new Error('A quantidade ou o custo calculado está fora do intervalo permitido.')
    }

    const material = {
      name: current?.name || purchase.name.trim(),
      baseUnit: selectedUnit.baseUnit,
      stockQuantity: nextQuantity,
      minStock: Number(current?.minStock) || 0,
      unitCost,
      active: true,
      updatedAt: serverTimestamp(),
    }
    if (current) transaction.update(materialRef, material)
    else transaction.set(materialRef, { ...material, createdAt: serverTimestamp() })

    transaction.set(purchaseRef, {
      materialId: materialRef.id,
      materialName: material.name,
      date: expense.date,
      packageQuantity: Number(purchase.packageQuantity),
      packageUnit: purchase.packageUnit,
      ...(selectedUnit.dimensions ? {
        packageWidth: Number(purchase.packageWidth),
        packageLength: Number(purchase.packageLength),
        dimensionUnit: purchase.dimensionUnit,
      } : {}),
      baseQuantity: purchasedQuantity,
      baseUnit: selectedUnit.baseUnit,
      total: packageCost,
      paymentMethod: expense.paymentMethod || 'other',
      sourceTransactionId: transactionId,
      importedFromHistory: true,
      createdBy,
      createdAt: serverTimestamp(),
    })
    transaction.update(expenseRef, {
      sourceMaterialPurchaseId: purchaseRef.id,
      stockImportedAt: serverTimestamp(),
      stockImportedBy: createdBy,
      updatedAt: serverTimestamp(),
    })
    return materialRef.id
  })
}
