function localDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function calculateSalesGoalTotals(sales, now = new Date()) {
  const today = localDateKey(now)
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  startOfWeek.setDate(startOfWeek.getDate() - ((startOfWeek.getDay() + 6) % 7))
  const weekStart = localDateKey(startOfWeek)
  const weekEndDate = new Date(startOfWeek)
  weekEndDate.setDate(weekEndDate.getDate() + 6)
  const weekEnd = localDateKey(weekEndDate)
  const monthKey = today.slice(0, 7)
  const yearKey = today.slice(0, 4)
  const activeSales = sales.filter((sale) => sale.status !== 'cancelled'
    && sale.orderApprovalStatus !== 'pending'
    && sale.soldAt && sale.soldAt <= today)
  const total = (rows) => rows.reduce((sum, sale) => sum + (Number(sale.total) || 0), 0)

  return {
    today,
    weekStart,
    weekEnd,
    monthKey,
    yearKey,
    weeklySalesTotal: total(activeSales.filter((sale) => sale.soldAt >= weekStart)),
    monthlySalesTotal: total(activeSales.filter((sale) => sale.soldAt.startsWith(monthKey))),
    annualSalesTotal: total(activeSales.filter((sale) => sale.soldAt.startsWith(yearKey))),
  }
}
