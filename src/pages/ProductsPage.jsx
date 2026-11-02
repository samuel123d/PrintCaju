import { useEffect, useMemo, useRef, useState } from 'react'
import { Bytes } from 'firebase/firestore'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import useFinancialMaterials from '../hooks/useFinancialMaterials.js'
import useProducts from '../hooks/useProducts.js'
import { archiveProduct, createProduct, deleteArchivedProduct, updateProduct } from '../services/products/products.js'
import { calculatePrintingEnergyCost, calculateProductCost, suggestSalePrice } from '../services/finance/costing.js'
import { formatUnit } from '../services/finance/units.js'

const blankProduct = (type) => ({ name: '', sku: '', type, category: '', description: '', cost: '', price: '', quantity: '0', minStock: '0', recipe: [], filamentMaterialId: '', filamentColor: '#000000', filamentGrams: '0', filamentUnitCost: '0', otherFixedCost: '0', energyCost: '0', printHours: '0', electricityRate: '0', laborHours: '0', laborRate: '0', marginPercent: '50', feePercent: '0' })
const money = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)
const unitCostMoney = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 6 }).format(Number(value) || 0)
const amount = (value) => Number.parseFloat(String(value ?? '0').replace(',', '.')) || 0
const dimensionFactors = { mm: 0.001, cm: 0.01, m: 1 }
const typeName = () => 'Produto 3D'

async function compressProductPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Escolha uma imagem JPG, PNG ou WebP.')
  if (file.size > 8 * 1024 * 1024) throw new Error('A imagem original deve ter até 8 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    for (const edge of [1200, 960, 800, 640, 512, 384, 256]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.82, 0.72, 0.62, 0.5, 0.38]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
        if (!blob) throw new Error('Não foi possível preparar a imagem.')
        if (blob.size <= 400 * 1024) return new File([blob], 'product.webp', { type: 'image/webp' })
      }
    }
  } finally { bitmap.close() }
  throw new Error('Não foi possível reduzir a imagem para menos de 400 KB.')
}

function ProductImage({ product, className = '' }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    const bytes = product?.photoBytes?.toUint8Array?.()
    if (!bytes?.length) { setSrc(''); return undefined }
    const url = URL.createObjectURL(new Blob([bytes], { type: product.photoContentType || 'image/webp' }))
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [product?.photoBytes, product?.photoContentType])
  return src ? <img className={className} src={src} alt={`Foto de ${product.name}`} /> : null
}

function ProductForm({ product, type, materials, materialsLoading, materialsError, onClose, onSaved }) {
  const { workspaceUid } = useAuth()
  const [form, setForm] = useState(() => product ? { ...blankProduct(product.type), ...product, cost: String(product.cost ?? ''), price: String(product.price ?? ''), quantity: String(product.quantity ?? 0), minStock: String(product.minStock ?? 0), recipe: Array.isArray(product.recipe) ? product.recipe : [], filamentMaterialId: product.filamentMaterialId ?? '', filamentColor: product.filamentColor ?? '', filamentGrams: String(product.filamentGrams ?? 0), filamentUnitCost: String(product.filamentUnitCost ?? 0), otherFixedCost: String(product.otherFixedCost ?? (!product.recipe?.length && !product.filamentGrams && !product.printHours && !product.energyCost && !product.laborHours ? product.cost ?? 0 : 0)), energyCost: String(product.manualEnergyCost ?? product.energyCost ?? 0), printHours: String(product.printHours ?? 0), electricityRate: String(product.electricityRate ?? 0), laborHours: String(product.laborHours ?? 0), laborRate: String(product.laborRate ?? 0), marginPercent: String(product.marginPercent ?? 50), feePercent: String(product.feePercent ?? 0) } : blankProduct(type))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [photoFile, setPhotoFile] = useState(null)
  const [photoRemoved, setPhotoRemoved] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [photoPreview, setPhotoPreview] = useState('')
  const photoInput = useRef(null)
  useEffect(() => {
    if (!photoFile) { setPhotoPreview(''); return undefined }
    const url = URL.createObjectURL(photoFile)
    setPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [photoFile])
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const recipeLines = form.recipe.map((line) => {
    const material = materials.find((item) => item.id === line.materialId)
    const dimensionFactor = dimensionFactors[line.dimensionUnit || 'cm']
    const quantity = material?.baseUnit === 'm2' && Number(line.width) > 0 && Number(line.length) > 0
      ? Number(line.width) * dimensionFactor * Number(line.length) * dimensionFactor
      : amount(line.quantity)
    return { ...line, material, name: material?.name || line.name || 'Material arquivado', unit: material?.baseUnit || line.unit, quantity, unitCost: Number(material?.unitCost ?? line.unitCost) || 0 }
  })
  const energyCost = amount(form.energyCost)
  const filamentMaterial = materials.find((item) => item.id === form.filamentMaterialId)
  const filamentGrams = amount(form.filamentGrams)
  const filamentUnitCost = Number(filamentMaterial?.unitCost ?? form.filamentUnitCost) || 0
  const filamentCost = filamentGrams * filamentUnitCost
  const otherFixedCost = amount(form.otherFixedCost)
  const printHours = amount(form.printHours)
  const electricityRate = amount(form.electricityRate)
  const printingEnergyCost = calculatePrintingEnergyCost(printHours, electricityRate)
  const resolvedPrintCost = energyCost > 0 ? energyCost : printingEnergyCost
  const laborHours = amount(form.laborHours)
  const laborRate = amount(form.laborRate)
  const hasCostBreakdown = form.recipe.length > 0 || filamentGrams > 0 || otherFixedCost > 0 || energyCost > 0 || printHours > 0 || laborHours > 0
  const calculatedCost = hasCostBreakdown ? calculateProductCost({ recipe: recipeLines, energyCost: resolvedPrintCost + filamentCost + otherFixedCost, laborHours, laborRate }) : amount(form.cost)
  const marginPercent = amount(form.marginPercent)
  const feePercent = amount(form.feePercent)
  const suggestedPrice = suggestSalePrice(calculatedCost, marginPercent, feePercent)

  function changeRecipe(index, key, value) {
    set('recipe', form.recipe.map((line, lineIndex) => {
      if (lineIndex !== index) return line
      if (key === 'dimensionUnit') {
        const factor = dimensionFactors[line.dimensionUnit || 'cm'] / dimensionFactors[value]
        return { ...line, width: line.width ? String(Number(line.width) * factor) : '', length: line.length ? String(Number(line.length) * factor) : '', dimensionUnit: value }
      }
      return { ...line, [key]: value }
    }))
  }

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!form.name.trim()) return setError('Informe o nome do produto.')
    if ([form.quantity, form.minStock, form.cost, form.price, form.filamentGrams, form.otherFixedCost, form.energyCost, form.printHours, form.electricityRate, form.laborHours, form.laborRate, form.marginPercent, form.feePercent].some((value) => !Number.isFinite(amount(value)) || amount(value) < 0)) return setError('Estoque, custos, taxas e margem precisam ser números iguais ou maiores que zero.')
    if (filamentGrams > 0 && !form.filamentMaterialId) return setError('Selecione o filamento cadastrado no Financeiro para calcular o custo por grama.')
    if (filamentMaterial && filamentMaterial.baseUnit !== 'g') return setError('Cadastre o filamento com unidade base em gramas (g).')
    if (feePercent >= 100) return setError('As taxas da venda precisam ser menores que 100%.')
    if (form.recipe.some((line, index) => !line.materialId || (recipeLines[index].material?.baseUnit === 'm2'
      ? !Number.isFinite(amount(line.width)) || amount(line.width) <= 0 || !Number.isFinite(amount(line.length)) || amount(line.length) <= 0 || recipeLines[index].quantity <= 0
      : !Number.isFinite(amount(line.quantity)) || amount(line.quantity) <= 0))) return setError('Selecione um material e informe o consumo ou as dimensões maiores que zero em cada linha da ficha técnica.')
    if (!Number.isFinite(calculatedCost) || (suggestedPrice !== null && !Number.isFinite(suggestedPrice))) return setError('O custo calculado está fora do intervalo permitido. Revise as quantidades e os valores.')
    const data = {
      name: form.name.trim(),
      sku: form.sku.trim(),
      type,
      category: form.category.trim(),
      description: form.description.trim(),
      cost: Number(calculatedCost.toFixed(2)),
      price: Number(amount(form.price).toFixed(2)),
      suggestedPrice: suggestedPrice === null ? null : Number(suggestedPrice.toFixed(2)),
      quantity: Number(form.quantity) || 0,
      minStock: Number(form.minStock) || 0,
      recipe: recipeLines.map((line) => ({ materialId: line.materialId, name: line.name, quantity: Number(line.quantity.toFixed(8)), unit: line.unit, unitCost: line.unitCost, ...(line.unit === 'm2' ? { width: Number(line.width), length: Number(line.length), dimensionUnit: line.dimensionUnit || 'cm' } : {}) })),
      filamentMaterialId: form.filamentMaterialId,
      filamentMaterialName: filamentMaterial?.name || product?.filamentMaterialName || '',
      filamentColor: form.filamentColor,
      filamentGrams: Number(filamentGrams.toFixed(4)),
      filamentUnitCost: Number(filamentUnitCost.toFixed(8)),
      filamentCost: Number(filamentCost.toFixed(4)),
      otherFixedCost: Number(otherFixedCost.toFixed(4)),
      energyCost: Number(resolvedPrintCost.toFixed(4)),
      manualEnergyCost: Number(energyCost.toFixed(4)),
      printHours: Number(printHours.toFixed(4)),
      electricityRate: Number(electricityRate.toFixed(4)),
      laborHours: Number(laborHours.toFixed(4)),
      laborRate: Number(laborRate.toFixed(2)),
      marginPercent,
      feePercent,
    }
    setSaving(true)
    try {
      if (photoFile) {
        data.photoBytes = Bytes.fromUint8Array(new Uint8Array(await photoFile.arrayBuffer()))
        data.photoContentType = photoFile.type
      } else if (photoRemoved) {
        data.photoBytes = null
        data.photoContentType = null
      }
      if (product) await updateProduct(workspaceUid, product.id, data)
      else await createProduct(workspaceUid, data)
      onSaved(product ? 'Produto atualizado.' : 'Produto cadastrado.')
    } catch (cause) { setError(cause.message || 'Não foi possível salvar. Confira sua conexão e tente novamente.') }
    finally { setSaving(false) }
  }

  return <div className="sale-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className="sale-modal product-modal" role="dialog" aria-modal="true" aria-labelledby="product-form-title"><header className="sale-modal-header"><div><p className="eyebrow">{typeName(type).toUpperCase()}</p><h2 id="product-form-title">{product ? 'Editar produto' : 'Novo produto'}</h2><p>Cadastre informações comerciais, materiais e o saldo inicial.</p></div><button className="modal-close" onClick={onClose} aria-label="Fechar">×</button></header><form className="sale-form" onSubmit={submit}><div className="form-grid form-grid-two">
    <label className="field-span-two">Nome do produto <b>*</b><input required maxLength={120} value={form.name} onChange={(event) => set('name', event.target.value)} placeholder="Ex.: Vaso decorativo personalizado" /></label>
    {type === 'fisico' ? <div className="product-sku-auto"><strong>SKU automático</strong><small>Um código único será gerado ao salvar o produto.</small></div> : <label>SKU / código<input maxLength={60} value={form.sku} onChange={(event) => set('sku', event.target.value)} placeholder="Código interno (opcional)" /></label>}
    <label>Categoria<input maxLength={80} value={form.category} onChange={(event) => set('category', event.target.value)} placeholder="Ex.: Decoração" /></label>
    {!hasCostBreakdown && <label>Custo manual (R$)<input type="number" min="0" step="0.01" value={form.cost} onChange={(event) => set('cost', event.target.value)} /></label>}
    <label>Preço de venda (R$)<input type="number" min="0" step="0.01" value={form.price} onChange={(event) => set('price', event.target.value)} /></label>
    <label>{product ? 'Saldo atual' : 'Saldo inicial'}<input type="number" min="0" step="1" readOnly={Boolean(product)} value={form.quantity} onChange={(event) => set('quantity', event.target.value)} />{product && <small>Para alterar o saldo, use os ajustes na área Estoque.</small>}</label>
    <label>Estoque mínimo<input type="number" min="0" step="1" value={form.minStock} onChange={(event) => set('minStock', event.target.value)} /><small>O sistema sinaliza quando o saldo chegar a este limite.</small></label>
    <label className="field-span-two">Descrição<textarea rows="3" maxLength={600} value={form.description} onChange={(event) => set('description', event.target.value)} /></label>
    <div className="field-span-two product-photo-field"><span>Foto do produto</span><div className="product-photo-preview">{photoPreview ? <img src={photoPreview} alt="Prévia da foto do produto" /> : !photoRemoved && product?.photoBytes ? <ProductImage product={product} /> : <span>Sem foto</span>}</div><div className="product-photo-actions"><button type="button" className="button button-secondary" onClick={() => photoInput.current?.click()}>{product?.photoBytes && !photoRemoved ? 'Trocar foto' : 'Adicionar foto'}</button>{(photoFile || (product?.photoBytes && !photoRemoved)) && <button type="button" className="button button-quiet" onClick={() => { setPhotoFile(null); setPhotoRemoved(true); setPhotoError(''); if (photoInput.current) photoInput.current.value = '' }}>Remover foto</button>}<input ref={photoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setPhotoError(''); try { setPhotoFile(await compressProductPhoto(file)); setPhotoRemoved(false) } catch (cause) { setPhotoError(cause.message); event.target.value = '' } }} /></div><small>JPG, PNG ou WebP. Foto otimizada e armazenada no cadastro do produto (até 400 KB).</small>{photoError && <small className="product-photo-error" role="alert">{photoError}</small>}</div>
  </div>
  <section className="product-cost-section">
    <div className="form-section-title"><span>01</span><div><h3>Ficha técnica e custos</h3><p>Selecione materiais cadastrados no Financeiro e informe quanto cada peça consome.</p></div></div>
    {materialsError && <div className="sales-error" role="alert">{materialsError}</div>}
    <div className="form-grid form-grid-two"><label>Filamento usado<select value={form.filamentMaterialId} onChange={(event) => set('filamentMaterialId', event.target.value)}><option value="">Selecione o filamento</option>{form.filamentMaterialId && !materials.some((item) => item.id === form.filamentMaterialId) && <option value={form.filamentMaterialId}>{product?.filamentMaterialName || 'Filamento salvo'} · custo salvo</option>}{materials.filter((material) => material.baseUnit === 'g').map((material) => <option key={material.id} value={material.id}>{material.name} · {unitCostMoney(material.unitCost)}/g</option>)}</select></label><label>Cor do filamento<input type="color" value={form.filamentColor || '#000000'} onChange={(event) => set('filamentColor', event.target.value)} /><small>Escolha a cor usada para imprimir esta peça.</small></label><label>Filamento gasto (gramas)<input type="number" min="0" step="0.0001" value={form.filamentGrams} onChange={(event) => set('filamentGrams', event.target.value)} /><small>Informe até quatro casas decimais. Custo do filamento nesta peça: {money(filamentCost)}.</small></label></div>
    {materialsLoading ? <p className="product-cost-hint">Carregando materiais cadastrados no Financeiro…</p> : materials.length === 0 && form.recipe.length === 0 ? <p className="product-cost-hint">Cadastre primeiro seus materiais em Financeiro → Estoque de materiais.</p> : <div className="product-recipe-list">{form.recipe.map((line, index) => <div className={`product-recipe-row ${line.material?.baseUnit === 'm2' ? 'product-recipe-area-row' : ''}`} key={`${line.materialId}-${index}`}>
      <label>Material<select required value={line.materialId} onChange={(event) => changeRecipe(index, 'materialId', event.target.value)}><option value="">Selecione um material</option>{line.materialId && !materials.some((item) => item.id === line.materialId) && <option value={line.materialId}>{line.name || 'Material arquivado'} · custo salvo</option>}{materials.map((material) => <option key={material.id} value={material.id}>{material.name} · {unitCostMoney(material.unitCost)}/{formatUnit(material.baseUnit)}</option>)}</select></label>
      {line.material?.baseUnit === 'm2' ? <>
        <label>Largura<input type="number" min="0.001" step="any" required value={line.width || ''} onChange={(event) => changeRecipe(index, 'width', event.target.value)} /></label>
        <label>Comprimento<input type="number" min="0.001" step="any" required value={line.length || ''} onChange={(event) => changeRecipe(index, 'length', event.target.value)} /></label>
        <label>Unidade<select value={line.dimensionUnit || 'cm'} onChange={(event) => changeRecipe(index, 'dimensionUnit', event.target.value)}><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
      </> : <label>Consumo ({formatUnit(line.unit || 'unidade')}/peça)<input type="number" min="0.0001" step="any" required value={line.quantity} onChange={(event) => changeRecipe(index, 'quantity', event.target.value)} placeholder="Ex.: 35" /></label>}
      <div className="product-recipe-cost"><small>{line.material ? `${formatUnit(line.material.baseUnit)} · ${unitCostMoney(line.unitCost)}/${formatUnit(line.material.baseUnit)}` : 'Selecione o material'}</small><strong>{money(amount(line.quantity) * line.unitCost)}</strong></div>
      <button type="button" className="cancel-action" onClick={() => set('recipe', form.recipe.filter((_, lineIndex) => lineIndex !== index))}>Remover</button>
    </div>)}
    <button type="button" className="button button-secondary" onClick={() => set('recipe', [...form.recipe, { materialId: '', quantity: '', unitCost: 0 }])}>＋ Adicionar material</button>
    <p className="product-cost-hint">Use a unidade base do material. Para material em m², informe largura e comprimento; mm, cm e m são convertidos automaticamente.</p></div>}
    <div className="form-grid form-grid-two product-overhead-grid">
      <label>Tempo de impressão por peça (horas)<input type="number" min="0" step="0.01" value={form.printHours} onChange={(event) => set('printHours', event.target.value)} /><small>Usado no cálculo da energia da impressão (220 W).</small></label>
      <label>Tarifa de energia (R$/kWh)<input type="number" min="0" step="0.0001" value={form.electricityRate} onChange={(event) => set('electricityRate', event.target.value)} /><small>Estimativa pela tarifa: {money(printingEnergyCost)}. O custo manual da impressão tem prioridade.</small></label>
      <label>Custo da impressão por peça (R$)<input type="number" min="0" step="0.01" value={form.energyCost} onChange={(event) => set('energyCost', event.target.value)} /><small>Se informar um valor, ele substitui a estimativa de energia pela tarifa.</small></label>
      <label>Embalagem, chaveiro e outros custos fixos (R$)<input type="number" min="0" step="0.01" value={form.otherFixedCost} onChange={(event) => set('otherFixedCost', event.target.value)} /><small>Inclua aqui custos fixos por peça que não estejam na ficha técnica.</small></label>
      <label>Tempo de mão de obra (horas)<input type="number" min="0" step="0.01" value={form.laborHours} onChange={(event) => set('laborHours', event.target.value)} /></label>
      <label>Custo da mão de obra por hora (R$)<input type="number" min="0" step="0.01" value={form.laborRate} onChange={(event) => set('laborRate', event.target.value)} /></label>
      <label>Taxas da venda (%)<input type="number" min="0" max="99.99" step="0.01" value={form.feePercent} onChange={(event) => set('feePercent', event.target.value)} /></label>
      <label>Margem de lucro desejada (%)<input type="number" min="0" step="0.01" value={form.marginPercent} onChange={(event) => set('marginPercent', event.target.value)} /><small>Sem limite máximo; calculada como percentual sobre o custo.</small></label>
    </div>
    <div className="product-cost-summary"><span>Custo calculado por peça<strong>{money(calculatedCost)}</strong></span><span>Preço sugerido<strong>{suggestedPrice === null ? 'Reduza margem ou taxas' : money(suggestedPrice)}</strong></span>{suggestedPrice !== null && <button type="button" className="button button-secondary" onClick={() => set('price', suggestedPrice.toFixed(2))}>Usar preço sugerido</button>}</div>
  </section>
  {error && <div className="alert alert-error" role="alert">{error}</div>}<footer className="sale-form-footer"><span>Classificação: <b>{typeName(type)}</b></span><div><button type="button" className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={saving || materialsLoading}>{saving ? 'Salvando…' : materialsLoading ? 'Carregando materiais…' : 'Salvar produto'}</button></div></footer></form></section></div>
}

export default function ProductsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const { workspaceUid } = useAuth()
  const { products, loading, error } = useProducts()
  const { materials, loading: materialsLoading, error: materialsError } = useFinancialMaterials()
  const type = 'fisico'
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState('')
  const [editing, setEditing] = useState(null)
  const [formOpen, setFormOpen] = useState(false)
  const [toast, setToast] = useState('')
  const [actionError, setActionError] = useState('')
  const list = useMemo(() => products.filter((product) => (showArchived ? product.active === false : product.active !== false) && `${product.name} ${product.sku} ${product.category}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))), [products, search, showArchived])
  const archivedCount = products.filter((item) => item.active === false).length

  useEffect(() => {
    const productId = location.state?.editProductId
    if (!productId || loading) return
    const product = products.find((item) => item.id === productId && item.active !== false)
    navigate(location.pathname, { replace: true, state: null })
    if (product) {
      setShowArchived(false)
      setEditing(product)
      setFormOpen(true)
      setActionError('')
    } else {
      setActionError('Não foi possível encontrar o produto para editar.')
    }
  }, [location.pathname, location.state, loading, products, navigate])

  function saved(message) { setFormOpen(false); setEditing(null); setToast(message); window.setTimeout(() => setToast(''), 3000) }
  async function archive(product) {
    if (!window.confirm(`Arquivar ${product.name}? O produto e o histórico de estoque serão preservados.`)) return
    try { await archiveProduct(workspaceUid, product.id); saved('Produto arquivado.') }
    catch (cause) { setActionError(cause.message || 'Não foi possível arquivar o produto.') }
  }
  async function removeArchived(product) {
    if (!window.confirm(`Excluir permanentemente “${product.name}” do cadastro de produtos? Esta ação não pode ser desfeita. O histórico de vendas e movimentações de estoque será mantido.`)) return
    setActionError('')
    try {
      await deleteArchivedProduct(workspaceUid, product.id)
      setToast('Produto excluído do cadastro.')
      window.setTimeout(() => setToast(''), 3000)
    } catch (cause) {
      setActionError(cause.message || 'Não foi possível excluir o produto arquivado.')
    }
  }

  return <div className="page-stack">
    <div className="page-intro"><div><p className="eyebrow">CATÁLOGO 3D</p><h2>Produtos</h2><p>Cadastre peças, tempo de impressão, consumo de filamento e custos por produto.</p></div><button className="button button-primary" onClick={() => { setEditing(null); setFormOpen(true) }}>＋ Novo produto</button></div>
    <div className="product-tabs" role="tablist" aria-label="Produtos"><button role="tab" aria-selected={!showArchived} className={!showArchived ? 'product-tab-active' : ''} onClick={() => setShowArchived(false)}><span>Produtos 3D</span><b>{products.filter((item) => item.active !== false).length}</b></button><button role="tab" aria-selected={showArchived} className={showArchived ? 'product-tab-active' : ''} onClick={() => setShowArchived(true)}><span>Arquivados</span><b>{archivedCount}</b></button></div>
    <section className="panel products-panel"><div className="products-toolbar"><label className="search-field"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por produto, SKU ou categoria" /></label><span className="count-chip">{list.length} {list.length === 1 ? 'produto' : 'produtos'}</span></div>
      {error && <div className="sales-error" role="alert">{error}</div>}{materialsError && <div className="sales-error" role="alert">{materialsError}</div>}{actionError && <div className="sales-error" role="alert">{actionError}</div>}
      {loading ? <div className="sales-loading">Carregando produtos…</div> : <div className="sales-table-scroll"><table className="sales-table products-table"><thead><tr><th>Produto</th><th>SKU</th><th>Estoque</th><th>Custo</th><th>Preço</th><th>Ações</th></tr></thead><tbody>{list.map((product) => <tr key={product.id} className={Number(product.quantity) <= Number(product.minStock) ? 'stock-low-row' : ''}><td><ProductImage product={product} className="product-list-thumbnail" />{product.filamentColor && <span aria-label={`Filamento ${product.filamentColor}`} title={`Cor do filamento: ${product.filamentColor}`} style={{ display: 'inline-block', width: 11, height: 11, marginRight: 6, border: '1px solid #aaa', borderRadius: '50%', backgroundColor: product.filamentColor, verticalAlign: 'middle' }} />}<strong className="table-primary-text">{product.name}</strong><small>{showArchived ? 'Produto 3D · ' : ''}{product.category || 'Sem categoria'}{showArchived ? ' · Arquivado' : ''}</small></td><td>{product.sku || '—'}</td><td><strong>{Number(product.quantity) || 0}</strong><small>mínimo {Number(product.minStock) || 0}</small></td><td>{money(product.cost)}</td><td>{money(product.price)}</td><td><div className="sale-actions">{showArchived ? <button className="cancel-action" onClick={() => removeArchived(product)}>Excluir do banco</button> : <><button onClick={() => { setEditing(product); setFormOpen(true) }}>Editar</button><button className="cancel-action" onClick={() => archive(product)}>Arquivar</button></>}</div></td></tr>)}{list.length === 0 && <tr><td colSpan="6"><div className="table-empty"><strong>{search ? 'Nenhum produto encontrado' : showArchived ? 'Nenhum produto arquivado' : `Nenhum produto ${typeName(type).toLowerCase()} cadastrado`}</strong><span>{showArchived ? 'Produtos arquivados aparecerão aqui.' : 'Use “Novo produto” para cadastrar neste grupo.'}</span></div></td></tr>}</tbody></table></div>}
    </section>
    {formOpen && <ProductForm product={editing} type={type} materials={materials} materialsLoading={materialsLoading} materialsError={materialsError} onClose={() => { setFormOpen(false); setEditing(null) }} onSaved={saved} />}{toast && <div className="toast-success" role="status">{toast}</div>}
  </div>
}
