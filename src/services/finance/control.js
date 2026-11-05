import { calculateProductCost } from './costing.js'

const valueOf = (value) => Number(value) || 0

function estimateProductCost(product) {
  if (Number.isFinite(Number(product.cost))) return Number(product.cost)
  const recipe = Array.isArray(product.recipe) ? product.recipe : []
  if (!recipe.length && !product.energyCost && !product.laborHours) return null
  return calculateProductCost({
    recipe,
    energyCost: product.energyCost,
    laborHours: product.laborHours,
    laborRate: product.laborRate,
  })
}

export function calculateFinancialControl({ sales, transactions, products, month }) {
  const monthSales = sales.filter((sale) => sale.status !== 'cancelled' && (!month || month === 'all' || sale.soldAt?.startsWith(month)))
  const monthTransactions = transactions.filter((entry) => !month || month === 'all' || entry.date?.startsWith(month))
  const activeTransactions = monthTransactions.filter((entry) => entry.status !== 'cancelled')
  const expenseEntries = activeTransactions.filter((entry) => entry.type === 'expense')
  const paidExpenses = expenseEntries.filter((entry) => entry.paymentStatus !== 'pending')
  const pendingExpenses = expenseEntries.filter((entry) => entry.paymentStatus === 'pending')
  const expenses = paidExpenses.filter((entry) => entry.category !== 'investment')
  const investmentExpenses = paidExpenses.filter((entry) => entry.category === 'investment')
  const businessCashExpenses = paidExpenses.filter((entry) => entry.fundingSource !== 'investment_funds')
  const investmentFundExpenses = paidExpenses.filter((entry) => entry.fundingSource === 'investment_funds')
  const incomes = activeTransactions.filter((entry) => entry.type === 'income')
  const salesReceived = monthSales.reduce((total, sale) => total + valueOf(sale.receivedAmount), 0)
  const saleFees = monthSales.reduce((total, sale) => total + valueOf(sale.fees), 0)
  const expensesTotal = expenses.reduce((total, entry) => total + valueOf(entry.amount), 0)
  const investmentExpensesTotal = investmentExpenses.reduce((total, entry) => total + valueOf(entry.amount), 0)
  const investmentIncome = incomes.filter((entry) => entry.category === 'investment')
    .reduce((total, entry) => total + valueOf(entry.amount), 0)
  const operatingIncome = incomes.filter((entry) => entry.category !== 'investment')
    .reduce((total, entry) => total + valueOf(entry.amount), 0)
  const businessCash = salesReceived + operatingIncome - saleFees
    - businessCashExpenses.reduce((total, entry) => total + valueOf(entry.amount), 0)
  const investmentBalance = investmentIncome
    - investmentFundExpenses.reduce((total, entry) => total + valueOf(entry.amount), 0)
  const replenishment = expensesTotal + saleFees
  const operatingResult = salesReceived + operatingIncome - replenishment
  const freeCash = businessCash + investmentBalance

  const productById = new Map(products.map((product) => [product.id, product]))
  const materialUsage = new Map()
  const orders = monthSales.map((sale) => {
    let estimatedCost = 0
    let unpricedItems = 0
    const items = Array.isArray(sale.items) ? sale.items : []

    items.forEach((item) => {
      const product = productById.get(item.productId)
      if (!product || !item.productId) {
        unpricedItems += 1
        return
      }
      const quantity = valueOf(item.quantity)
      const unitCost = estimateProductCost(product)
      if (unitCost === null) {
        unpricedItems += 1
        return
      }
      estimatedCost += quantity * unitCost

      const recipe = Array.isArray(product.recipe) ? product.recipe : []
      recipe.forEach((line) => {
        const materialQuantity = quantity * valueOf(line.quantity)
        const materialCost = materialQuantity * valueOf(line.unitCost)
        const unit = line.unit || ''
        const key = `${line.materialId || line.name || 'material'}:${unit}`
        const usage = materialUsage.get(key) || {
          id: key,
          name: line.name || 'Material sem nome',
          unit,
          quantity: 0,
          cost: 0,
        }
        usage.quantity += materialQuantity
        usage.cost += materialCost
        materialUsage.set(key, usage)
      })
    })

    return {
      id: sale.id,
      date: sale.soldAt,
      client: sale.client?.name || 'Cliente',
      total: valueOf(sale.total),
      estimatedCost,
      estimatedResult: valueOf(sale.total) - valueOf(sale.fees) - estimatedCost,
      unpricedItems,
    }
  })

  const materialExpenses = new Map()
  expenses.filter((entry) => ['materials', 'packaging'].includes(entry.category)).forEach((entry) => {
    const name = (entry.description || 'Despesa de material sem descrição')
      .replace(/^compra de material:\s*/i, '')
      .replace(/^compra:\s*/i, '')
      .trim()
    const key = name.toLocaleLowerCase('pt-BR')
    const expense = materialExpenses.get(key) || { name, amount: 0, count: 0 }
    expense.amount += valueOf(entry.amount)
    expense.count += 1
    materialExpenses.set(key, expense)
  })

  return {
    salesReceived,
    operatingIncome,
    investmentIncome,
    expenses: expensesTotal,
    investmentExpenses: investmentExpensesTotal,
    businessCash,
    investmentBalance,
    pendingExpenses: pendingExpenses.reduce((total, entry) => total + valueOf(entry.amount), 0),
    saleFees,
    replenishment,
    operatingResult,
    freeCash,
    orders,
    estimatedProductionCost: orders.reduce((total, order) => total + order.estimatedCost, 0),
    materialExpenses: [...materialExpenses.values()].sort((a, b) => b.amount - a.amount),
    materialUsage: [...materialUsage.values()].sort((a, b) => b.cost - a.cost),
  }
}
