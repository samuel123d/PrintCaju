const completedProductionValues = new Set(['ready', 'complete', 'completed', 'concluida', 'finalizada', 'done', 'producao_concluida'])

function normalizeStatus(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR').trim().replace(/[\s-]+/g, '_')
}

export function isProductionComplete(sale) {
  return completedProductionValues.has(normalizeStatus(sale?.productionStatus))
}

export function normalizedProductionStatus(sale) {
  const value = normalizeStatus(sale?.productionStatus)
  if (isProductionComplete(sale)) return 'ready'
  if (['producing', 'em_producao'].includes(value)) return 'producing'
  if (['preparing', 'em_preparo'].includes(value) || normalizeStatus(sale?.deliveryStatus) === 'preparing') return 'preparing'
  return 'not_started'
}
