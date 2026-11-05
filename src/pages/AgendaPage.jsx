import { useEffect, useMemo, useRef, useState } from 'react'
import { GoogleAuthProvider, linkWithPopup, reauthenticateWithPopup } from 'firebase/auth'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.jsx'
import { auth } from '../services/firebase/config.js'
import { createAgendaItem, removeAgendaItem, updateAgendaItem, watchAgendaItems } from '../services/agenda/agenda.js'

const statusLabels = { open: 'Em aberto', in_progress: 'Em andamento', completed: 'Finalizado', cancelled: 'Cancelado' }
const statusOf = (item) => item.status || (item.completed ? 'completed' : 'open')
const timeZone = 'America/Sao_Paulo'

function localDate() {
  const today = new Date()
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
}

function blankItem() { return { title: '', type: 'task', date: localDate(), time: '', priority: 'normal', details: '', status: 'open', reminder: false } }
function pendingDeletesKey(uid) { return `printcaju-agenda-google-deletes-${uid}` }
function pendingUpdatesKey(uid) { return `printcaju-agenda-google-updates-${uid}` }
function readPendingDeletes(uid) {
  try { return JSON.parse(localStorage.getItem(pendingDeletesKey(uid)) || '[]') } catch { return [] }
}
function queueGoogleDelete(uid, eventId) {
  if (!uid || !eventId) return
  const pending = new Set(readPendingDeletes(uid))
  pending.add(eventId)
  localStorage.setItem(pendingDeletesKey(uid), JSON.stringify([...pending]))
}
function clearGoogleDelete(uid, eventId) {
  localStorage.setItem(pendingDeletesKey(uid), JSON.stringify(readPendingDeletes(uid).filter((id) => id !== eventId)))
}
function readPendingUpdates(uid) {
  try { return JSON.parse(localStorage.getItem(pendingUpdatesKey(uid)) || '{}') } catch { return {} }
}
function queueGoogleUpdate(uid, eventId, item) {
  if (!uid || !eventId) return
  const pending = readPendingUpdates(uid)
  pending[eventId] = { title: item.title, date: item.date, time: item.time || '', details: item.details || '' }
  localStorage.setItem(pendingUpdatesKey(uid), JSON.stringify(pending))
}
function clearGoogleUpdate(uid, eventId) {
  const pending = readPendingUpdates(uid)
  delete pending[eventId]
  localStorage.setItem(pendingUpdatesKey(uid), JSON.stringify(pending))
}
function dateLabel(value) {
  if (!value) return 'Sem data'
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(new Date(year, month - 1, day))
}

function googleError(error) {
  if (error.code === 'auth/operation-not-allowed') return 'Ative o provedor Google em Firebase Authentication > Provedores de acesso.'
  if (error.code === 'auth/unauthorized-domain') return 'Adicione este domínio em Firebase Authentication > Configurações > Domínios autorizados.'
  if (error.code === 'auth/popup-blocked') return 'O navegador bloqueou a janela de conexão. Permita pop-ups e tente novamente.'
  return error.message || 'Não foi possível conectar ao Google Agenda.'
}

function googleEventBody(item) {
  const start = item.time
    ? { dateTime: `${item.date}T${item.time}:00`, timeZone }
    : { date: item.date }
  const nextDate = new Date(`${item.date}T00:00:00`)
  nextDate.setDate(nextDate.getDate() + 1)
  const end = item.time
    ? { dateTime: new Date(new Date(`${item.date}T${item.time}:00`).getTime() + 60 * 60 * 1000).toISOString(), timeZone }
    : { date: `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(nextDate.getDate()).padStart(2, '0')}` }
  return { summary: item.title, description: item.details || '', start, end, reminders: { useDefault: true } }
}

export default function AgendaPage() {
  const [searchParams] = useSearchParams()
  const alertItemId = searchParams.get('item') || ''
  const { user, workspaceUid } = useAuth()
  const [items, setItems] = useState([])
  const itemsRef = useRef([])
  itemsRef.current = items
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [filter, setFilter] = useState('open')
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedItemIds, setSelectedItemIds] = useState(() => new Set())
  const [deletingSelected, setDeletingSelected] = useState(false)
  const [form, setForm] = useState(blankItem)
  const [editing, setEditing] = useState(null)
  const editorRef = useRef(null)
  const titleInputRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [googleToken, setGoogleToken] = useState('')
  const [googleEmail, setGoogleEmail] = useState('')
  const syncRunningRef = useRef(false)
  const sentEventIdsRef = useRef(new Set())
  const [permission, setPermission] = useState(typeof Notification === 'undefined' ? 'unsupported' : Notification.permission)

  useEffect(() => {
    if (!workspaceUid) { setItems([]); setLoading(false); return undefined }
    setLoading(true)
    return watchAgendaItems(workspaceUid, (rows) => { setItems(rows); setLoading(false); setError('') }, () => {
      setError('Não foi possível carregar a agenda. Confira a conexão com o Firestore.')
      setLoading(false)
    })
  }, [workspaceUid])

  useEffect(() => {
    if (!alertItemId || loading || !items.some((item) => item.id === alertItemId)) return undefined
    setFilter('all')
    const timer = window.setTimeout(() => document.getElementById(`agenda-item-${alertItemId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 80)
    return () => window.clearTimeout(timer)
  }, [alertItemId, items, loading])

  useEffect(() => {
    setSelectedItemIds((current) => new Set([...current].filter((id) => items.some((item) => item.id === id))))
  }, [items])

  useEffect(() => {
    if (permission !== 'granted' || !user?.uid) return undefined
    const check = () => {
      const now = new Date()
      const due = items.filter((item) => item.reminder && !['completed', 'cancelled'].includes(statusOf(item)) && item.date && new Date(`${item.date}T${item.time || '09:00'}:00`) <= now && now - new Date(`${item.date}T${item.time || '09:00'}:00`) < 60_000)
      due.forEach((item) => {
        const key = `printcaju-agenda-${user.uid}-${item.id}`
        if (localStorage.getItem(key)) return
        localStorage.setItem(key, 'sent')
        const notification = new Notification(item.type === 'meeting' ? 'Reunião na agenda' : 'Lembrete de tarefa', { body: `${item.title}${item.time ? ` · ${item.time}` : ''}`, icon: '/printcaju-mark.png' })
        notification.onclick = () => { window.focus(); window.location.href = `/admin/agenda?item=${encodeURIComponent(item.id)}`; notification.close() }
      })
    }
    check()
    const timer = window.setInterval(check, 30_000)
    return () => window.clearInterval(timer)
  }, [items, permission, user?.uid])

  // Only send local agenda changes to Google; never fetch or import Google events.
  useEffect(() => {
    if (!googleToken || !workspaceUid || loading) return undefined
    let active = true
    const sendLocalChanges = async () => {
      if (syncRunningRef.current) return
      syncRunningRef.current = true
      try {
        for (const eventId of readPendingDeletes(user?.uid)) {
          await syncGoogle('DELETE', eventId, undefined, googleToken)
          clearGoogleDelete(user.uid, eventId)
          clearGoogleUpdate(user.uid, eventId)
        }
        for (const [eventId, item] of Object.entries(readPendingUpdates(user?.uid))) {
          await syncGoogle('PATCH', eventId, item, googleToken)
          clearGoogleUpdate(user.uid, eventId)
        }
        for (const local of [...itemsRef.current]) {
          if (!active || !local.id || local.googleEventId || sentEventIdsRef.current.has(local.id) || statusOf(local) === 'cancelled' || !local.date) continue
          sentEventIdsRef.current.add(local.id)
          try {
            const created = await syncGoogle('POST', '', local, googleToken)
            await updateAgendaItem(workspaceUid, local.id, { googleEventId: created.id })
            itemsRef.current = itemsRef.current.map((item) => item.id === local.id ? { ...item, googleEventId: created.id } : item)
          } catch (cause) {
            sentEventIdsRef.current.delete(local.id)
            throw cause
          }
        }
        if (active) setError('')
      } catch (cause) {
        if (active) setError(cause.message || 'Não foi possível enviar os itens ao Google Agenda.')
      } finally { syncRunningRef.current = false }
    }
    sendLocalChanges()
    const timer = window.setInterval(sendLocalChanges, 60_000)
    return () => { active = false; window.clearInterval(timer) }
  }, [googleToken, workspaceUid, user?.uid, loading])

  const openItems = items.filter((item) => statusOf(item) === 'open')
  const counts = Object.fromEntries(Object.keys(statusLabels).map((status) => [status, items.filter((item) => statusOf(item) === status).length]))
  const visibleItems = useMemo(() => items.filter((item) => filter === 'all' || statusOf(item) === filter).sort((a, b) => `${a.date || ''}T${a.time || ''}`.localeCompare(`${b.date || ''}T${b.time || ''}`)), [items, filter])
  const selectedVisibleCount = visibleItems.filter((item) => selectedItemIds.has(item.id)).length

  function toggleItemSelection(itemId) {
    setSelectedItemIds((current) => {
      const next = new Set(current)
      if (next.has(itemId)) next.delete(itemId)
      else next.add(itemId)
      return next
    })
  }

  function toggleVisibleSelection() {
    setSelectedItemIds((current) => {
      const next = new Set(current)
      if (selectedVisibleCount === visibleItems.length) visibleItems.forEach((item) => next.delete(item.id))
      else visibleItems.forEach((item) => next.add(item.id))
      return next
    })
  }

  function closeSelectionMode() {
    setSelectionMode(false)
    setSelectedItemIds(new Set())
  }

  async function deleteSelectedItems() {
    const selectedItems = items.filter((item) => selectedItemIds.has(item.id))
    if (!selectedItems.length) return
    if (!window.confirm(`Excluir ${selectedItems.length} item(ns) selecionado(s) da agenda e do Firestore? A ação não pode ser desfeita.${googleToken ? ' Os eventos vinculados também serão removidos do Google Agenda.' : ''}`)) return
    setDeletingSelected(true)
    setError('')
    setNotice('')
    const failed = []
    let pendingGoogleDeletes = 0
    for (const item of selectedItems) {
      try {
        if (item.googleEventId && statusOf(item) !== 'cancelled') {
          const pending = await deleteGoogleOrQueue(item.googleEventId)
          if (pending) pendingGoogleDeletes += 1
        }
        await removeAgendaItem(workspaceUid, item.id)
        itemsRef.current = itemsRef.current.filter((entry) => entry.id !== item.id)
        setItems((current) => current.filter((entry) => entry.id !== item.id))
        setSelectedItemIds((current) => {
          const next = new Set(current)
          next.delete(item.id)
          return next
        })
      } catch (cause) {
        failed.push(`${item.title}: ${cause.message || 'falha ao excluir'}`)
      }
    }
    if (failed.length) setError(`Não foi possível excluir ${failed.length} item(ns): ${failed.join('; ')}`)
    else setNotice(`${selectedItems.length} item(ns) excluído(s) da agenda.`)
    if (pendingGoogleDeletes) setNotice((current) => `${current} A remoção de ${pendingGoogleDeletes} evento(s) do Google ficará pendente até conectar a conta.`)
    setDeletingSelected(false)
  }

  function startEdit(item) {
    setEditing(item.id)
    setForm({ ...blankItem(), ...item, status: statusOf(item) })
    setError('')
    requestAnimationFrame(() => {
      editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      titleInputRef.current?.focus({ preventScroll: true })
    })
  }

  function cancelEdit() { setEditing(null); setForm(blankItem()) }

  async function saveItem(event) {
    event.preventDefault()
    if (!workspaceUid) return
    setBusy(true); setError(''); setNotice('')
    try {
      if (editing) {
        const original = items.find((item) => item.id === editing)
        const originalStatus = statusOf(original || {})
        if (form.status === 'cancelled') {
          let remotePending = false
          if (original?.googleEventId && originalStatus !== 'cancelled') remotePending = await deleteGoogleOrQueue(original.googleEventId)
          await removeAgendaItem(workspaceUid, editing)
          itemsRef.current = itemsRef.current.filter((item) => item.id !== editing)
          setNotice(remotePending ? 'Item removido do Firestore. A exclusão no Google ficará pendente até você reconectar a conta.' : 'Item cancelado e removido do Firestore e do Google Agenda.')
          cancelEdit()
          return
        }
        let updatedForm = { ...form, completed: form.status === 'completed' }
        if (original?.googleEventId && form.status === 'cancelled' && originalStatus !== 'cancelled') {
          await syncGoogle('DELETE', original.googleEventId)
        } else if (original?.googleEventId && originalStatus === 'cancelled' && form.status !== 'cancelled') {
          if (!googleToken) throw new Error('Conecte novamente ao Google Agenda para reativar este evento.')
          const response = await syncGoogle('POST', '', form)
          updatedForm.googleEventId = response.id
        } else if (original?.googleEventId && originalStatus !== 'cancelled') {
          const remotePending = await updateGoogleOrQueue(original.googleEventId, form)
          if (remotePending) setNotice('Alterações salvas no Firestore. Serão enviadas ao Google quando você reconectar a conta.')
        }
        else if (!original?.googleEventId && googleToken && form.status !== 'cancelled') {
          const response = await syncGoogle('POST', '', form)
          updatedForm.googleEventId = response.id
        }
        await updateAgendaItem(workspaceUid, editing, updatedForm)
      } else {
        if (form.status === 'cancelled') {
          setNotice('Um item novo não pode ser criado já cancelado.')
          cancelEdit()
          return
        }
        const payload = { ...form, completed: form.status === 'completed' }
        if (googleToken && form.date && form.status !== 'cancelled') {
          const response = await syncGoogle('POST', '', payload)
          payload.googleEventId = response.id
        }
        await createAgendaItem(workspaceUid, payload)
      }
      setNotice(googleToken && form.date ? 'Item salvo e sincronizado com o Google Agenda.' : 'Item salvo na agenda.')
      cancelEdit()
    } catch (cause) { setError(cause.message || 'Não foi possível salvar o item.') }
    finally { setBusy(false) }
  }

  async function syncGoogle(method, id, item, token = googleToken) {
    const url = `https://www.googleapis.com/calendar/v3/calendars/primary/events${id ? `/${encodeURIComponent(id)}` : ''}`
    const response = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(method === 'DELETE' ? {} : { body: JSON.stringify(googleEventBody(item)) }) })
    if (method === 'DELETE' && (response.status === 404 || response.status === 410)) return null
    if (!response.ok) {
      const details = await response.json().catch(() => ({}))
      throw new Error(details.error?.message || 'Falha ao sincronizar com o Google Agenda. Reconecte a conta e tente novamente.')
    }
    return method === 'DELETE' ? null : response.json()
  }

  async function deleteGoogleOrQueue(eventId) {
    clearGoogleUpdate(user?.uid, eventId)
    if (!googleToken) { queueGoogleDelete(user?.uid, eventId); return true }
    try {
      await syncGoogle('DELETE', eventId)
      return false
    } catch {
      queueGoogleDelete(user?.uid, eventId)
      return true
    }
  }

  async function updateGoogleOrQueue(eventId, item) {
    if (!googleToken) { queueGoogleUpdate(user?.uid, eventId, item); return true }
    try {
      await syncGoogle('PATCH', eventId, item)
      return false
    } catch {
      queueGoogleUpdate(user?.uid, eventId, item)
      return true
    }
  }

  async function connectGoogle() {
    setBusy(true); setError(''); setNotice('')
    try {
      const provider = new GoogleAuthProvider()
      provider.addScope('https://www.googleapis.com/auth/calendar.events')
      provider.setCustomParameters({ prompt: 'consent select_account' })
      const alreadyGoogle = user?.providerData?.some((entry) => entry.providerId === 'google.com')
      const result = alreadyGoogle ? await reauthenticateWithPopup(auth.currentUser, provider) : await linkWithPopup(auth.currentUser, provider)
      const credential = GoogleAuthProvider.credentialFromResult(result)
      if (!credential?.accessToken) throw new Error('O Google não retornou autorização para a agenda. Tente conectar novamente.')
      const token = credential.accessToken
      syncRunningRef.current = true
      setGoogleToken(credential.accessToken)
      setGoogleEmail(result.user.providerData.find((entry) => entry.providerId === 'google.com')?.email || result.user.email || '')
      const pendingItems = itemsRef.current.filter((item) => item.id && !item.googleEventId && statusOf(item) !== 'cancelled' && item.date)
      const failedItems = []
      for (const item of pendingItems) {
        sentEventIdsRef.current.add(item.id)
        try {
          const created = await syncGoogle('POST', '', item, token)
          await updateAgendaItem(workspaceUid, item.id, { googleEventId: created.id })
          itemsRef.current = itemsRef.current.map((current) => current.id === item.id ? { ...current, googleEventId: created.id } : current)
          setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, googleEventId: created.id } : entry))
        } catch (cause) {
          sentEventIdsRef.current.delete(item.id)
          failedItems.push(`${item.title}: ${cause.message || 'falha no envio'}`)
        }
      }
      if (failedItems.length) {
        setError(`Google conectado, mas não foi possível enviar ${failedItems.length} item(ns): ${failedItems.join('; ')}`)
        setNotice(`${pendingItems.length - failedItems.length} de ${pendingItems.length} item(ns) enviado(s).`)
      } else {
        setNotice(pendingItems.length
          ? `${pendingItems.length} item(ns) enviado(s) ao Google Agenda. Eventos criados diretamente no Google não são importados.`
          : 'Google Agenda conectado. Os itens já estavam enviados; novos itens serão enviados automaticamente.')
      }
    } catch (cause) { setError(googleError(cause)) }
    finally { syncRunningRef.current = false; setBusy(false) }
  }

  async function changeStatus(item, status) {
    setError(''); setNotice('')
    try {
      if (status === 'cancelled' && item.googleEventId) {
        const remotePending = await deleteGoogleOrQueue(item.googleEventId)
        await removeAgendaItem(workspaceUid, item.id)
        itemsRef.current = itemsRef.current.filter((entry) => entry.id !== item.id)
        setNotice(remotePending ? 'Item removido do Firestore. A exclusão no Google ficará pendente até você reconectar a conta.' : 'Item cancelado e removido do Firestore e do Google Agenda.')
        return
      }
      if (status === 'cancelled') {
        await removeAgendaItem(workspaceUid, item.id)
        itemsRef.current = itemsRef.current.filter((entry) => entry.id !== item.id)
        setNotice('Item cancelado e removido do Firestore e do Google Agenda.')
        return
      }
      await updateAgendaItem(workspaceUid, item.id, { status, completed: status === 'completed' })
      setNotice(status === 'cancelled' ? 'Item cancelado na agenda e no Google Agenda.' : `Item marcado como ${statusLabels[status].toLowerCase()}.`)
    } catch (cause) { setError(cause.message || 'Não foi possível atualizar o status.') }
  }

  async function deleteItem(item) {
    if (!window.confirm(`Excluir “${item.title}” permanentemente da agenda do sistema (Firestore)${item.googleEventId ? ' e do Google Agenda' : ''}?`)) return
    try {
      const remotePending = item.googleEventId && statusOf(item) !== 'cancelled' ? await deleteGoogleOrQueue(item.googleEventId) : false
      await removeAgendaItem(workspaceUid, item.id)
      itemsRef.current = itemsRef.current.filter((entry) => entry.id !== item.id)
      setNotice(remotePending ? 'Item removido do Firestore. A exclusão no Google ficará pendente até você reconectar a conta.' : 'Item removido da agenda e do Firestore; também do Google Agenda, se estava sincronizado.')
    } catch (cause) { setError(cause.message || 'Não foi possível excluir o item.') }
  }

  async function enableNotifications() {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
    if (result === 'granted') setNotice('Notificações ativadas. Os lembretes aparecem enquanto o sistema estiver aberto neste navegador.')
  }

  return <div className="page-stack agenda-page">
    <section className="agenda-hero">
      <div><p className="eyebrow">ORGANIZAÇÃO DO DIA</p><h2>Agenda e tarefas</h2><p>Reuniões, lembretes e sua lista de prioridades em um só lugar.</p></div>
      <div className="agenda-hero-actions"><button className="button button-secondary" onClick={connectGoogle} disabled={busy || loading}>{loading ? 'Carregando agenda…' : busy ? 'Enviando itens…' : googleToken ? `✓ ${googleEmail || 'Google conectado'}` : '↗ Conectar Google Agenda'}</button><button className="button button-primary" onClick={() => { cancelEdit(); editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); titleInputRef.current?.focus({ preventScroll: true }) }}>＋ Novo item</button></div>
    </section>
    {(error || notice) && <div className={error ? 'alert alert-error agenda-message' : 'alert agenda-message'} role={error ? 'alert' : 'status'}>{error || notice}</div>}

    <section className="agenda-stats" aria-label="Resumo da agenda">
      {Object.entries(statusLabels).map(([status, label]) => <article key={status}><span>{label}</span><strong>{counts[status]}</strong><small>{counts[status] === 1 ? 'item' : 'itens'}</small></article>)}
    </section>

    <div className="agenda-columns">
      <section ref={editorRef} className="panel agenda-editor">
        <header className="agenda-section-heading"><div><p className="eyebrow">{editing ? 'ATUALIZAR' : 'PLANEJAMENTO'}</p><h3>{editing ? 'Editar item' : 'Adicionar à agenda'}</h3></div><span className="agenda-heading-icon">＋</span></header>
        <form className="agenda-form" onSubmit={saveItem}>
          <label className="agenda-full-field">Título<input ref={titleInputRef} id="agenda-title" required maxLength={120} placeholder="Ex.: Reunião com fornecedor" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} /></label>
          <label>Tipo<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}><option value="task">Tarefa</option><option value="meeting">Reunião</option><option value="reminder">Lembrete</option></select></label>
          <label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
          <label>Prioridade<select value={form.priority} onChange={(event) => setForm({ ...form, priority: event.target.value })}><option value="normal">Normal</option><option value="high">Alta</option><option value="low">Baixa</option></select></label>
          <label>Data<input type="date" required value={form.date} onChange={(event) => setForm({ ...form, date: event.target.value })} /></label>
          <label>Horário<input type="time" value={form.time} onChange={(event) => setForm({ ...form, time: event.target.value })} /></label>
          <label className="agenda-full-field">Detalhes<textarea rows="3" maxLength={1000} placeholder="Anotações, participantes ou próximos passos" value={form.details} onChange={(event) => setForm({ ...form, details: event.target.value })} /></label>
          <label className="agenda-reminder-toggle"><input type="checkbox" checked={form.reminder} onChange={(event) => setForm({ ...form, reminder: event.target.checked })} /><span><strong>Me lembrar neste navegador</strong><small>Ative as notificações para receber o aviso.</small></span></label>
          <div className="agenda-form-actions">{editing && <button type="button" className="button button-secondary" onClick={cancelEdit}>Cancelar edição</button>}<button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Salvando…' : editing ? 'Salvar alterações' : 'Adicionar item'}</button></div>
        </form>
      </section>

      <section className="panel agenda-list-panel">
        <header className="agenda-section-heading agenda-list-heading"><div><p className="eyebrow">SUA ROTINA</p><h3>Checklist e compromissos</h3></div><span className="agenda-live-sync">{googleToken ? '● Envio ao Google ativo' : '● Envio ao Google pausado'}</span></header>
        <nav className="agenda-filters" aria-label="Filtrar itens da agenda">{[['open', 'Em aberto'], ['in_progress', 'Em andamento'], ['completed', 'Finalizados'], ['cancelled', 'Cancelados'], ['all', 'Todos']].map(([value, label]) => <button key={value} className={filter === value ? 'agenda-filter-active' : ''} onClick={() => setFilter(value)}>{label}<span>{value === 'all' ? items.length : counts[value]}</span></button>)}</nav>
        {permission !== 'granted' && <div className="agenda-notification-hint"><span>◷</span><div><strong>Receba lembretes no navegador</strong><small>{permission === 'unsupported' ? 'Este navegador não oferece notificações.' : 'Ative as notificações para receber avisos com o sistema aberto.'}</small></div>{permission !== 'unsupported' && <button onClick={enableNotifications}>Ativar</button>}</div>}
        {!loading && visibleItems.length > 0 && <div className="agenda-selection-toolbar">
          {!selectionMode ? <button type="button" className="agenda-selection-open" onClick={() => setSelectionMode(true)}>Selecionar</button> : <>
            <label><input type="checkbox" checked={selectedVisibleCount === visibleItems.length} onChange={toggleVisibleSelection} /><span>{selectedVisibleCount === visibleItems.length ? 'Desmarcar visíveis' : 'Selecionar visíveis'}</span></label>
            {selectedItemIds.size > 0 && <><span className="agenda-selection-count">{selectedItemIds.size} selecionado(s)</span><button type="button" className="agenda-delete-action" disabled={deletingSelected} onClick={deleteSelectedItems}>{deletingSelected ? 'Excluindo…' : `Excluir selecionados (${selectedItemIds.size})`}</button></>}
            <button type="button" className="agenda-selection-close" disabled={deletingSelected} onClick={closeSelectionMode}>Concluir</button>
          </>}
        </div>}
        {loading ? <div className="agenda-empty">Carregando sua agenda…</div> : visibleItems.length === 0 ? <div className="agenda-empty"><span>✓</span><strong>{filter === 'all' ? 'Sua agenda está vazia' : `Nenhum item ${statusLabels[filter]?.toLowerCase() || ''}`}</strong><small>Adicione uma tarefa, reunião ou lembrete para começar.</small></div> : <div className="agenda-items">{visibleItems.map((item) => {
          const status = statusOf(item)
          return <article id={`agenda-item-${item.id}`} className={`agenda-item agenda-item-${status} ${alertItemId === item.id ? 'agenda-item-alert-target' : ''}`} key={item.id}>
            {selectionMode && <label className="agenda-item-select" aria-label={`Selecionar ${item.title}`}><input type="checkbox" checked={selectedItemIds.has(item.id)} onChange={() => toggleItemSelection(item.id)} /></label>}
            <div className="agenda-item-copy"><div className="agenda-item-title"><strong>{item.title}</strong>{item.priority === 'high' && !['completed', 'cancelled'].includes(status) && <span className="agenda-priority">Alta</span>}</div><div className="agenda-item-meta"><span className={`agenda-type agenda-type-${item.type}`}>{item.type === 'meeting' ? 'Reunião' : item.type === 'reminder' ? 'Lembrete' : 'Tarefa'}</span><span>{dateLabel(item.date)}{item.time ? ` · ${item.time}` : ''}</span><span className={`agenda-status-pill agenda-status-${status}`}>{statusLabels[status]}</span>{item.googleEventId ? <span className="agenda-synced" title="Este item foi enviado e está vinculado ao Google Agenda">✓ Conectado ao Google Agenda</span> : <span className="agenda-not-synced" title="Este item ainda não foi enviado ao Google Agenda">Ainda não enviado ao Google Agenda</span>}</div>{item.details && <p>{item.details}</p>}</div>
            <div className="agenda-item-actions"><button className="agenda-edit-action" aria-label={`Editar ${item.title}`} title="Editar item" onClick={() => startEdit(item)}>Editar</button>{status !== 'completed' && status !== 'cancelled' && <select aria-label={`Alterar status de ${item.title}`} value={status} onChange={(event) => changeStatus(item, event.target.value)}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>}<button className="agenda-delete-action" aria-label={`Excluir ${item.title} da agenda e do banco de dados`} title="Excluir da agenda e do banco de dados" onClick={() => deleteItem(item)}>Excluir</button></div>
          </article>
        })}</div>}
        <footer className="agenda-list-footer"><span>{visibleItems.length} {visibleItems.length === 1 ? 'item' : 'itens'}</span><span>{googleToken ? 'Envio para o Google ativo' : 'Salvo automaticamente'}</span></footer>
      </section>
    </div>

    <section className="agenda-integration-note"><span>ⓘ</span><p><strong>Envio para o Google Agenda</strong><br />Os itens criados ou alterados neste sistema são enviados ao Google quando a conta está conectada. Eventos criados ou alterados diretamente no Google não são importados para cá. Cancelar ou excluir um item neste sistema também remove o evento vinculado do Google.</p>{permission !== 'granted' && <button className="button button-secondary" onClick={enableNotifications} disabled={permission === 'unsupported'}>Ativar notificações</button>}</section>
  </div>
}
