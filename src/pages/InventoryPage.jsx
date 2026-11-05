import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import useFinancialMaterials from '../hooks/useFinancialMaterials.js'
import useProducts from '../hooks/useProducts.js'
import { formatUnit } from '../services/finance/units.js'
import { adjustProductStock, archiveProduct, createPhysicalProductsBatch, restockProductsBatch } from '../services/products/products.js'
import { archiveMaterial, deleteArchivedMaterial, restoreMaterial, updateMaterialStock } from '../services/finance/materials.js'

const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
const unitCostMoney = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 6 }).format(Number(value) || 0)
const matchesSearch = (value, search) => value.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))

function InventoryPhoto({ item }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    const bytes = item?.photoBytes?.toUint8Array?.()
    if (!bytes?.length) { setSrc(''); return undefined }
    const url = URL.createObjectURL(new Blob([bytes], { type: item.photoContentType || 'image/webp' }))
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [item?.photoBytes, item?.photoContentType])
  return src ? <img className="inventory-item-photo" src={src} alt={`Foto de ${item.name}`} /> : <span className="inventory-item-photo inventory-item-photo-empty" aria-hidden="true">▧</span>
}

function StockAdjustment({ product, onClose, onSaved }) {
  const { workspaceUid } = useAuth()
  const [direction, setDirection] = useState('in')
  const [quantity, setQuantity] = useState('1')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  async function submit(event) {
    event.preventDefault()
    if (!Number.isInteger(Number(quantity)) || Number(quantity) < 1) return setError('Informe uma quantidade inteira maior que zero.')
    if (!reason.trim()) return setError('Informe o motivo do ajuste.')
    setSaving(true)
    try { await adjustProductStock(workspaceUid, product.id, (direction === 'in' ? 1 : -1) * Number(quantity), reason); onSaved('Estoque atualizado e movimentação registrada.') }
    catch (cause) { setError(cause.message || 'Não foi possível ajustar o estoque.') }
    finally { setSaving(false) }
  }
  return <div className="sale-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="sale-modal stock-modal" role="dialog" aria-modal="true"><header className="sale-modal-header"><div><p className="eyebrow">AJUSTE DE SALDO</p><h2>{product.name}</h2><p>Saldo atual: <strong>{product.quantity || 0}</strong></p></div><button className="modal-close" onClick={onClose} aria-label="Fechar">×</button></header><form className="sale-form" onSubmit={submit}><div className="form-grid form-grid-two"><label>Tipo de movimentação<select value={direction} onChange={(event) => setDirection(event.target.value)}><option value="in">Entrada no estoque</option><option value="out">Saída do estoque</option></select></label><label>Quantidade<input autoFocus type="number" min="1" step="1" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label className="field-span-two">Motivo<input required maxLength={160} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: compra de material, produção, perda" /></label></div>{error && <div className="alert alert-error" role="alert">{error}</div>}<footer className="sale-form-footer"><span>O saldo não pode ficar negativo.</span><div><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Registrar ajuste'}</button></div></footer></form></section></div>
}

const newQuickProduct = () => ({ name: '', quantity: '1', minStock: '0', cost: '', price: '', fundingSource: 'business_cash' })

function QuickProductEntry({ onClose, onSaved }) {
  const { workspaceUid } = useAuth()
  const [rows, setRows] = useState([newQuickProduct()])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  function changeRow(index, field, value) {
    setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: value } : row))
  }
  async function submit(event) {
    event.preventDefault()
    setError('')
    const entries = rows.filter((row) => row.name.trim())
    if (!entries.length) return setError('Informe o nome de pelo menos um produto.')
    if (entries.some((row) => !Number.isInteger(Number(row.quantity)) || Number(row.quantity) < 0 || !Number.isFinite(Number(row.minStock)) || Number(row.minStock) < 0 || !['cost', 'price'].every((field) => Number.isFinite(row[field] === '' ? 0 : Number(row[field])) && Number(row[field] || 0) >= 0))) {
      return setError('Confira os saldos e valores. Quantidade e estoque mínimo não podem ser negativos; quantidade precisa ser inteira.')
    }
    setSaving(true)
    try {
      const result = await createPhysicalProductsBatch(workspaceUid, entries)
      onSaved(result.expenseTotal > 0
        ? `${result.count} produto(s) cadastrado(s). Estoque inicial lançado como investimento pago: ${money(result.expenseTotal)} — caixa da empresa: ${money(result.businessCashTotal)}; investimentos/aportes: ${money(result.investmentFundsTotal)}.`
        : `${result.count} produto(s) cadastrado(s) no estoque; nenhum custo de estoque inicial foi lançado no Financeiro.`)
    } catch (cause) {
      setError(cause.message || 'Não foi possível cadastrar os produtos.')
    } finally {
      setSaving(false)
    }
  }
  return <div className="sale-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}><section className="sale-modal quick-stock-modal" role="dialog" aria-modal="true" aria-labelledby="quick-stock-title"><header className="sale-modal-header"><div><p className="eyebrow">ESTOQUE</p><h2 id="quick-stock-title">Cadastro rápido de produtos</h2><p>Adicione produtos físicos e informe o saldo inicial. O SKU será criado automaticamente.</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">×</button></header><form className="sale-form" onSubmit={submit}><div className="quick-product-lines">{rows.map((row, index) => <div className="quick-product-line" key={index}><label>Nome do produto<input maxLength={120} value={row.name} onChange={(event) => changeRow(index, 'name', event.target.value)} placeholder="Ex.: Vaso pequeno" /></label><label>Saldo inicial<input type="number" min="0" step="1" value={row.quantity} onChange={(event) => changeRow(index, 'quantity', event.target.value)} /></label><label>Estoque mínimo<input type="number" min="0" step="1" value={row.minStock} onChange={(event) => changeRow(index, 'minStock', event.target.value)} /></label><label>Custo (R$)<input type="number" min="0" step="0.01" value={row.cost} onChange={(event) => changeRow(index, 'cost', event.target.value)} /></label><label>Preço (R$)<input type="number" min="0" step="0.01" value={row.price} onChange={(event) => changeRow(index, 'price', event.target.value)} /></label><label>Origem do dinheiro<select value={row.fundingSource} onChange={(event) => changeRow(index, 'fundingSource', event.target.value)}><option value="business_cash">Caixa da empresa</option><option value="investment_funds">Investimentos / aportes</option></select></label><button type="button" className="cancel-action quick-product-remove" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remover</button></div>)}</div>  <button type="button" className="button button-secondary" disabled={rows.length >= 150} onClick={() => setRows((current) => [...current, newQuickProduct()])}>＋ Adicionar outra linha</button>{error && <div className="alert alert-error" role="alert">{error}</div>}<footer className="sale-form-footer"><span>Quantidade × custo será lançado como investimento pago na origem escolhida.</span><div><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Cadastrar no estoque'}</button></div></footer></form></section></div>
}

function QuickRestock({ products, onClose, onSaved }) {
  const { workspaceUid } = useAuth()
  const [rows, setRows] = useState([{ productId: '', quantity: '1', colors: ['#000000'] }])
  const [reason, setReason] = useState('Reposição de estoque')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const updateRow = (index, patch) => setRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row))
  const updateColor = (rowIndex, colorIndex, value) => setRows((current) => current.map((row, index) => index === rowIndex ? { ...row, colors: row.colors.map((color, index2) => index2 === colorIndex ? value : color) } : row))
  async function submit(event) {
    event.preventDefault()
    setError('')
    const entries = rows.filter((row) => row.productId).map((row) => ({ productId: row.productId, quantity: row.quantity, colors: row.colors }))
    if (!entries.length) return setError('Selecione pelo menos um produto para repor.')
    if (entries.some((row) => !Number.isInteger(Number(row.quantity)) || Number(row.quantity) < 1 || row.colors.length < 1)) return setError('Informe a quantidade de peças e pelo menos uma cor para cada combinação.')
    setSaving(true)
    try {
      const count = await restockProductsBatch(workspaceUid, entries, reason)
      onSaved(`Reposição registrada para ${count} produto(s).`)
    } catch (cause) {
      setError(cause.message || 'Não foi possível registrar a reposição.')
    } finally { setSaving(false) }
  }
  return <div className="sale-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !saving) onClose() }}><section className="sale-modal quick-restock-modal" role="dialog" aria-modal="true" aria-labelledby="quick-restock-title"><header className="sale-modal-header"><div><p className="eyebrow">ENTRADA DE ESTOQUE</p><h2 id="quick-restock-title">Reposição de produtos</h2><p>Informe quantas peças foram impressas e todas as cores usadas em cada combinação.</p></div><button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">×</button></header><form className="sale-form" onSubmit={submit}><div className="restock-entry-list">{rows.map((row, index) => { const product = products.find((item) => item.id === row.productId); return <div className="restock-entry-row" key={index}><label>Produto<select value={row.productId} onChange={(event) => { const productId = event.target.value; const selected = products.find((item) => item.id === productId); updateRow(index, { productId, quantity: '1', colors: [selected?.filamentColor || '#000000'] }) }}><option value="">Selecione um produto</option>{products.map((item) => <option key={item.id} value={item.id}>{item.name} · saldo {Number(item.quantity) || 0}</option>)}</select></label>{row.productId && <div className="restock-colors"><div className="restock-colors-heading"><strong>Cores usadas nesta peça</strong><span>{row.colors.length} cor(es)</span></div><div className="restock-color-row">{row.colors.map((color, colorIndex) => <label key={colorIndex}>Cor {colorIndex + 1}<span className="restock-color-choice"><input aria-label={`Escolher cor ${colorIndex + 1} para ${product?.name || 'produto'}`} type="color" value={color} onChange={(event) => updateColor(index, colorIndex, event.target.value)} /><code>{color.toUpperCase()}</code></span></label>)}{row.colors.length > 1 && <button type="button" className="cancel-action" onClick={() => updateRow(index, { colors: row.colors.slice(0, -1) })}>Remover última cor</button>}</div><button type="button" className="button button-secondary" onClick={() => updateRow(index, { colors: [...row.colors, '#000000'] })}>＋ Adicionar cor à peça</button><label className="restock-piece-quantity">Quantidade de peças<input type="number" min="1" step="1" value={row.quantity} onChange={(event) => updateRow(index, { quantity: event.target.value })} /></label></div>}<button type="button" className="cancel-action restock-remove" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}>Remover combinação</button></div> })}</div><button type="button" className="button button-secondary" disabled={rows.length >= 200} onClick={() => setRows((current) => [...current, { productId: '', quantity: '1', colors: ['#000000'] }])}>＋ Adicionar outra combinação</button><label className="restock-reason">Motivo da entrada<input maxLength="160" value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: reposição de produção colorida" /></label>{error && <div className="alert alert-error" role="alert">{error}</div>}<footer className="sale-form-footer"><span>O saldo aumenta pela quantidade de peças, não pela quantidade de cores.</span><div><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={saving || products.length === 0}>{saving ? 'Registrando…' : 'Confirmar reposição'}</button></div></footer></form></section></div>
}

function MaterialStockEditor({ material, onClose, onSaved }) {
  const { user, workspaceUid } = useAuth()
  const [quantity, setQuantity] = useState(String(material.stockQuantity ?? 0))
  const [minStock, setMinStock] = useState(String(material.minStock ?? 0))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!Number.isFinite(Number(quantity)) || Number(quantity) < 0) return setError('O saldo precisa ser um número igual ou maior que zero.')
    if (!Number.isFinite(Number(minStock)) || Number(minStock) < 0) return setError('O estoque mínimo precisa ser um número igual ou maior que zero.')
    setSaving(true)
    try {
      await updateMaterialStock(workspaceUid, material.id, Number(quantity), Number(minStock), user.uid)
      onSaved('Saldo do material atualizado.')
    } catch (cause) {
      setError(cause.message || 'Não foi possível atualizar o saldo do material.')
    } finally {
      setSaving(false)
    }
  }

  return <div className="sale-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="sale-modal stock-modal" role="dialog" aria-modal="true" aria-labelledby="material-stock-title"><header className="sale-modal-header"><div><p className="eyebrow">AJUSTE DE ESTOQUE</p><h2 id="material-stock-title">{material.name}</h2><p>Informe a quantidade física atual. Unidade: {formatUnit(material.baseUnit)}.</p></div><button className="modal-close" onClick={onClose} aria-label="Fechar">×</button></header><form className="sale-form" onSubmit={submit}><div className="form-grid form-grid-two"><label>Saldo atual ({formatUnit(material.baseUnit)})<input autoFocus type="number" min="0" step="any" required value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label><label>Estoque mínimo ({formatUnit(material.baseUnit)})<input type="number" min="0" step="any" required value={minStock} onChange={(event) => setMinStock(event.target.value)} /></label></div>{error && <div className="alert alert-error" role="alert">{error}</div>}<footer className="sale-form-footer"><span>O custo unitário médio será preservado.</span><div><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar saldo'}</button></div></footer></form></section></div>
}

export default function InventoryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { workspaceUid } = useAuth()
  const { products, loading, error } = useProducts()
  const { materials: allMaterials, loading: materialsLoading, error: materialsError } = useFinancialMaterials({ includeArchived: true })
  const [search, setSearch] = useState('')
  const [inventoryType, setInventoryType] = useState(() => searchParams.get('alert') === 'low-stock' ? 'low' : 'all')
  const [adjusting, setAdjusting] = useState(null)
  const [quickEntryOpen, setQuickEntryOpen] = useState(false)
  const [quickRestockOpen, setQuickRestockOpen] = useState(false)
  const [editingMaterial, setEditingMaterial] = useState(null)
  const [toast, setToast] = useState('')
  const [actionError, setActionError] = useState('')
  const searchableProducts = useMemo(() => products.filter((product) => product.active !== false && product.type === 'fisico' && matchesSearch(`${product.name} ${product.sku || ''} ${product.category || ''}`, search)), [products, search])
  const materials = allMaterials.filter((material) => material.active !== false)
  const archivedMaterials = allMaterials.filter((material) => material.active === false && matchesSearch(material.name, search))
  const searchableMaterials = useMemo(() => materials.filter((material) => matchesSearch(material.name, search)), [allMaterials, search])
  useEffect(() => { if (searchParams.get('alert') === 'low-stock') setInventoryType('low') }, [searchParams])
  const productList = inventoryType === 'material' || inventoryType === 'other' || inventoryType === 'archived' ? [] : searchableProducts.filter((product) => inventoryType !== 'low' || Number(product.quantity) <= Number(product.minStock))
  const materialList = inventoryType === 'product' || inventoryType === 'archived' ? [] : searchableMaterials.filter((material) => inventoryType !== 'low' || Number(material.stockQuantity) <= Number(material.minStock))
  const lowStock = searchableProducts.filter((product) => Number(product.quantity) <= Number(product.minStock)).length
    + searchableMaterials.filter((material) => Number(material.stockQuantity) <= Number(material.minStock)).length
  const inventoryItemCount = searchableProducts.length + searchableMaterials.length
  const loadingInventory = loading || materialsLoading
  function saved(message) { setAdjusting(null); setEditingMaterial(null); setToast(message); window.setTimeout(() => setToast(''), 3200) }
  async function removeProduct(product) {
    if (!window.confirm(`Remover “${product.name}” do estoque ativo? O produto será arquivado e as vendas e movimentações anteriores serão preservadas.`)) return
    setActionError('')
    try {
      await archiveProduct(workspaceUid, product.id)
      setToast('Produto arquivado e removido do estoque ativo.')
      window.setTimeout(() => setToast(''), 3200)
    } catch (cause) {
      setActionError(cause.message || 'Não foi possível arquivar o produto.')
    }
  }
  async function removeMaterial(material) {
    if (!window.confirm(`Remover “${material.name}” do estoque ativo? O cadastro será arquivado e compras e históricos serão preservados.`)) return
    setActionError('')
    try {
      await archiveMaterial(workspaceUid, material.id)
      setToast('Material arquivado e removido do estoque ativo.')
      window.setTimeout(() => setToast(''), 3200)
    } catch (cause) {
      setActionError(cause.message || 'Não foi possível arquivar o material.')
    }
  }
  async function restoreArchivedMaterial(material) {
    setActionError('')
    try {
      await restoreMaterial(workspaceUid, material.id)
      setToast('Material restaurado no estoque.')
      window.setTimeout(() => setToast(''), 3200)
    } catch (cause) {
      setActionError(cause.message || 'Não foi possível restaurar o material.')
    }
  }
  async function deleteMaterial(material) {
    if (!window.confirm(`Excluir permanentemente o cadastro de “${material.name}”? O saldo restante será removido. Os registros históricos sem vínculo de compra serão mantidos.`)) return
    setActionError('')
    try {
      await deleteArchivedMaterial(workspaceUid, material.id)
      setToast('Cadastro do material excluído permanentemente.')
      window.setTimeout(() => setToast(''), 3200)
    } catch (cause) {
      setActionError(cause.message || 'Não foi possível excluir o material.')
    }
  }

  return <div className="page-stack">
    <div className="page-intro"><div><p className="eyebrow">OPERAÇÃO</p><h2>Estoque</h2><p>Acompanhe produtos físicos, materiais e insumos em um só lugar. Produtos de venda online não aparecem aqui.</p></div><div className="inventory-quick-actions"><button className="button button-secondary" onClick={() => setQuickRestockOpen(true)}>＋ Reposição de produtos existentes</button><button className="button button-primary" onClick={() => setQuickEntryOpen(true)}>＋ Cadastrar produtos em lote</button></div></div>
    <div className="sales-summary-grid"><article className="sales-summary-card"><span>Produtos físicos</span><strong>{productList.length}</strong><small>Cadastros ativos</small></article><article className="sales-summary-card"><span>Materiais e insumos</span><strong>{materialList.length}</strong><small>Materiais ativos</small></article><article className="sales-summary-card"><span>Itens no estoque</span><strong>{inventoryItemCount}</strong><small>Produtos e materiais</small></article><article className="sales-summary-card"><span>Estoque baixo</span><strong>{lowStock}</strong><small>No limite mínimo ou abaixo</small></article></div>
    <div className="product-tabs inventory-type-tabs" role="tablist" aria-label="Filtrar itens do estoque">
      <button type="button" role="tab" aria-selected={inventoryType === 'all'} className={inventoryType === 'all' ? 'product-tab-active' : ''} onClick={() => setInventoryType('all')}><span>Todos</span><b>{inventoryItemCount}</b></button>
      <button type="button" role="tab" aria-selected={inventoryType === 'low'} className={inventoryType === 'low' ? 'product-tab-active' : ''} onClick={() => setInventoryType('low')}><span>Estoque baixo</span><b>{lowStock}</b></button>
      <button type="button" role="tab" aria-selected={inventoryType === 'product'} className={inventoryType === 'product' ? 'product-tab-active' : ''} onClick={() => setInventoryType('product')}><span>Produtos</span><b>{searchableProducts.length}</b></button>
      <button type="button" role="tab" aria-selected={inventoryType === 'material'} className={inventoryType === 'material' ? 'product-tab-active' : ''} onClick={() => setInventoryType('material')}><span>Materiais</span><b>{searchableMaterials.length}</b></button>
      <button type="button" role="tab" aria-selected={inventoryType === 'archived'} className={inventoryType === 'archived' ? 'product-tab-active' : ''} onClick={() => setInventoryType('archived')}><span>Arquivados</span><b>{archivedMaterials.length}</b></button>
    </div>
    <section className="panel products-panel"><div className="products-toolbar"><label className="search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar produto, SKU ou material" /></label><span className="count-chip">{inventoryType === 'archived' ? archivedMaterials.length : productList.length + materialList.length} itens</span></div>{(error || materialsError || actionError) && <div className="sales-error" role="alert">{actionError || error || materialsError}</div>}
      {loadingInventory ? <div className="sales-loading">Carregando estoque…</div> : <div className="sales-table-scroll"><table className="sales-table products-table inventory-table"><thead><tr><th>Produto ou material</th><th>Tipo / SKU</th><th>Saldo atual</th><th>Estoque mínimo</th><th>Custo unitário</th><th>Valor em estoque</th><th>Ações</th></tr></thead><tbody>
        {inventoryType !== 'archived' && productList.map((product) => { const low = Number(product.quantity) <= Number(product.minStock); const colors = product.filamentColors?.length ? product.filamentColors : product.filamentColor ? [product.filamentColor] : []; return <tr key={`product-${product.id}`} className={low ? 'stock-low-row' : ''}><td><InventoryPhoto item={product} />{colors.map((color, index) => <span key={`${color}-${index}`} aria-label={`Cor ${color}`} title={`Cor: ${color}`} style={{ display: 'inline-block', width: 11, height: 11, marginRight: 4, border: '1px solid #aaa', borderRadius: '50%', backgroundColor: color, verticalAlign: 'middle' }} />)}<strong className="table-primary-text">{product.name}</strong><small>{product.category || 'Produto físico'}</small></td><td>{product.sku || 'Produto físico'}</td><td><strong>{Number(product.quantity) || 0}</strong>{low && <small className="stock-alert-text">Estoque baixo</small>}</td><td>{Number(product.minStock) || 0}</td><td>{money(product.cost)}</td><td>{money((Number(product.quantity) || 0) * (Number(product.cost) || 0))}</td><td><div className="sale-actions"><button type="button" onClick={() => navigate('/admin/produtos', { state: { editProductId: product.id } })}>Editar nome</button><button type="button" className="button button-secondary stock-adjust-button" onClick={() => setAdjusting(product)}>Ajustar saldo</button><button type="button" className="cancel-action" onClick={() => removeProduct(product)}>Excluir do estoque</button></div></td></tr>})}
        {inventoryType === 'archived' ? archivedMaterials.map((material) => <tr key={`archived-${material.id}`}><td><InventoryPhoto item={material} /><strong className="table-primary-text">{material.name}</strong><small>Material arquivado · histórico preservado</small></td><td>{formatUnit(material.baseUnit)}</td><td>{Number(material.stockQuantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {formatUnit(material.baseUnit)}</td><td>{Number(material.minStock || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {formatUnit(material.baseUnit)}</td><td>{unitCostMoney(material.unitCost)} / {formatUnit(material.baseUnit)}</td><td>{money((Number(material.stockQuantity) || 0) * (Number(material.unitCost) || 0))}</td><td><div className="sale-actions"><button type="button" onClick={() => restoreArchivedMaterial(material)}>Restaurar</button><button type="button" className="cancel-action" onClick={() => deleteMaterial(material)}>Excluir definitivamente</button></div></td></tr>) : materialList.map((material) => { const low = Number(material.stockQuantity) <= Number(material.minStock); return <tr key={`material-${material.id}`} className={low ? 'stock-low-row' : ''}><td><InventoryPhoto item={material} /><strong className="table-primary-text">{material.name}</strong><small>Material / insumo</small></td><td>{formatUnit(material.baseUnit)}</td><td><strong>{Number(material.stockQuantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {formatUnit(material.baseUnit)}</strong>{low && <small className="stock-alert-text">Estoque baixo</small>}</td><td>{Number(material.minStock || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {formatUnit(material.baseUnit)}</td><td>{unitCostMoney(material.unitCost)} / {formatUnit(material.baseUnit)}</td><td>{money((Number(material.stockQuantity) || 0) * (Number(material.unitCost) || 0))}</td><td><div className="sale-actions"><button type="button" onClick={() => setEditingMaterial(material)}>Editar estoque</button><button type="button" className="cancel-action" onClick={() => removeMaterial(material)}>Excluir do estoque</button></div></td></tr>})}
        {inventoryType === 'archived' && archivedMaterials.length === 0 ? <tr><td colSpan="7"><div className="table-empty"><strong>Nenhum material arquivado</strong><span>Itens removidos do estoque ativo aparecerão aqui e poderão ser restaurados.</span></div></td></tr> : inventoryType !== 'archived' && productList.length + materialList.length === 0 && <tr><td colSpan="7"><div className="table-empty"><strong>Nenhum item encontrado no estoque</strong><span>Cadastre produtos físicos em Produtos e materiais/insumos no Financeiro.</span></div></td></tr>}
      </tbody></table></div>}
    </section>
    <div className="info-banner"><span>i</span><p>Ajuste os saldos dos produtos físicos nesta tela. Cadastre materiais e registre compras pelo Financeiro; seus saldos e custos médios aparecem aqui automaticamente. Produtos de venda online ficam fora do estoque.</p></div>
    {quickEntryOpen && <QuickProductEntry onClose={() => setQuickEntryOpen(false)} onSaved={(message) => { setQuickEntryOpen(false); setToast(message); window.setTimeout(() => setToast(''), 3500) }} />}{quickRestockOpen && <QuickRestock products={products.filter((product) => product.active !== false && product.type === 'fisico')} onClose={() => setQuickRestockOpen(false)} onSaved={(message) => { setQuickRestockOpen(false); setToast(message); window.setTimeout(() => setToast(''), 3500) }} />}{adjusting && <StockAdjustment product={adjusting} onClose={() => setAdjusting(null)} onSaved={saved} />}{editingMaterial && <MaterialStockEditor material={editingMaterial} onClose={() => setEditingMaterial(null)} onSaved={saved} />}{toast && <div className="toast-success" role="status">{toast}</div>}
  </div>
}
