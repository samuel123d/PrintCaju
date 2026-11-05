import { useEffect, useMemo, useRef, useState } from 'react'
import { Bytes } from 'firebase/firestore'
import { useAuth } from '../contexts/AuthContext.jsx'
import useExternalSales from '../hooks/useExternalSales.js'
import useFinancialMaterials from '../hooks/useFinancialMaterials.js'
import useFinancialTransactions from '../hooks/useFinancialTransactions.js'
import useProducts from '../hooks/useProducts.js'
import { createMaterialPurchase, deleteMaterialPurchaseFromHistory, importHistoricalMaterialPurchase, loadMaterialPurchaseForTransaction, updateMaterialPurchaseFromHistory } from '../services/finance/materials.js'
import { calculateFinancialControl } from '../services/finance/control.js'
import { calculatePurchaseBaseQuantity, formatUnit, purchaseUnits } from '../services/finance/units.js'
import { createFinancialTransaction, deleteFinancialTransaction, reclassifyMaterialExpensesAsInvestments, updateFinancialTransaction, voidFinancialTransaction } from '../services/finance/transactions.js'
import { deleteLegacyPurchaseFromHistory } from '../services/inventory/purchases.js'

const categories = {
  income: [
    ['other', 'Outra receita'],
    ['service', 'Serviço'],
    ['refund', 'Reembolso recebido'],
    ['investment', 'Aporte no negócio'],
  ],
  expense: [
    ['investment', 'Investimento'],
    ['materials', 'Materiais e insumos'],
    ['packaging', 'Embalagens'],
    ['shipping', 'Frete e entrega'],
    ['marketing', 'Marketing'],
    ['tools', 'Ferramentas e serviços'],
    ['taxes', 'Impostos e taxas'],
    ['other', 'Outra despesa'],
  ],
}
const categoryLabel = (entry) => categories[entry.type]?.find(([value]) => value === entry.category)?.[1] || 'Outro'
const paymentLabels = { pix: 'Pix', cash: 'Dinheiro', transfer: 'Transferência', debit: 'Cartão de débito', credit: 'Cartão de crédito', other: 'Outro' }
const fundingSourceLabel = (source) => source === 'investment_funds' ? 'Investimentos' : source === 'business_cash' ? 'Caixa da empresa' : 'Não informado'

function localDate() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function localMonth() { return localDate().slice(0, 7) }
function amount(value) { return Number.parseFloat(String(value ?? '0').replace(',', '.')) || 0 }
function money(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0) }
function unitCostMoney(value) { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 6 }).format(Number(value) || 0) }
function convertPackageQuantity(quantity, fromUnit, toUnit) {
  const from = purchaseUnits.find((unit) => unit.value === fromUnit)
  const to = purchaseUnits.find((unit) => unit.value === toUnit)
  if (!from || !to || from.baseUnit !== to.baseUnit || from.dimensions || to.dimensions) return quantity
  return String(Number(quantity) * from.factor / to.factor)
}
function convertDimension(value, fromUnit, toUnit) {
  const factors = { mm: 0.001, cm: 0.01, m: 1 }
  if (!factors[fromUnit] || !factors[toUnit] || !value) return value
  return String(Number(value) * factors[fromUnit] / factors[toUnit])
}
function dateLabel(value) {
  if (!value) return '—'
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR').format(new Date(year, month - 1, day))
}
function monthLabel(value) {
  if (value === 'all') return 'Todo o período'
  if (!value) return ''
  const [year, month] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1))
}
function emptyForm() {
  return { type: 'expense', date: localDate(), description: '', category: 'materials', amount: '', paymentMethod: 'pix', paymentStatus: 'paid', fundingSource: 'business_cash', notes: '' }
}
function emptyMaterialForm() {
  return { materialId: '', name: '', date: localDate(), packageQuantity: '1', packageUnit: 'kg', packageWidth: '', packageLength: '', dimensionUnit: 'cm', packageCost: '', minStock: '0', paymentMethod: 'pix', financialCategory: 'investment', paymentStatus: 'paid', fundingSource: 'business_cash' }
}
function errorMessage(cause) {
  if (cause.code === 'permission-denied') return 'O Firestore bloqueou o lançamento. Confira se as regras permitem gravar em users/{uid}/financialTransactions.'
  if (cause.code === 'unavailable' || cause.code === 'network-request-failed') return 'Sem conexão com o Firestore. Verifique sua internet e tente novamente.'
  return cause.message || 'Não foi possível salvar o lançamento. Confira os dados e tente novamente.'
}

async function compressMaterialPhoto(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Escolha uma imagem JPG, PNG ou WebP.')
  if (file.size > 8 * 1024 * 1024) throw new Error('A imagem original deve ter até 8 MB.')
  const bitmap = await createImageBitmap(file)
  try {
    for (const edge of [960, 800, 640, 512, 384, 256]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      for (const quality of [0.8, 0.68, 0.55, 0.4]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
        if (!blob) throw new Error('Não foi possível preparar a imagem.')
        if (blob.size <= 350 * 1024) return new File([blob], 'material.webp', { type: 'image/webp' })
      }
    }
  } finally { bitmap.close() }
  throw new Error('Não foi possível reduzir a imagem para menos de 350 KB.')
}

function StoredPhoto({ item, className = '' }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    const bytes = item?.photoBytes?.toUint8Array?.()
    if (!bytes?.length) { setSrc(''); return undefined }
    const url = URL.createObjectURL(new Blob([bytes], { type: item.photoContentType || 'image/webp' }))
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [item?.photoBytes, item?.photoContentType])
  return src ? <img className={className} src={src} alt={`Foto de ${item.name}`} /> : null
}

function SummaryCard({ title, value, detail, tone }) {
  return <article className="finance-summary-card"><div><span>{title}</span><span className={`finance-summary-icon finance-tone-${tone}`} aria-hidden="true">{tone === 'income' ? '↗' : tone === 'expense' ? '↘' : tone === 'balance' ? '＝' : '＋'}</span></div><strong>{value}</strong><small>{detail}</small></article>
}

function ControlMetric({ label, value, detail, tone }) {
  return <article className={`finance-control-metric finance-control-${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>
}

function HistoryStockImport({ entry, materials, onCancel, onImported }) {
  const { user, workspaceUid } = useAuth()
  const [materialId, setMaterialId] = useState('')
  const [name, setName] = useState(entry.description.replace(/^compra de material:\s*/i, ''))
  const [packageQuantity, setPackageQuantity] = useState('1')
  const [packageUnit, setPackageUnit] = useState('kg')
  const [packageWidth, setPackageWidth] = useState('')
  const [packageLength, setPackageLength] = useState('')
  const [dimensionUnit, setDimensionUnit] = useState('cm')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const selectedMaterial = materials.find((material) => material.id === materialId)

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!materialId && !name.trim()) return setError('Informe o nome do material.')
    if (!Number.isFinite(Number(packageQuantity)) || Number(packageQuantity) <= 0) return setError('Informe uma quantidade maior que zero.')
    setSaving(true)
    try {
      await importHistoricalMaterialPurchase(workspaceUid, entry.id, {
        name: name.trim(),
        packageQuantity: Number(packageQuantity),
        packageUnit,
        packageWidth: Number(packageWidth),
        packageLength: Number(packageLength),
        dimensionUnit,
      }, user.uid, materialId)
      onImported('Compra antiga vinculada ao estoque; o lançamento financeiro original foi mantido.')
    } catch (cause) {
      setError(cause.message || 'Não foi possível incluir esta compra no estoque.')
    } finally {
      setSaving(false)
    }
  }

  return <tr className="history-stock-import-row"><td colSpan="7"><form className="finance-form history-stock-import" onSubmit={submit}>
    <label>Material existente<select value={materialId} onChange={(event) => {
      const id = event.target.value
      const material = materials.find((item) => item.id === id)
      setMaterialId(id)
      if (material) setPackageUnit(purchaseUnits.find((unit) => unit.baseUnit === material.baseUnit)?.value || 'unidade')
    }}><option value="">Cadastrar como material novo</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.name} ({unitCostMoney(material.unitCost)}/{formatUnit(material.baseUnit)})</option>)}</select></label>
    {!materialId && <label>Nome do material<input required maxLength="120" value={name} onChange={(event) => setName(event.target.value)} /></label>}
    <label>{purchaseUnits.find((unit) => unit.value === packageUnit)?.dimensions ? 'Quantidade de rolos/placas' : 'Quantidade comprada'}<input type="number" min="0.001" step="any" required value={packageQuantity} onChange={(event) => setPackageQuantity(event.target.value)} /></label>
    <label>Unidade<select value={packageUnit} onChange={(event) => {
      const nextUnit = event.target.value
      setPackageQuantity((current) => convertPackageQuantity(current, packageUnit, nextUnit))
      setPackageUnit(nextUnit)
    }}>{purchaseUnits.filter((unit) => !selectedMaterial || unit.baseUnit === selectedMaterial.baseUnit).map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
    {purchaseUnits.find((unit) => unit.value === packageUnit)?.dimensions && <>
      <label>Largura<input type="number" min="0.001" step="any" required value={packageWidth} onChange={(event) => setPackageWidth(event.target.value)} /></label>
      <label>Comprimento<input type="number" min="0.001" step="any" required value={packageLength} onChange={(event) => setPackageLength(event.target.value)} /></label>
      <label>Unidade das medidas<select value={dimensionUnit} onChange={(event) => {
        const nextUnit = event.target.value
        setPackageWidth((current) => convertDimension(current, dimensionUnit, nextUnit))
        setPackageLength((current) => convertDimension(current, dimensionUnit, nextUnit))
        setDimensionUnit(nextUnit)
      }}><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
    </>}
    <div className="history-stock-import-total">Valor do lançamento: <strong>{money(entry.amount)}</strong></div>
    {error && <div className="alert alert-error history-stock-import-error" role="alert">{error}</div>}
    <div className="finance-form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button><button className="button button-primary" disabled={saving}>{saving ? 'Atualizando estoque…' : 'Incluir compra no estoque'}</button></div>
  </form></td></tr>
}

function HistoryStockEditor({ entry, onCancel, onSaved }) {
  const { user, workspaceUid } = useAuth()
  const [purchase, setPurchase] = useState(null)
  const [materialName, setMaterialName] = useState('')
  const [packageQuantity, setPackageQuantity] = useState('')
  const [packageUnit, setPackageUnit] = useState('')
  const [packageWidth, setPackageWidth] = useState('')
  const [packageLength, setPackageLength] = useState('')
  const [dimensionUnit, setDimensionUnit] = useState('cm')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    loadMaterialPurchaseForTransaction(workspaceUid, entry.id).then((result) => {
      if (!active) return
      setPurchase(result)
      setMaterialName(result.materialName || '')
      setPackageQuantity(String(result.packageQuantity))
      setPackageUnit(result.packageUnit)
      setPackageWidth(String(result.packageWidth ?? ''))
      setPackageLength(String(result.packageLength ?? ''))
      setDimensionUnit(result.dimensionUnit || 'cm')
      setLoading(false)
    }).catch((cause) => {
      if (!active) return
      setError(cause.message || 'Não foi possível carregar os dados da compra.')
      setLoading(false)
    })
    return () => { active = false }
  }, [workspaceUid, entry.id])

  async function submit(event) {
    event.preventDefault()
    setError('')
    if (!materialName.trim()) return setError('Informe o nome do material.')
    if (!Number.isFinite(Number(packageQuantity)) || Number(packageQuantity) <= 0) return setError('Informe uma quantidade maior que zero.')
    setSaving(true)
    try {
      await updateMaterialPurchaseFromHistory(workspaceUid, entry.id, Number(packageQuantity), packageUnit, {
        width: packageWidth,
        length: packageLength,
        dimensionUnit,
      }, user.uid, materialName.trim())
      onSaved('Nome, quantidade e unidade atualizados no histórico e no estoque.')
    } catch (cause) {
      setError(cause.message || 'Não foi possível atualizar a compra e o estoque.')
    } finally {
      setSaving(false)
    }
  }

  return <tr className="history-stock-import-row"><td colSpan="7">{loading ? <div className="sales-loading">Carregando dados da compra…</div> : <form className="finance-form history-stock-import" onSubmit={submit}>
    <label>Nome do material<input required maxLength="120" value={materialName} onChange={(event) => setMaterialName(event.target.value)} /></label>
    <label>{purchaseUnits.find((unit) => unit.value === packageUnit)?.dimensions ? 'Quantidade de rolos/placas' : 'Quantidade comprada'}<input type="number" min="0.001" step="any" required value={packageQuantity} onChange={(event) => setPackageQuantity(event.target.value)} /></label>
    <label>Unidade<select required value={packageUnit} onChange={(event) => {
      const nextUnit = event.target.value
      setPackageQuantity((current) => convertPackageQuantity(current, packageUnit, nextUnit))
      setPackageUnit(nextUnit)
    }}>{purchaseUnits.filter((unit) => unit.baseUnit === purchase?.baseUnit).map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
    {purchaseUnits.find((unit) => unit.value === packageUnit)?.dimensions && <>
      <label>Largura<input type="number" min="0.001" step="any" required value={packageWidth} onChange={(event) => setPackageWidth(event.target.value)} /></label>
      <label>Comprimento<input type="number" min="0.001" step="any" required value={packageLength} onChange={(event) => setPackageLength(event.target.value)} /></label>
      <label>Unidade das medidas<select value={dimensionUnit} onChange={(event) => {
        const nextUnit = event.target.value
        setPackageWidth((current) => convertDimension(current, dimensionUnit, nextUnit))
        setPackageLength((current) => convertDimension(current, dimensionUnit, nextUnit))
        setDimensionUnit(nextUnit)
      }}><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
    </>}
    <div className="history-stock-import-total">Valor da compra: <strong>{money(entry.amount)}</strong></div>
    {error && <div className="alert alert-error history-stock-import-error" role="alert">{error}</div>}
    {!loading && <div className="finance-form-actions"><button type="button" className="button button-secondary" onClick={onCancel}>Cancelar</button><button className="button button-primary" disabled={saving || !purchase}>{saving ? 'Atualizando…' : 'Salvar nome, quantidade e estoque'}</button></div>}
  </form>}</td></tr>
}

export default function FinancePage() {
  const { user, workspaceUid } = useAuth()
  const { sales, loading: salesLoading, error: salesError } = useExternalSales()
  const { transactions, loading: transactionsLoading, error: transactionsError } = useFinancialTransactions()
  const { materials, loading: materialsLoading, error: materialsError } = useFinancialMaterials()
  const { products, loading: productsLoading, error: productsError } = useProducts()
  const [month, setMonth] = useState('all')
  const [form, setForm] = useState(emptyForm)
  const [materialForm, setMaterialForm] = useState(emptyMaterialForm)
  const [materialPhotoFile, setMaterialPhotoFile] = useState(null)
  const [materialPhotoPreview, setMaterialPhotoPreview] = useState('')
  const [materialPhotoRemoved, setMaterialPhotoRemoved] = useState(false)
  const [materialPhotoError, setMaterialPhotoError] = useState('')
  const materialPhotoInput = useRef(null)
  useEffect(() => {
    if (!materialPhotoFile) { setMaterialPhotoPreview(''); return undefined }
    const url = URL.createObjectURL(materialPhotoFile)
    setMaterialPhotoPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [materialPhotoFile])
  const [editingId, setEditingId] = useState('')
  const [saving, setSaving] = useState(false)
  const [savingMaterial, setSavingMaterial] = useState(false)
  const [reclassifyingMaterials, setReclassifyingMaterials] = useState(false)
  const [busyId, setBusyId] = useState('')
  const [importingHistoryId, setImportingHistoryId] = useState('')
  const [editingHistoryId, setEditingHistoryId] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const report = useMemo(() => {
    const monthSales = sales.filter((sale) => sale.status !== 'cancelled' && (month === 'all' || sale.soldAt?.startsWith(month)))
    const monthTransactions = transactions.filter((entry) => month === 'all' || entry.date?.startsWith(month))
    const activeTransactions = monthTransactions.filter((entry) => entry.status !== 'cancelled')
    const salesReceived = monthSales.reduce((total, sale) => total + amount(sale.receivedAmount), 0)
    const saleFees = monthSales.reduce((total, sale) => total + amount(sale.fees), 0)
    const otherIncome = activeTransactions.filter((entry) => entry.type === 'income').reduce((total, entry) => total + amount(entry.amount), 0)
    const expenseEntries = activeTransactions.filter((entry) => entry.type === 'expense')
    const paidExpenses = expenseEntries.filter((entry) => entry.paymentStatus !== 'pending')
    const manualExpenses = paidExpenses.filter((entry) => entry.category !== 'investment').reduce((total, entry) => total + amount(entry.amount), 0)
    const investmentExpenses = paidExpenses.filter((entry) => entry.category === 'investment').reduce((total, entry) => total + amount(entry.amount), 0)
    const pendingExpenses = expenseEntries.filter((entry) => entry.paymentStatus === 'pending').reduce((total, entry) => total + amount(entry.amount), 0)
    const expenses = saleFees + manualExpenses
    return { monthTransactions, salesReceived, saleFees, otherIncome, manualExpenses, investmentExpenses, pendingExpenses, expenses, balance: salesReceived + otherIncome - expenses - investmentExpenses }
  }, [month, sales, transactions])
  const control = useMemo(
    () => calculateFinancialControl({ sales, transactions, products, month }),
    [month, sales, transactions, products],
  )

  function resetForm() {
    setForm(emptyForm())
    setEditingId('')
  }

  function startEdit(entry) {
    setEditingId(entry.id)
    setForm({ type: entry.type, date: entry.date, description: entry.description, category: entry.category, amount: String(entry.amount), paymentMethod: entry.paymentMethod || 'other', paymentStatus: entry.paymentStatus || 'paid', fundingSource: entry.fundingSource || 'business_cash', notes: entry.notes || '' })
    setMessage('')
    setError('')
  }

  async function markExpensePaid(entry) {
    setBusyId(entry.id)
    setMessage('')
    setError('')
    try {
      await updateFinancialTransaction(workspaceUid, entry.id, { paymentStatus: 'paid' })
      setMessage(`Despesa “${entry.description}” marcada como paga.`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  async function classifyMaterialPurchaseAsInvestment(entry) {
    if (!window.confirm(`Classificar “${entry.description}” como investimento pago, saindo do caixa da empresa?`)) return
    setBusyId(entry.id)
    setMessage('')
    setError('')
    try {
      await updateFinancialTransaction(workspaceUid, entry.id, {
        category: 'investment',
        paymentStatus: 'paid',
        fundingSource: 'business_cash',
        investmentMaterialPurchase: true,
      })
      setMessage(`“${entry.description}” agora está classificado como investimento pago, saindo do caixa da empresa.`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  async function reclassifyExistingMaterialExpenses() {
    if (!window.confirm('Reclassificar todos os lançamentos ativos de “Materiais e insumos” e “Embalagens” como investimentos pagos, saindo do caixa da empresa? Despesas de outras categorias não serão alteradas.')) return
    setReclassifyingMaterials(true)
    setMessage('')
    setError('')
    try {
      const count = await reclassifyMaterialExpensesAsInvestments(workspaceUid)
      setMessage(count
        ? `${count} lançamento(s) de materiais/embalagens reclassificado(s) como investimento pago, saindo do caixa da empresa.`
        : 'Não há despesas ativas de materiais/embalagens para reclassificar.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setReclassifyingMaterials(false)
    }
  }

  async function submit(event) {
    event.preventDefault()
    setMessage('')
    setError('')
    if (!form.date) return setError('Informe a data do lançamento.')
    if (!form.description.trim()) return setError('Descreva o lançamento.')
    if (amount(form.amount) <= 0) return setError('Informe um valor maior que zero.')

    const entry = {
      type: form.type,
      date: form.date,
      description: form.description.trim(),
      category: form.category,
      amount: Number(amount(form.amount).toFixed(2)),
      paymentMethod: form.paymentMethod,
      paymentStatus: form.type === 'expense' ? form.paymentStatus : 'paid',
      ...(form.type === 'expense' ? { fundingSource: form.fundingSource } : {}),
      notes: form.notes.trim(),
    }
    setSaving(true)
    try {
      if (editingId) await updateFinancialTransaction(workspaceUid, editingId, entry)
      else await createFinancialTransaction(workspaceUid, entry, user.uid)
      setMessage(editingId ? 'Lançamento atualizado.' : 'Lançamento salvo no Firestore.')
      resetForm()
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  async function submitMaterialPurchase(event) {
    event.preventDefault()
    setMessage('')
    setError('')
    const selectedMaterial = materials.find((item) => item.id === materialForm.materialId)
    if (materialForm.materialId && !selectedMaterial) return setError('O material selecionado não está mais disponível.')
    if (!selectedMaterial && !materialForm.name.trim()) return setError('Informe o nome do material.')
    if (!selectedMaterial && materials.some((item) => item.name.trim().toLocaleLowerCase('pt-BR') === materialForm.name.trim().toLocaleLowerCase('pt-BR'))) return setError('Este material já existe. Selecione-o para registrar uma nova compra.')
    if (!materialForm.date) return setError('Informe a data da compra do material.')
    if (!['business_cash', 'investment_funds'].includes(materialForm.fundingSource)) return setError('Selecione de qual saldo saiu o valor da compra.')
    if (!Number.isFinite(Number(materialForm.packageQuantity)) || amount(materialForm.packageQuantity) <= 0) return setError('A quantidade comprada precisa ser um número maior que zero.')
    if (!Number.isFinite(amount(materialForm.packageCost)) || amount(materialForm.packageCost) <= 0) return setError('Informe um valor total da compra maior que zero.')
    if (!selectedMaterial && (!Number.isFinite(Number(materialForm.minStock)) || Number(materialForm.minStock) < 0)) return setError('O estoque mínimo precisa ser um número igual ou maior que zero.')
    const selectedUnit = purchaseUnits.find((unit) => unit.value === materialForm.packageUnit)
    if (!selectedUnit || (selectedMaterial && selectedUnit.baseUnit !== selectedMaterial.baseUnit)) return setError('A unidade de compra não corresponde ao material selecionado.')
    let baseQuantity
    try {
      baseQuantity = calculatePurchaseBaseQuantity(materialForm.packageQuantity, materialForm.packageUnit, materialForm)
    } catch (cause) {
      return setError(cause.message)
    }
    const purchase = {
      ...materialForm,
      name: materialForm.name.trim(),
      packageQuantity: Number(materialForm.packageQuantity),
      packageCost: Number(amount(materialForm.packageCost).toFixed(2)),
      minStock: Number(materialForm.minStock) || 0,
      baseUnit: selectedUnit.baseUnit,
      baseQuantity,
    }
    if (materialPhotoFile) {
      purchase.photoBytes = Bytes.fromUint8Array(new Uint8Array(await materialPhotoFile.arrayBuffer()))
      purchase.photoContentType = materialPhotoFile.type
    } else if (materialPhotoRemoved) {
      purchase.photoBytes = null
      purchase.photoContentType = null
    }
    setSavingMaterial(true)
    try {
      await createMaterialPurchase(workspaceUid, purchase, user.uid, selectedMaterial?.id || '')
      setMaterialForm(emptyMaterialForm())
      setMaterialPhotoFile(null)
      setMaterialPhotoRemoved(false)
      setMessage(materialForm.paymentStatus === 'pending'
        ? `Material cadastrado. Compra pendente. Origem do pagamento: ${fundingSourceLabel(materialForm.fundingSource)}.`
        : materialForm.financialCategory === 'investment'
          ? `Material cadastrado e investimento pago registrado. Origem: ${fundingSourceLabel(materialForm.fundingSource)}; não reduz o lucro operacional.`
          : `Material cadastrado e despesa operacional paga. Origem: ${fundingSourceLabel(materialForm.fundingSource)}.`)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSavingMaterial(false)
    }
  }

  async function voidEntry(entry) {
    if (!window.confirm(`Estornar o lançamento “${entry.description}”? Ele continuará visível no histórico, mas deixará de entrar nos totais.`)) return
    setBusyId(entry.id)
    setMessage('')
    setError('')
    try {
      await voidFinancialTransaction(workspaceUid, entry.id)
      if (editingId === entry.id) resetForm()
      setMessage('Lançamento estornado e mantido no histórico.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  async function deleteEntry(entry) {
    const linkedMaterialPurchase = Boolean(entry.sourceMaterialPurchaseId)
    const confirmation = linkedMaterialPurchase
      ? `Excluir a compra “${entry.description}” e retirar a quantidade correspondente do estoque? O histórico financeiro e a compra vinculada serão removidos.`
      : entry.sourcePurchaseId
        ? `Excluir a compra “${entry.description}” e retirar a quantidade correspondente do estoque do produto? O histórico financeiro e a compra vinculada serão removidos.`
      : `Excluir permanentemente o lançamento “${entry.description}”? Esta ação não pode ser desfeita.`
    if (!window.confirm(confirmation)) return
    setBusyId(entry.id)
    setMessage('')
    setError('')
    try {
      if (linkedMaterialPurchase) await deleteMaterialPurchaseFromHistory(workspaceUid, entry.id)
      else if (entry.sourcePurchaseId) await deleteLegacyPurchaseFromHistory(workspaceUid, entry.id)
      else await deleteFinancialTransaction(workspaceUid, entry.id)
      if (editingId === entry.id) resetForm()
      if (editingHistoryId === entry.id) setEditingHistoryId('')
      if (importingHistoryId === entry.id) setImportingHistoryId('')
      setMessage(entry.sourceMaterialPurchaseId || entry.sourcePurchaseId ? 'Compra e lançamento excluídos; estoque ajustado.' : 'Lançamento excluído permanentemente.')
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setBusyId('')
    }
  }

  const loading = salesLoading || transactionsLoading
  const loadError = salesError || transactionsError
  const selectedMaterial = materials.find((item) => item.id === materialForm.materialId)
  const selectedPurchaseUnit = purchaseUnits.find((unit) => unit.value === materialForm.packageUnit)
  const purchaseBaseUnit = selectedMaterial?.baseUnit || selectedPurchaseUnit?.baseUnit
  const dimensionFactor = { mm: 0.001, cm: 0.01, m: 1 }[materialForm.dimensionUnit]
  const purchasedBaseQuantity = selectedPurchaseUnit?.dimensions
    ? amount(materialForm.packageQuantity) * amount(materialForm.packageWidth) * dimensionFactor * amount(materialForm.packageLength) * dimensionFactor
    : amount(materialForm.packageQuantity) * (selectedPurchaseUnit?.factor || 0)
  const purchaseUnitCost = purchasedBaseQuantity > 0 ? amount(materialForm.packageCost) / purchasedBaseQuantity : 0

  return <div className="page-stack finance-page">
    <div className="page-intro finance-intro"><div><p className="eyebrow">CONTROLE FINANCEIRO</p><h2>Financeiro</h2><p>Veja o que entrou, o que saiu e o resultado do período.</p></div><div className="finance-period-controls"><label>Período<select value={month === 'all' ? 'all' : 'month'} onChange={(event) => setMonth(event.target.value === 'all' ? 'all' : localMonth())}><option value="all">Todo o período</option><option value="month">Selecionar mês</option></select></label>{month !== 'all' && <label>Mês<input type="month" value={month} onChange={(event) => setMonth(event.target.value)} /></label>}</div></div>

    {(loadError || materialsError) && <div className="sales-error" role="alert">{loadError || materialsError}</div>}
    {(message || error) && <div className={`alert ${error ? 'alert-error' : 'alert-success'}`} role={error ? 'alert' : 'status'}>{error || message}</div>}

    <section className="finance-summary-grid" aria-label={`Resumo de ${monthLabel(month)}`}>
      <SummaryCard title="Recebido das vendas" value={loading ? '…' : loadError ? '—' : money(report.salesReceived)} detail="Pagamentos recebidos em vendas ativas" tone="income" />
      <SummaryCard title="Outras receitas" value={loading ? '…' : loadError ? '—' : money(report.otherIncome)} detail="Entradas manuais, incluindo aportes" tone="other" />
      <SummaryCard title="Despesas e taxas" value={loading ? '…' : loadError ? '—' : money(report.expenses)} detail={`${money(report.manualExpenses)} despesas operacionais · ${money(report.saleFees)} taxas`} tone="expense" />
      <SummaryCard title="Compras classificadas como investimento" value={loading ? '…' : loadError ? '—' : money(report.investmentExpenses)} detail="Saídas que não reduzem o lucro operacional" tone="other" />
      <SummaryCard title={month === 'all' ? 'Saldo do período' : 'Saldo do mês'} value={loading ? '…' : loadError ? '—' : money(report.balance)} detail="Movimentação líquida, incluindo aportes" tone="balance" />
    </section>

    {report.pendingExpenses > 0 && <p className="finance-pending-summary">Despesas pendentes de pagamento: <strong>{money(report.pendingExpenses)}</strong>. Elas só entram nos totais de caixa quando forem marcadas como pagas.</p>}

    <section className="panel finance-control-panel" aria-labelledby="finance-control-heading">
      <header className="finance-section-heading"><div><p className="eyebrow">DECISÃO DE CAIXA</p><h3 id="finance-control-heading">Controle de finanças</h3><p>Separe primeiro as despesas e taxas registradas; o saldo livre é o que sobrou das entradas recebidas no período.</p></div><span className="count-chip">{monthLabel(month)}</span></header>
      {productsError && <div className="sales-error" role="alert">{productsError} Os custos por pedido podem estar incompletos.</div>}
      <div className="finance-control-metrics">
        <ControlMetric label="Verba para reposição" value={loading ? '…' : loadError ? '—' : money(control.replenishment)} detail={`${money(control.expenses)} despesas + ${money(control.saleFees)} taxas`} tone="reserve" />
        <ControlMetric label="Lucro operacional de caixa" value={loading ? '…' : loadError ? '—' : money(control.operatingResult)} detail="Entradas recebidas menos despesas e taxas; sem aportes" tone={control.operatingResult < 0 ? 'negative' : 'profit'} />
        <ControlMetric label="Caixa da empresa" value={loading ? '…' : loadError ? '—' : money(control.businessCash)} detail="Saldo após despesas pagas com o caixa da empresa" tone={control.businessCash < 0 ? 'negative' : 'available'} />
        <ControlMetric label="Saldo de investimentos" value={loading ? '…' : loadError ? '—' : money(control.investmentBalance)} detail="Aportes recebidos menos compras pagas com investimento" tone={control.investmentBalance < 0 ? 'negative' : 'investment'} />
        <ControlMetric label="Disponível para gastar" value={loading ? '…' : loadError ? '—' : money(control.freeCash)} detail={control.freeCash < 0 ? `Faltam ${money(Math.abs(control.freeCash))} para cobrir as saídas` : 'Caixa após despesas, investimentos e aportes'} tone={control.freeCash < 0 ? 'negative' : 'available'} />
        <ControlMetric label="Produção estimada dos pedidos" value={salesLoading || productsLoading ? '…' : money(control.estimatedProductionCost)} detail="Referência de reinvestimento calculada pelas fichas técnicas" tone="investment" />
      </div>
      <p className="finance-control-note">A origem da compra define qual saldo diminui: caixa da empresa ou saldo de investimentos. O saldo de investimentos pode ficar negativo se as compras forem maiores que os aportes registrados. Despesas pendentes só entram nos saldos quando forem pagas. Registros antigos sem origem informada são considerados no caixa da empresa até você ajustar a origem em “Editar financeiro”. Investimentos em estoque não reduzem o lucro operacional. Os valores são estimativas das movimentações registradas, não substituem o saldo bancário.</p>

      <div className="finance-control-tables">
        <div className="finance-control-table-wrap">
          <h4>Despesas com materiais</h4>
          {loading ? <div className="sales-loading">Carregando despesas…</div> : control.materialExpenses.length ? <div className="finance-table-scroll"><table className="finance-table finance-control-table"><thead><tr><th>Material / descrição do lançamento</th><th>Registros</th><th className="finance-amount-column">Gasto</th></tr></thead><tbody>{control.materialExpenses.map((entry) => <tr key={entry.name}><td>{entry.name}</td><td>{entry.count}</td><td className="finance-amount finance-amount-expense">{money(entry.amount)}</td></tr>)}</tbody></table></div> : <p className="finance-control-empty">Nenhuma despesa de material registrada neste período.</p>}
        </div>
        <div className="finance-control-table-wrap finance-material-estimates">
          <div className="finance-material-estimates-heading">
            <div><span className="finance-material-estimates-icon" aria-hidden="true">▦</span><span><h4>Materiais estimados nos pedidos</h4><small>Consumo previsto pelas fichas técnicas dos produtos</small></span></div>
            <span className="finance-material-estimates-total"><small>Total estimado</small><strong>{productsLoading ? '…' : money(control.materialUsage.reduce((total, item) => total + item.cost, 0))}</strong></span>
          </div>
          {productsLoading ? <div className="sales-loading">Calculando materiais…</div> : control.materialUsage.length ? <div className="finance-table-scroll"><table className="finance-table finance-control-table"><thead><tr><th>Material</th><th>Consumo previsto</th><th className="finance-amount-column">Custo estimado</th></tr></thead><tbody>{control.materialUsage.map((entry) => <tr key={entry.id}><td><strong>{entry.name}</strong></td><td>{Number(entry.quantity.toFixed(3)).toLocaleString('pt-BR')} {entry.unit}</td><td className="finance-amount"><strong>{money(entry.cost)}</strong></td></tr>)}</tbody></table></div> : <div className="finance-material-estimates-empty"><span aria-hidden="true">▧</span><strong>Sem consumo calculado neste período</strong><small>Cadastre fichas técnicas nos produtos e registre pedidos para ver os materiais previstos aqui.</small></div>}
        </div>
      </div>

      <div className="finance-control-orders">
        <h4>Produção estimada por pedido</h4>
        {salesLoading || productsLoading ? <div className="sales-loading">Calculando custos dos pedidos…</div> : control.orders.length ? <div className="finance-table-scroll"><table className="finance-table finance-control-table"><thead><tr><th>Data</th><th>Pedido / cliente</th><th>Total do pedido</th><th>Custo de produção estimado</th><th>Resultado estimado</th></tr></thead><tbody>{control.orders.map((order) => <tr key={order.id}><td>{dateLabel(order.date)}</td><td><strong>#{order.id.slice(0, 7).toUpperCase()}</strong><small>{order.client}{order.unpricedItems ? ` · ${order.unpricedItems} item(ns) sem custo cadastrado` : ''}</small></td><td>{money(order.total)}</td><td>{money(order.estimatedCost)}</td><td className={order.estimatedResult < 0 ? 'finance-amount-expense' : 'finance-amount-income'}>{money(order.estimatedResult)}<small>Antes de despesas gerais{order.unpricedItems ? ' · estimativa parcial' : ''}</small></td></tr>)}</tbody></table></div> : <p className="finance-control-empty">Nenhum pedido ativo neste período.</p>}
      </div>
    </section>

    <section className="panel finance-entry-panel">
      <header className="finance-section-heading"><div><p className="eyebrow">LANÇAMENTOS</p><h3>{editingId ? 'Editar lançamento' : 'Adicionar receita ou despesa'}</h3><p>As vendas e suas taxas são calculadas automaticamente. Registre aqui outros valores.</p></div></header>
      <form className="finance-form" onSubmit={submit}>
        <label>Tipo<select value={form.type} onChange={(event) => { const type = event.target.value; setForm((current) => ({ ...current, type, category: type === 'income' ? 'other' : 'materials' })) }}><option value="expense">Despesa</option><option value="income">Outra receita</option></select></label>
        <label>Data<input type="date" required value={form.date} onChange={(event) => setForm((current) => ({ ...current, date: event.target.value }))} /></label>
        <label className="finance-description-field">Descrição<input required maxLength={140} value={form.description} onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} placeholder={form.type === 'income' ? 'Ex.: serviço de personalização' : 'Ex.: compra de filamento'} /></label>
        <label>Categoria<select value={form.category} onChange={(event) => setForm((current) => ({ ...current, category: event.target.value }))}>{categories[form.type].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Valor (R$)<input type="number" min="0.01" step="0.01" required value={form.amount} onChange={(event) => setForm((current) => ({ ...current, amount: event.target.value }))} placeholder="0,00" /></label>
        <label>Forma de pagamento<select value={form.paymentMethod} onChange={(event) => setForm((current) => ({ ...current, paymentMethod: event.target.value }))}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {form.type === 'expense' && <label>Situação do pagamento<select value={form.paymentStatus} onChange={(event) => setForm((current) => ({ ...current, paymentStatus: event.target.value }))}><option value="paid">Pago</option><option value="pending">Pendente</option></select></label>}
        {form.type === 'expense' && <label>Origem do dinheiro<select value={form.fundingSource} onChange={(event) => setForm((current) => ({ ...current, fundingSource: event.target.value }))}><option value="business_cash">Caixa da empresa</option><option value="investment_funds">Investimentos / aportes</option></select></label>}
        <label className="finance-notes-field">Observação <span className="optional-label">opcional</span><input maxLength={240} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} placeholder="Detalhes para seu controle" /></label>
        <div className="finance-form-actions">{editingId && <button className="button button-secondary" type="button" onClick={resetForm}>Cancelar edição</button>}<button className="button button-primary" disabled={saving}>{saving ? 'Salvando…' : editingId ? 'Salvar alterações' : 'Salvar lançamento'}</button></div>
      </form>
    </section>

    <section className="panel finance-entry-panel materials-finance-panel">
      <header className="finance-section-heading"><div><p className="eyebrow">MATERIAIS E INSUMOS</p><h3>Estoque de materiais</h3><p>Registre a compra e classifique o valor como investimento ou despesa operacional, além de indicar se já foi pago.</p></div></header>
      <form className="finance-form material-purchase-form" onSubmit={submitMaterialPurchase}>
        <label>Material<select value={materialForm.materialId} onChange={(event) => {
          const materialId = event.target.value
          const selected = materials.find((item) => item.id === materialId)
          const packageUnit = selected ? purchaseUnits.find((unit) => unit.baseUnit === selected.baseUnit)?.value || 'unidade' : 'kg'
          setMaterialForm((current) => ({ ...current, materialId, packageUnit, packageWidth: '', packageLength: '' }))
          setMaterialPhotoFile(null)
          setMaterialPhotoRemoved(false)
          setMaterialPhotoError('')
        }}><option value="">Cadastrar material novo</option>{materials.map((material) => <option key={material.id} value={material.id}>{material.name}</option>)}</select></label>
        {materialForm.materialId ? <div className="material-selected-summary"><strong>{materials.find((item) => item.id === materialForm.materialId)?.name}</strong><small>Estoque: {Number(materials.find((item) => item.id === materialForm.materialId)?.stockQuantity || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {formatUnit(materials.find((item) => item.id === materialForm.materialId)?.baseUnit)}</small></div> : <label className="finance-description-field">Nome do material<input required maxLength={120} value={materialForm.name} onChange={(event) => setMaterialForm((current) => ({ ...current, name: event.target.value }))} placeholder="Ex.: Filamento PLA" /></label>}
        <div className="material-photo-control"><div className="material-photo-preview">{materialPhotoPreview ? <img src={materialPhotoPreview} alt="Prévia da foto do material" /> : !materialPhotoRemoved && selectedMaterial?.photoBytes ? <StoredPhoto item={selectedMaterial} /> : <span>Sem foto</span>}</div><div><strong>Foto do material</strong><small>Ajuda a identificar o insumo no estoque.</small><div className="product-photo-actions"><button type="button" className="button button-secondary" onClick={() => materialPhotoInput.current?.click()}>{selectedMaterial?.photoBytes && !materialPhotoRemoved ? 'Trocar foto' : 'Adicionar foto'}</button>{(materialPhotoFile || (selectedMaterial?.photoBytes && !materialPhotoRemoved)) && <button type="button" className="button button-quiet" onClick={() => { setMaterialPhotoFile(null); setMaterialPhotoRemoved(true); setMaterialPhotoError(''); if (materialPhotoInput.current) materialPhotoInput.current.value = '' }}>Remover foto</button>}</div><input ref={materialPhotoInput} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; setMaterialPhotoError(''); try { setMaterialPhotoFile(await compressMaterialPhoto(file)); setMaterialPhotoRemoved(false) } catch (cause) { setMaterialPhotoError(cause.message); event.target.value = '' } }} />{materialPhotoError && <small className="product-photo-error" role="alert">{materialPhotoError}</small>}</div></div>
        <label>Data da compra<input type="date" required value={materialForm.date} onChange={(event) => setMaterialForm((current) => ({ ...current, date: event.target.value }))} /></label>
        <label>{selectedPurchaseUnit?.dimensions ? 'Quantidade de rolos/placas' : 'Quantidade comprada'}<input type="number" min="0.001" step="any" required value={materialForm.packageQuantity} onChange={(event) => setMaterialForm((current) => ({ ...current, packageQuantity: event.target.value }))} /></label>
        <label>Unidade<select value={materialForm.packageUnit} onChange={(event) => {
          const nextUnit = event.target.value
          setMaterialForm((current) => ({
            ...current,
            packageQuantity: convertPackageQuantity(current.packageQuantity, current.packageUnit, nextUnit),
            packageUnit: nextUnit,
          }))
        }}>{purchaseUnits.filter((unit) => !materialForm.materialId || unit.baseUnit === materials.find((item) => item.id === materialForm.materialId)?.baseUnit).map((unit) => <option key={unit.value} value={unit.value}>{unit.label}</option>)}</select></label>
        {selectedPurchaseUnit?.dimensions && <>
          <label>Largura do rolo/placa<input type="number" min="0.001" step="any" required value={materialForm.packageWidth} onChange={(event) => setMaterialForm((current) => ({ ...current, packageWidth: event.target.value }))} /></label>
          <label>Comprimento do rolo/placa<input type="number" min="0.001" step="any" required value={materialForm.packageLength} onChange={(event) => setMaterialForm((current) => ({ ...current, packageLength: event.target.value }))} /></label>
          <label>Unidade das medidas<select value={materialForm.dimensionUnit} onChange={(event) => {
            const nextUnit = event.target.value
            setMaterialForm((current) => ({
              ...current,
              packageWidth: convertDimension(current.packageWidth, current.dimensionUnit, nextUnit),
              packageLength: convertDimension(current.packageLength, current.dimensionUnit, nextUnit),
              dimensionUnit: nextUnit,
            }))
          }}><option value="mm">mm</option><option value="cm">cm</option><option value="m">m</option></select></label>
        </>}
        <label>Valor total da compra (R$)<input type="number" min="0.01" step="0.01" required value={materialForm.packageCost} onChange={(event) => setMaterialForm((current) => ({ ...current, packageCost: event.target.value }))} placeholder="0,00" />{purchaseUnitCost > 0 && <small>Custo desta compra: {unitCostMoney(purchaseUnitCost)} / {formatUnit(purchaseBaseUnit)}</small>}</label>
        {!materialForm.materialId && <label>Estoque mínimo ({formatUnit(purchaseBaseUnit)})<input type="number" min="0" step="any" value={materialForm.minStock} onChange={(event) => setMaterialForm((current) => ({ ...current, minStock: event.target.value }))} /></label>}
        <label>Forma de pagamento<select value={materialForm.paymentMethod} onChange={(event) => setMaterialForm((current) => ({ ...current, paymentMethod: event.target.value }))}>{Object.entries(paymentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Origem do dinheiro<select required value={materialForm.fundingSource} onChange={(event) => setMaterialForm((current) => ({ ...current, fundingSource: event.target.value }))}><option value="business_cash">Caixa da empresa</option><option value="investment_funds">Investimentos / aportes</option></select><small>O valor será descontado do saldo escolhido, mesmo que o saldo de investimentos fique negativo.</small></label>
        <label>Natureza do gasto<select value={materialForm.financialCategory} onChange={(event) => setMaterialForm((current) => ({ ...current, financialCategory: event.target.value }))}><option value="investment">Investimento em estoque (não reduz o lucro operacional)</option><option value="materials">Despesa operacional</option></select></label>
        <label>Situação do pagamento<select value={materialForm.paymentStatus} onChange={(event) => setMaterialForm((current) => ({ ...current, paymentStatus: event.target.value }))}><option value="paid">Já pago</option><option value="pending">Pendente</option></select></label>
        <div className="finance-form-actions"><button className="button button-primary" disabled={savingMaterial}>{savingMaterial ? 'Salvando…' : 'Registrar compra e material'}</button></div>
      </form>
      {materialsLoading ? <div className="sales-loading">Carregando materiais…</div> : materials.length === 0 ? <div className="finance-empty"><strong>Nenhum material cadastrado</strong><small>Registre filamento, papel, plástico-bolha, embalagens ou outros insumos acima.</small></div> : <div className="finance-table-scroll"><table className="finance-table materials-table"><thead><tr><th>Material</th><th>Estoque atual</th><th>Estoque mínimo</th><th>Custo médio por unidade</th><th>Valor em estoque</th></tr></thead><tbody>{materials.map((material) => {
        const lowStock = Number(material.stockQuantity) <= Number(material.minStock)
        return <tr className={lowStock ? 'material-low-row' : ''} key={material.id}><td><strong>{material.name}</strong>{lowStock && <small className="material-low-label">Estoque baixo</small>}</td><td>{Number(material.stockQuantity).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {formatUnit(material.baseUnit)}</td><td>{Number(material.minStock || 0).toLocaleString('pt-BR', { maximumFractionDigits: 3 })} {formatUnit(material.baseUnit)}</td><td>{unitCostMoney(material.unitCost)} / {formatUnit(material.baseUnit)}</td><td>{money(Number(material.stockQuantity) * Number(material.unitCost))}</td></tr>
      })}</tbody></table></div>}
    </section>

    <section className="panel finance-ledger-panel finance-history-ledger">
      <header className="finance-section-heading finance-ledger-heading"><div><p className="eyebrow">HISTÓRICO</p><h3>Lançamentos de {monthLabel(month)}</h3><p>Vendas aparecem no resumo; esta lista mostra receitas adicionais e despesas manuais.</p><button type="button" className="button button-secondary" disabled={transactionsLoading || reclassifyingMaterials} onClick={reclassifyExistingMaterialExpenses}>{reclassifyingMaterials ? 'Reclassificando…' : 'Corrigir despesas antigas de materiais'}</button><small>Reclassifica todos os lançamentos ativos de materiais e embalagens como investimento pago, debitado do caixa da empresa.</small></div><span className="count-chip">{report.monthTransactions.length} registros</span></header>
      {transactionsLoading ? <div className="sales-loading">Carregando lançamentos…</div> : report.monthTransactions.length === 0 ? <div className="finance-empty"><span aria-hidden="true">＋</span><strong>Nenhum lançamento manual {month === 'all' ? 'no período' : 'neste mês'}</strong><small>Use o formulário acima para registrar despesas ou outras receitas.</small></div> : <div className="finance-table-scroll"><table className="finance-table"><thead><tr><th>Data</th><th>Lançamento</th><th>Categoria</th><th>Pagamento</th><th>Origem do dinheiro</th><th>Status</th><th className="finance-amount-column">Valor</th><th>Ações</th></tr></thead><tbody>{report.monthTransactions.map((entry) => {
        const cancelled = entry.status === 'cancelled'
        const materialPurchase = Boolean(entry.sourceMaterialPurchaseId)
        const canImportStock = entry.type === 'expense'
          && (['materials', 'packaging'].includes(entry.category) || entry.investmentMaterialPurchase === true)
          && !materialPurchase && !cancelled
        return [<tr className={cancelled ? 'finance-voided-row' : ''} key={entry.id}>
          <td>{dateLabel(entry.date)}</td>
          <td><strong>{entry.description}</strong>{entry.notes && <small>{entry.notes}</small>}</td>
          <td>{categoryLabel(entry)}</td>
          <td>{paymentLabels[entry.paymentMethod] || 'Outro'}</td>
          <td>{entry.type === 'expense' ? fundingSourceLabel(entry.fundingSource) : '—'}</td>
          <td><span className={`finance-kind finance-kind-${entry.type}`}>{cancelled ? 'Estornado' : entry.type === 'income' ? 'Receita' : entry.paymentStatus === 'pending' ? 'Pendente' : 'Pago'}</span>{!cancelled && entry.type === 'expense' && entry.paymentStatus === 'pending' && <button type="button" className="finance-row-pay-action" disabled={busyId === entry.id} onClick={() => markExpensePaid(entry)}>{busyId === entry.id ? 'Salvando…' : 'Marcar como paga'}</button>}</td>
          <td className={`finance-amount finance-amount-${entry.type}`}>{entry.type === 'income' ? '+' : '−'} {money(entry.amount)}</td>
          <td><div className="finance-row-actions">{!cancelled && entry.type === 'expense' && ['materials', 'packaging'].includes(entry.category) && <button type="button" className="finance-row-pay-action" disabled={busyId === entry.id || saving} onClick={() => classifyMaterialPurchaseAsInvestment(entry)}>Classificar como investimento</button>}<button type="button" disabled={cancelled || busyId === entry.id || saving} onClick={() => materialPurchase ? setEditingHistoryId(editingHistoryId === entry.id ? '' : entry.id) : startEdit(entry)}>{materialPurchase ? editingHistoryId === entry.id ? 'Fechar edição' : 'Editar quantidade' : 'Editar'}</button>{materialPurchase && <button type="button" disabled={cancelled || busyId === entry.id || saving} onClick={() => startEdit(entry)}>Editar financeiro</button>}<button type="button" className="finance-void-action" title={materialPurchase ? 'Estornar não é permitido para uma compra vinculada ao estoque.' : undefined} disabled={materialPurchase || cancelled || busyId === entry.id || saving} onClick={() => voidEntry(entry)}>{busyId === entry.id ? 'Processando…' : 'Estornar'}</button><button type="button" className="finance-void-action" disabled={busyId === entry.id || saving || (cancelled && materialPurchase)} onClick={() => deleteEntry(entry)}>{busyId === entry.id ? 'Excluindo…' : 'Excluir'}</button>{canImportStock && <button type="button" onClick={() => setImportingHistoryId(importingHistoryId === entry.id ? '' : entry.id)}>{importingHistoryId === entry.id ? 'Fechar estoque' : 'Incluir no estoque'}</button>}</div></td>
        </tr>, ...(importingHistoryId === entry.id && canImportStock ? [<HistoryStockImport key={`${entry.id}-stock-import`} entry={entry} materials={materials} onCancel={() => setImportingHistoryId('')} onImported={(successMessage) => { setImportingHistoryId(''); setMessage(successMessage) }} />] : []), ...(editingHistoryId === entry.id && materialPurchase && !cancelled ? [<HistoryStockEditor key={`${entry.id}-stock-edit`} entry={entry} onCancel={() => setEditingHistoryId('')} onSaved={(successMessage) => { setEditingHistoryId(''); setMessage(successMessage) }} />] : [])]
      })}</tbody></table></div>}
    </section>
    <p className="finance-footnote">Valores recebidos e taxas são calculados a partir das vendas ativas pela data da venda. Não registre essas mesmas vendas como receitas manuais.</p>
  </div>
}
