import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import Brand from '../components/Brand.jsx'
import { loadPublicOrderForm, submitPublicOrderForm, submitWebsiteCustomerRegistration } from '../services/sales/externalSales.js'

const empty = { name: '', phone: '', email: '', taxId: '', address: '', city: '', state: '', postalCode: '' }

export default function PublicCustomerFormPage() {
  const { token } = useParams()
  const [searchParams] = useSearchParams()
  const [form, setForm] = useState(null)
  const [profile, setProfile] = useState(empty)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [done, setDone] = useState(false)
  useEffect(() => {
    if (!token) {
      setForm({ kind: 'registration' })
      setProfile({ ...empty, name: searchParams.get('name') || '', email: searchParams.get('email') || '' })
      return
    }
    loadPublicOrderForm(token).then(setForm).catch((cause) => setError(cause.message || 'Este link não está disponível.'))
  }, [token, searchParams])
  async function submit(event) {
    event.preventDefault(); setError(''); setSaving(true)
    try {
      if (token) await submitPublicOrderForm(token, profile)
      else await submitWebsiteCustomerRegistration(profile)
      setDone(true)
    } catch (cause) { setError(cause.message || 'Não foi possível enviar seus dados.') } finally { setSaving(false) }
  }
  return <main className="auth-screen"><section className="auth-card public-form-card"><Brand /><h1>{form?.kind === 'registration' ? 'Cadastro de cliente' : 'Dados do cliente'}</h1>
    {error && <div className="alert alert-error" role="alert">{error}</div>}
    {done || form?.submitted ? <><p>Obrigado! {form?.kind === 'registration' ? 'Seu cadastro foi realizado. Agora você pode criar sua conta ou entrar com este mesmo e-mail para acompanhar seus pedidos.' : 'Seus dados foram registrados no pedido.'}</p>{form?.kind === 'registration' && <Link className="button button-primary button-full" to="/conta?cadastro=1">Criar conta / entrar</Link>}</> : form ? <>
      <p>{form.kind === 'registration' ? 'Preencha este formulário para cadastrar seus dados de cliente no sistema da Print Caju.' : `Pedido #${form.orderCode}${form.itemNames?.length ? ` · ${form.itemNames.join(', ')}` : ''}. Preencha seus dados para completar o cadastro.`}</p>
      <form className="sale-form public-customer-form" onSubmit={submit}>
        <label>Nome completo *<input required maxLength="120" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label>
        <label>Telefone / WhatsApp<input type="tel" maxLength="20" value={profile.phone} onChange={(e) => setProfile({ ...profile, phone: e.target.value })} /></label>
        <label>E-mail{!token && ' *'}<input required={!token} type="email" maxLength="160" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} /></label>
        <label>CPF/CNPJ<input maxLength="18" value={profile.taxId} onChange={(e) => setProfile({ ...profile, taxId: e.target.value })} /></label>
        <label>Endereço<input maxLength="180" value={profile.address} onChange={(e) => setProfile({ ...profile, address: e.target.value })} /></label>
        <label>Cidade<input maxLength="80" value={profile.city} onChange={(e) => setProfile({ ...profile, city: e.target.value })} /></label>
        <label>Estado<input maxLength="2" value={profile.state} onChange={(e) => setProfile({ ...profile, state: e.target.value })} /></label>
        <label>CEP<input maxLength="10" value={profile.postalCode} onChange={(e) => setProfile({ ...profile, postalCode: e.target.value })} /></label>
        <button className="button button-primary button-full" disabled={saving}>{saving ? 'Enviando…' : 'Enviar dados'}</button>
      </form>
    </> : !error && <p>Carregando formulário…</p>}
  </section></main>
}
