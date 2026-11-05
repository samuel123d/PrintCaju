import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { createUserWithEmailAndPassword, sendEmailVerification, signInWithEmailAndPassword, updateProfile } from 'firebase/auth'
import Brand from '../components/Brand.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { auth } from '../services/firebase/config.js'
import { createCustomerOrderRequest, linkCustomerAccount, loadCustomerPortalData } from '../services/customerPortal.js'
import { loadShoppingCart, saveShoppingCart, watchPublicProducts } from '../services/site.js'

const statusLabels = { not_started: 'A iniciar', preparing: 'Em preparo', producing: 'Em produção', ready: 'Concluída' }
const formatMoney = (value) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0)

function errorText(error) {
  if (error.code === 'auth/email-already-in-use') return 'Este e-mail já tem uma conta. Entre com sua senha.'
  if (error.code === 'auth/invalid-credential') return 'E-mail ou senha incorretos.'
  if (error.code === 'auth/weak-password') return 'Escolha uma senha com pelo menos 8 caracteres.'
  if (error.code === 'auth/too-many-requests') return 'Muitas tentativas. Aguarde um pouco e tente novamente.'
  if (error.code === 'functions/failed-precondition' && error.message?.includes('Confirme')) return 'Confirme seu e-mail pelo link enviado para acessar seus pedidos.'
  if (error.code === 'functions/already-exists') return error.message
  if (error.code === 'functions/internal') return 'Não foi possível abrir sua conta agora. Atualize a página e tente novamente; se continuar, fale com a Print Caju pelo WhatsApp.'
  return error.message || 'Não foi possível concluir. Tente novamente.'
}

export default function CustomerPortalPage() {
  const { user, isAdmin, signOut, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [mode, setMode] = useState(searchParams.get('cadastro') === '1' ? 'register' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [data, setData] = useState(null)
  const [loadingData, setLoadingData] = useState(false)
  const [refreshingData, setRefreshingData] = useState(false)
  const [cart, setCart] = useState(loadShoppingCart)
  const [cartProducts, setCartProducts] = useState([])
  const [checkoutBusy, setCheckoutBusy] = useState(false)
  const [checkoutError, setCheckoutError] = useState('')
  const [checkoutResult, setCheckoutResult] = useState(null)
  const cartCount = Object.values(cart).reduce((total, quantity) => total + quantity, 0)
  const checkoutRows = useMemo(() => Object.entries(cart).map(([id, orderQuantity]) => {
    const product = cartProducts.find((item) => item.id === id)
    return product ? { ...product, orderQuantity } : null
  }).filter(Boolean), [cart, cartProducts])
  const checkoutTotal = checkoutRows.reduce((total, item) => total + Number(item.price || 0) * item.orderQuantity, 0)

  useEffect(() => {
    const stop = watchPublicProducts(setCartProducts, (cause) => {
      console.error('Não foi possível carregar produtos para a sacola.', cause)
      setCheckoutError('Não foi possível carregar os itens da sua sacola. Atualize a página e tente novamente.')
    })
    return stop
  }, [])

  useEffect(() => { saveShoppingCart(cart) }, [cart])

  useEffect(() => {
    if (authLoading || !user) return undefined
    if (isAdmin) { navigate('/admin', { replace: true }); return undefined }
    if (!user.emailVerified) { setLoadingData(false); return undefined }
    let active = true
    setLoadingData(true)
    linkCustomerAccount(user.uid, user.email).then(() => loadCustomerPortalData(user.uid, user.email)).then((result) => {
      if (!active) return
      setData(result)
    }).catch((cause) => {
      console.error('Não foi possível vincular ou carregar a conta do cliente.', { code: cause.code, message: cause.message })
      if (active) setError(errorText(cause))
    }).finally(() => { if (active) setLoadingData(false) })
    return () => { active = false }
  }, [user, isAdmin, authLoading, navigate])

  useEffect(() => {
    if (!user?.emailVerified) return undefined
    let active = true
    const refreshOnReturn = () => {
      if (document.visibilityState !== 'visible') return
      loadCustomerPortalData(user.uid, user.email).then((result) => {
        if (active) setData(result)
      }).catch((cause) => {
        console.error('Não foi possível atualizar os dados da conta do cliente.', { code: cause.code, message: cause.message })
      })
    }
    window.addEventListener('focus', refreshOnReturn)
    document.addEventListener('visibilitychange', refreshOnReturn)
    return () => {
      active = false
      window.removeEventListener('focus', refreshOnReturn)
      document.removeEventListener('visibilitychange', refreshOnReturn)
    }
  }, [user?.uid, user?.emailVerified])

  useEffect(() => {
    if (user?.emailVerified && searchParams.get('verificacao') === 'concluida') {
      setNotice('Seu e-mail foi confirmado. Agora você pode acompanhar seus pedidos e finalizar sua compra.')
    }
  }, [user?.emailVerified, searchParams])

  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setNotice('')
    try {
      if (mode === 'register') {
        if (name.trim().length < 2) throw new Error('Informe seu nome completo para criar a conta.')
        const credential = await createUserWithEmailAndPassword(auth, email.trim(), password)
        await updateProfile(credential.user, { displayName: name.trim() })
        const verificationUrl = new URL('/conta?verificacao=concluida', window.location.origin).toString()
        await sendEmailVerification(credential.user, { url: verificationUrl })
        setNotice('Conta criada. Abra o link de confirmação enviado ao seu e-mail. Depois, entre para consultar seus pedidos.')
      } else await signInWithEmailAndPassword(auth, email.trim(), password)
    } catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  async function resendVerification() {
    setBusy(true); setError(''); setNotice('')
    try {
      const verificationUrl = new URL('/conta?verificacao=concluida', window.location.origin).toString()
      await sendEmailVerification(user, { url: verificationUrl })
      setNotice('Enviamos um novo link de confirmação para seu e-mail.')
    }
    catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  async function refreshVerifiedAccount() {
    setBusy(true); setError('')
    try { await user.reload(); await user.getIdToken(true); window.location.reload() }
    catch (cause) { setError(errorText(cause)) }
    finally { setBusy(false) }
  }

  async function refreshCustomerData() {
    setRefreshingData(true)
    setError('')
    try {
      await linkCustomerAccount(user.uid, user.email)
      const result = await loadCustomerPortalData(user.uid, user.email)
      setData(result)
      setNotice(result?.linked ? 'Cadastro e pedidos atualizados.' : 'Ainda não encontramos seu cadastro. Confirme se o formulário foi sincronizado e tente novamente.')
    } catch (cause) {
      console.error('Não foi possível atualizar os dados da conta do cliente.', { code: cause.code, message: cause.message })
      setError(errorText(cause))
    } finally {
      setRefreshingData(false)
    }
  }

  async function submitCustomerOrder() {
    setCheckoutBusy(true)
    setCheckoutError('')
    setCheckoutResult(null)
    try {
      if (!user?.emailVerified) throw new Error('Confirme seu e-mail antes de enviar a solicitação.')
      if (!data?.linked) throw new Error('Conclua seu cadastro antes de enviar a solicitação.')
      if (!checkoutRows.length || checkoutRows.length !== Object.keys(cart).length) throw new Error('Um produto da sacola não está mais disponível. Atualize o catálogo.')
      const result = await createCustomerOrderRequest(
        user.uid,
        user.email,
        data.client.id,
        checkoutRows.map((item) => ({ productId: item.id, quantity: item.orderQuantity })),
        crypto.randomUUID(),
      )
      setCart({})
      setCheckoutResult(result)
      setNotice(`Solicitação #${result.orderCode} enviada. A Print Caju vai confirmar a disponibilidade; acompanhe o pedido nesta área.`)
      const refreshed = await loadCustomerPortalData(user.uid, user.email)
      setData(refreshed)
    } catch (cause) {
      console.error('Não foi possível enviar a solicitação de compra.', cause)
      setCheckoutError(cause.message || 'Não foi possível enviar a solicitação. Revise a sacola e tente novamente.')
    } finally {
      setCheckoutBusy(false)
    }
  }

  function whatsappOrderLink() {
    if (!data?.whatsapp) return '/#contato'
    const orderCode = checkoutResult?.orderCode
    const text = orderCode
      ? `Olá! Acabei de enviar a solicitação de compra #${orderCode} pelo site Print Caju.`
      : 'Olá! Gostaria de falar sobre um pedido da Print Caju.'
    return `https://wa.me/${data.whatsapp}?text=${encodeURIComponent(text)}`
  }

  if (user && (authLoading || isAdmin)) return <div className="portal-loading">Abrindo sua conta…</div>
  if (user) return (
    <main className="customer-portal">
      <header><Link to="/" className="portal-brand"><Brand /><span>Área do cliente</span></Link><div><span>{user.email}</span><button className="button button-secondary" onClick={signOut}>Sair</button></div></header>
      <section className="portal-content">
        <span className="institutional-kicker">SUA CONTA PRINT CAJU</span>
        <h1>Olá, {data?.client?.name?.split(' ')[0] || user.displayName || 'que bom ter você por aqui'}.</h1>
        <p>Acompanhe seus pedidos e as etapas de produção.</p>
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        {notice && <div className="alert alert-success" role="status">{notice}</div>}
        {!user.emailVerified
          ? <div className="portal-empty portal-verification-card"><Brand /><span className="portal-verification-icon">✉</span><h2>Confirme seu e-mail para continuar</h2><p>Enviamos uma mensagem para {user.email}. A confirmação protege seus dados e garante que apenas você veja seus pedidos. Depois de confirmar, volte aqui para continuar sua compra.</p><div className="portal-verification-actions"><button className="button button-secondary" disabled={busy} onClick={resendVerification}>{busy ? 'Enviando…' : 'Reenviar link'}</button><button className="button button-primary" disabled={busy} onClick={refreshVerifiedAccount}>Já confirmei meu e-mail</button></div></div>
          : loadingData
            ? <div className="portal-empty">Carregando seus pedidos…</div>
            : !data?.linked
              ? <div className="portal-empty"><span>✳</span><h2>Cadastro de cliente não localizado</h2><p>Preencha o formulário oficial da Print Caju no Google Forms. Use o mesmo e-mail da sua conta para vincular seu cadastro.</p><Link className="button button-primary" to="/cadastro-cliente">Abrir formulário de cadastro</Link><button type="button" className="button button-secondary" disabled={refreshingData} onClick={refreshCustomerData}>{refreshingData ? 'Verificando…' : 'Já enviei: verificar cadastro'}</button><p>Depois de enviar, aguarde a sincronização do formulário e verifique novamente.</p></div>
              : <>
                {data.client && <section className="portal-client-card" aria-label="Dados do seu cadastro">
                  <h2>Seus dados cadastrados</h2>
                  <button type="button" className="button button-secondary" disabled={refreshingData} onClick={refreshCustomerData}>{refreshingData ? 'Atualizando…' : 'Atualizar cadastro e pedidos'}</button>
                  <dl>
                    <div><dt>Nome</dt><dd>{data.client.name || '—'}</dd></div>
                    <div><dt>E-mail</dt><dd>{data.client.email || '—'}</dd></div>
                    <div><dt>Telefone</dt><dd>{data.client.phone || '—'}</dd></div>
                    <div><dt>CPF/CNPJ</dt><dd>{data.client.taxId || '—'}</dd></div>
                    <div className="portal-client-address"><dt>Endereço</dt><dd>{[data.client.address, data.client.city, data.client.state, data.client.postalCode].filter(Boolean).join(' · ') || '—'}</dd></div>
                  </dl>
                </section>}
                {cartCount > 0 && <section className="portal-checkout-card" aria-label="Finalizar sacola">
                  <span className="institutional-kicker">SUA SACOLA</span>
                  <h2>Revise sua solicitação</h2>
                  <p>A compra será confirmada pela Print Caju antes da cobrança. Nenhum pagamento será feito agora.</p>
                  {checkoutError && <div className="alert alert-error" role="alert">{checkoutError}</div>}
                  {!cartProducts.length ? <p>Carregando produtos…</p> : <ul>{checkoutRows.map((item) => {
                    const scheduledQuantity = item.hasInventory ? Math.max(0, item.orderQuantity - Number(item.quantity || 0)) : 0
                    return <li key={item.id}><span>{item.name} × {item.orderQuantity}{item.hasInventory && <small>Estoque atual: {item.quantity}</small>}{scheduledQuantity > 0 && <small className="portal-item-unavailable">Compra agendada: {scheduledQuantity} unidade(s) aguardando reposição. A Print Caju confirmará a previsão.</small>}</span><strong>{formatMoney(Number(item.price) * item.orderQuantity)}</strong>{scheduledQuantity > 0 && <button type="button" className="button button-secondary" onClick={() => setCart((current) => { const next = { ...current }; delete next[item.id]; return next })}>Remover</button>}</li>
                  })}</ul>}
                  <div className="portal-order-total"><span>Total da solicitação</span><strong>{formatMoney(checkoutTotal)}</strong></div>
                  <button className="button button-primary button-full" disabled={checkoutBusy || !checkoutRows.length || checkoutRows.length !== Object.keys(cart).length} onClick={submitCustomerOrder}>{checkoutBusy ? 'Enviando solicitação…' : checkoutRows.some((item) => item.hasInventory && item.orderQuantity > Number(item.quantity)) ? 'Enviar solicitação de compra agendada' : 'Enviar solicitação de compra'}</button>
                </section>}
                {checkoutResult && <div className="portal-checkout-success" role="status"><Brand /><strong>Solicitação enviada com sucesso</strong><span>Nº {checkoutResult.orderCode} · {formatMoney(checkoutResult.total)}</span><p>A confirmação por e-mail será enviada quando as notificações da loja estiverem ativadas. Você já pode acompanhar o pedido abaixo.</p><a className="button button-secondary" href={whatsappOrderLink()} target="_blank" rel="noreferrer">Falar pelo WhatsApp ↗</a></div>}
                {data.orders.length
                  ? <div className="portal-order-list">{data.orders.map((order) => <article key={order.id}>
                    <header><div><small>PEDIDO #{order.id.slice(0, 7).toUpperCase()}</small><strong>{order.soldAt ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(`${order.soldAt}T12:00:00`)) : 'Data não informada'}</strong></div><span className={`status-pill ${order.status === 'cancelled' ? 'payment-pending' : order.orderApprovalStatus === 'pending' ? 'payment-pending' : order.productionStatus === 'ready' ? 'payment-paid' : 'payment-partial'}`}>{order.status === 'cancelled' ? 'Cancelado' : order.orderApprovalStatus === 'pending' ? order.items.some((item) => item.scheduledPurchase) ? 'Agendamento pendente' : 'Aguardando confirmação' : statusLabels[order.productionStatus] || 'Em andamento'}</span></header>
                    <ul>{order.items.map((item, index) => <li key={index}><span>{item.description}{item.scheduledPurchase && order.orderApprovalStatus === 'pending' && <small className="portal-item-unavailable">Compra agendada: {item.scheduledQuantity} unidade(s) aguardando reposição. A Print Caju confirmará a previsão.</small>}</span><strong>× {item.quantity}</strong></li>)}</ul>
                    <div className="portal-order-total"><span>Total do pedido</span><strong>{formatMoney(order.total)}</strong></div>
                    <div className="portal-order-total"><span>Valor recebido</span><strong>{formatMoney(order.receivedAmount)}</strong></div>
                    {order.outstandingAmount > 0 && <div className="portal-order-total"><span>Saldo em aberto</span><strong>{formatMoney(order.outstandingAmount)}</strong></div>}
                    {order.dueDate && <small>Previsão: {new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium' }).format(new Date(`${order.dueDate}T12:00:00`))}</small>}
                  </article>)}</div>
                  : <div className="portal-empty"><span>✳</span><h2>Seus pedidos aparecerão aqui</h2><p>Quando a Print Caju registrar uma encomenda usando este e-mail, ela será exibida nesta área.</p></div>}
              </>}
      </section>
      <footer className="portal-footer">
        <div className="portal-footer-brand">
          <img src="/printcaju-logo.png" alt="Print Caju" onError={(event) => {
            event.currentTarget.onerror = null
            event.currentTarget.src = '/printcaju-mark.png'
          }} />
          <span>Print Caju</span>
        </div>
        <p>Seus dados são consultados de forma privada.</p>
        <small>Feito com cuidado, do nosso ateliê para você.</small>
      </footer>
    </main>
  )

  return   <main className="customer-auth"><div className="customer-auth-art"><Brand /><span className="institutional-kicker">PEÇAS ÚNICAS, FEITAS PARA VOCÊ</span><h1>Suas ideias<br />em boas mãos.</h1><p>Entre para acompanhar seus pedidos e ficar por dentro da produção.</p><img src="/printcaju-mark.png" alt="" /></div><section className="customer-auth-panel"><Link className="customer-back" to="/">← Voltar ao site</Link><span className="institutional-kicker">ÁREA DO CLIENTE</span><h2>{mode === 'register' ? 'Crie sua conta' : 'Boas-vindas de volta'}</h2><p>{mode === 'register' ? 'Cadastre-se para acompanhar seus pedidos da Print Caju.' : 'Entre para acompanhar seus pedidos.'}</p>{cartCount > 0 && <div className="portal-cart-reminder"><strong>Sua sacola tem {cartCount} {cartCount === 1 ? 'item' : 'itens'}.</strong><span>Entre ou crie sua conta para enviar a solicitação com segurança.</span></div>}{notice && <div className="alert alert-success" role="status">{notice}</div>}{error && <div className="alert alert-error" role="alert">{error}</div>}<form onSubmit={submit}>{mode === 'register' && <><label>Nome completo<input required autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></label><label>Telefone / WhatsApp (opcional)<input type="tel" autoComplete="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} /></label></>}<label>E-mail<input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label><label>Senha<input required type="password" minLength={8} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} /></label><button className="button button-primary button-full" disabled={busy}>{busy ? 'Aguarde…' : mode === 'register' ? 'Criar conta' : 'Entrar'}</button></form><p className="customer-mode-switch">{mode === 'register' ? 'Já tem uma conta?' : 'Ainda não tem uma conta?'} <button onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); setNotice('') }}>{mode === 'register' ? 'Entrar' : 'Cadastre-se'}</button></p><small>O cadastro da conta não concede acesso ao painel administrativo.</small></section></main>
}
