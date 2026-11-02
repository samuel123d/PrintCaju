import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../contexts/AuthContext.jsx'
import useBusinessDetails from '../hooks/useBusinessDetails.js'
import usePreferences, { applyBrandPreferences } from '../hooks/usePreferences.js'
import { changeAccountEmail, clearProfilePhoto, requestPasswordReset, saveBusinessDetails, savePreferences, saveProfile, saveProfilePhoto } from '../services/settings/settings.js'
import { formatBrazilianPhone, formatBrazilianTaxId } from '../utils/inputMasks.js'

const palette = [
  { name: 'Laranja Print Caju', value: '#FF8A00' },
  { name: 'Amarelo', value: '#FFD54F' },
  { name: 'Azul escuro', value: '#1E293B' },
  { name: 'Cinza', value: '#687280' },
  { name: 'Terracota', value: '#E76F51' },
  { name: 'Verde', value: '#43864E' },
]
const fontSizes = [
  { value: 'small', label: 'Pequena', preview: 'Aa', size: 'Mais compacta' },
  { value: 'normal', label: 'Padrão', preview: 'Aa', size: 'Recomendada' },
  { value: 'large', label: 'Grande', preview: 'Aa', size: 'Mais legível' },
  { value: 'largest', label: 'Bem grande', preview: 'Aa', size: 'Acessibilidade' },
]

async function compressPhoto(file) {
  const bitmap = await createImageBitmap(file)
  try {
    for (const edge of [640, 512, 448, 384, 320, 256, 192]) {
      const scale = Math.min(1, edge / Math.max(bitmap.width, bitmap.height))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)

      for (const quality of [0.78, 0.64, 0.5, 0.38]) {
        const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality))
        if (!blob) throw new Error('Não foi possível preparar a imagem.')
        if (blob.size <= 400 * 1024) return new File([blob], 'avatar.webp', { type: 'image/webp' })
      }
    }
  } finally {
    bitmap.close()
  }
  throw new Error('Não foi possível reduzir a foto para menos de 400 KB. Escolha outra imagem.')
}

function profilePhotoError(cause) {
  if (cause?.code === 'permission-denied' || cause?.code === 'firestore/permission-denied') return 'O Firestore recusou salvar o perfil. Confira se as regras publicadas permitem acesso ao documento do administrador.'
  if (cause?.code === 'resource-exhausted' || cause?.code === 'firestore/resource-exhausted') return 'A foto ficou grande para o limite do Firestore. Escolha outra imagem e tente novamente.'
  return cause?.message || 'Não foi possível salvar a foto no Firestore. Confira sua conexão e tente novamente.'
}

export default function SettingsPage() {
  const { user, workspaceUid } = useAuth()
  const { preferences: savedPreferences, profile, loading, error: loadError, setProfile } = usePreferences()
  const { business, loading: businessLoading, error: businessError } = useBusinessDetails()
  const photoInput = useRef(null)
  const [profileForm, setProfileForm] = useState({ displayName: '', email: '', photoURL: '' })
  const [businessForm, setBusinessForm] = useState(business)
  const [preferences, setPreferences] = useState(savedPreferences)
  const [profileBusy, setProfileBusy] = useState(false)
  const [preferencesBusy, setPreferencesBusy] = useState(false)
  const [emailBusy, setEmailBusy] = useState(false)
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [installPrompt, setInstallPrompt] = useState(null)
  const [appInstalled, setAppInstalled] = useState(false)
  const [installHelp, setInstallHelp] = useState(false)

  useEffect(() => { setPreferences(savedPreferences); applyBrandPreferences(savedPreferences) }, [savedPreferences])
  useEffect(() => setProfileForm({ displayName: profile.displayName ?? user?.displayName ?? '', email: user?.email ?? '', photoURL: profile.photoURL ?? user?.photoURL ?? '' }), [profile, user])
  useEffect(() => setBusinessForm(business), [business])
  useEffect(() => {
    setAppInstalled(window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true)
    const handleInstallPrompt = (event) => { event.preventDefault(); setInstallPrompt(event) }
    const handleInstalled = () => { setAppInstalled(true); setInstallPrompt(null) }
    window.addEventListener('beforeinstallprompt', handleInstallPrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleInstallPrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [])

  function changePreference(key, value) {
    const next = { ...preferences, [key]: value }
    setPreferences(next)
    if (key === 'accentColor' || key === 'fontScale') applyBrandPreferences(next)
  }
  async function installApp() {
    setInstallHelp(true)
    if (!installPrompt) return
    try {
      await installPrompt.prompt()
      const choice = await installPrompt.userChoice
      if (choice?.outcome === 'accepted') { setAppInstalled(true); setInstallHelp(false) }
      else setInstallHelp(true)
    } catch {
      setInstallHelp(true)
    } finally {
      setInstallPrompt(null)
    }
  }
  function clearMessages() { setMessage(''); setSaveError('') }

  async function saveVisualSettings(event) {
    event.preventDefault(); clearMessages(); setPreferencesBusy(true)
    try { await savePreferences(user.uid, preferences); setMessage('Aparência e alertas salvos na sua conta.') }
    catch { setSaveError('Não foi possível salvar suas configurações. Confira sua conexão.') }
    finally { setPreferencesBusy(false) }
  }

  async function saveCompanySettings(event) {
    event.preventDefault(); clearMessages()
    if (!businessForm.name.trim()) return setSaveError('Informe o nome ou razão social que aparecerá nos documentos.')
    setPreferencesBusy(true)
    try {
      await saveBusinessDetails(workspaceUid, Object.fromEntries(Object.entries(businessForm).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value])))
      setMessage('Dados da empresa salvos para os orçamentos e comprovantes.')
    } catch {
      setSaveError('Não foi possível salvar os dados da empresa. Confira se as regras do Firestore foram publicadas.')
    } finally { setPreferencesBusy(false) }
  }

  async function saveProfileSettings(event) {
    event.preventDefault(); clearMessages()
    if (!profileForm.displayName.trim()) return setSaveError('Informe como seu nome deve aparecer no sistema.')
    setProfileBusy(true)
    try {
      const data = { displayName: profileForm.displayName.trim() }
      await saveProfile(user.uid, data)
      setProfile(data)
      setMessage('Seu perfil foi atualizado no Firestore.')
    } catch (cause) {
      setSaveError(cause.code === 'auth/requires-recent-login' ? 'Por segurança, saia e entre novamente antes de atualizar o perfil.' : 'Não foi possível atualizar o perfil.')
    } finally { setProfileBusy(false) }
  }

  async function uploadPhoto(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    clearMessages()
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return setSaveError('Escolha uma imagem JPG, PNG ou WebP.')
    if (file.size > 8 * 1024 * 1024) return setSaveError('A imagem original deve ter até 8 MB.')
    setProfileBusy(true)
    try {
      const photo = await compressPhoto(file)
      await saveProfilePhoto(user.uid, photo)
      setMessage('Foto de perfil salva no Firestore.')
    } catch (cause) {
      setSaveError(profilePhotoError(cause))
    } finally { setProfileBusy(false) }
  }

  async function removePhoto() {
    clearMessages(); setProfileBusy(true)
    try {
      await clearProfilePhoto(user.uid)
      setMessage('Foto removida do Firestore.')
    } catch (cause) { setSaveError(profilePhotoError(cause)) }
    finally { setProfileBusy(false) }
  }

  async function changeEmail(event) {
    event.preventDefault(); clearMessages()
    if (!profileForm.email.trim() || profileForm.email.trim() === user.email) return setSaveError('Informe um e-mail diferente do atual.')
    setEmailBusy(true)
    try { await changeAccountEmail(profileForm.email.trim()); setMessage(`Enviamos um link de confirmação para ${profileForm.email.trim()}. O e-mail muda depois da confirmação.`) }
    catch (cause) { setSaveError(cause.code === 'auth/requires-recent-login' ? 'Por segurança, saia e entre novamente antes de alterar o e-mail.' : cause.code === 'auth/invalid-email' ? 'Digite um endereço de e-mail válido.' : cause.code === 'auth/email-already-in-use' ? 'Este e-mail já está vinculado a outra conta.' : 'Não foi possível iniciar a alteração de e-mail.') }
    finally { setEmailBusy(false) }
  }

  async function resetPassword() {
    clearMessages(); setPasswordBusy(true)
    try { await requestPasswordReset(user.email); setMessage(`Enviamos as instruções para redefinir a senha para ${user.email}.`) }
    catch { setSaveError('Não foi possível enviar o e-mail para redefinir a senha.') }
    finally { setPasswordBusy(false) }
  }

  async function enableBrowserNotifications() {
    clearMessages()
    if (!('Notification' in window)) return setSaveError('Este navegador não oferece notificações. Os avisos continuarão aparecendo dentro do sistema.')
    try {
      const permission = await Notification.requestPermission()
      const next = { ...preferences, desktopNotificationsEnabled: permission === 'granted' }
      setPreferences(next)
      await savePreferences(user.uid, next)
      setMessage(permission === 'granted' ? 'Notificações do navegador ativadas e salvas.' : 'Permissão não concedida. Os alertas continuam dentro do sistema.')
    } catch { setSaveError('Não foi possível ativar as notificações do navegador.') }
  }

  const initials = (profileForm.displayName || user?.email || 'P').trim().charAt(0).toUpperCase()
  const selectedAccentColor = /^#[0-9a-f]{6}$/i.test(preferences.accentColor || '') ? preferences.accentColor : '#FF8A00'
  const selectedPaletteColor = palette.find((color) => color.value.toLowerCase() === selectedAccentColor.toLowerCase())
  const selectedColorName = selectedPaletteColor?.name || 'Personalizada'
  return <div className="page-stack settings-page">
    <div className="page-intro"><div><p className="eyebrow">SISTEMA</p><h2>Configurações</h2><p>Personalize o Print Caju, seu perfil e os alertas importantes da operação.</p></div></div>
    {loadError && <div className="sales-error" role="alert">{loadError}</div>}
    {businessError && <div className="sales-error" role="alert">{businessError}</div>}
    {(message || saveError) && <div className={`alert ${saveError ? 'alert-error' : 'alert-success'}`} role={saveError ? 'alert' : 'status'}>{saveError || message}</div>}
    <section className="panel settings-section"><header className="settings-section-heading"><span className="settings-section-icon">01</span><div><h3>Perfil e acesso</h3><p>Atualize como seu perfil aparece e proteja o acesso à conta.</p></div></header>
      {loading ? <div className="sales-loading">Carregando perfil…</div> : <div className="settings-profile-layout"><div className="profile-photo-area"><div className="profile-photo">{profileForm.photoURL ? <img src={profileForm.photoURL} alt="Foto do perfil" /> : <span>{initials}</span>}</div><div className="profile-photo-actions"><button type="button" className="button button-secondary" disabled={profileBusy} onClick={() => photoInput.current?.click()}>{profileBusy ? 'Salvando…' : 'Trocar foto'}</button>{profileForm.photoURL && <button type="button" className="button button-quiet" disabled={profileBusy} onClick={removePhoto}>Remover</button>}</div><input ref={photoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={uploadPhoto} /><small>JPG, PNG ou WebP. A imagem é comprimida e armazenada no Firestore (até 400 KB).</small></div>
        <div className="settings-profile-fields"><form className="settings-form-grid" onSubmit={saveProfileSettings}><label>Nome no sistema<input maxLength={80} value={profileForm.displayName} onChange={(event) => setProfileForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="Seu nome" /></label><button className="button button-primary" disabled={profileBusy}>{profileBusy ? 'Salvando…' : 'Salvar perfil'}</button></form>
          <form className="settings-form-grid settings-email-form" onSubmit={changeEmail}><label>E-mail da conta<input type="email" autoComplete="email" value={profileForm.email} onChange={(event) => setProfileForm((current) => ({ ...current, email: event.target.value }))} /></label><button className="button button-secondary" disabled={emailBusy}>{emailBusy ? 'Enviando…' : 'Alterar e confirmar e-mail'}</button></form>
          <div className="settings-password-row"><div><strong>Senha</strong><small>Enviaremos um link seguro para redefinir sua senha.</small></div><button type="button" className="button button-secondary" onClick={resetPassword} disabled={passwordBusy}>{passwordBusy ? 'Enviando…' : 'Redefinir senha'}</button></div>
        </div></div>}
    </section>

    <section className="panel settings-section"><header className="settings-section-heading"><span className="settings-section-icon">02</span><div><h3>Aparência do sistema</h3><p>Escolha uma cor de destaque e o tamanho confortável para leitura.</p></div></header>
      <form onSubmit={saveVisualSettings} className="settings-options-form"><div className="settings-option-block"><div className="settings-option-title"><strong>Cor de destaque</strong><span>Pré-visualize em botões, seleções e elementos ativos.</span></div><div className="settings-color-picker-area"><div className="settings-color-row">{palette.map((color) => <button key={color.value} type="button" className={`settings-color-swatch ${selectedAccentColor.toLowerCase() === color.value.toLowerCase() ? 'selected' : ''}`} style={{ '--swatch': color.value }} aria-label={`Usar tema ${color.name}`} aria-pressed={selectedAccentColor.toLowerCase() === color.value.toLowerCase()} title={color.name} onClick={() => changePreference('accentColor', color.value)} />)}<label className={`custom-color-field ${selectedPaletteColor ? '' : 'custom-color-selected'}`}>Personalizada<input type="color" value={selectedAccentColor} onChange={(event) => changePreference('accentColor', event.target.value)} aria-label="Escolher cor personalizada" /></label></div><div className="settings-active-theme"><span className="settings-active-theme-swatch" style={{ backgroundColor: selectedAccentColor }} /><span>Tema selecionado: <strong>{selectedColorName}</strong></span><code>{selectedAccentColor.toUpperCase()}</code></div></div></div>
        <div className="settings-option-block"><div className="settings-option-title"><strong>Tamanho da interface</strong><span>Afeta textos e dimensões gerais das telas.</span></div><div className="font-size-options">{fontSizes.map((size) => <button key={size.value} type="button" className={`font-size-choice ${preferences.fontScale === size.value ? 'selected' : ''}`} onClick={() => changePreference('fontScale', size.value)}><b className={`font-preview font-${size.value}`}>{size.preview}</b><span>{size.label}</span><small>{size.size}</small></button>)}</div></div>
        <div className="settings-option-block"><div className="settings-option-title"><strong>Nome do espaço</strong><span>Usado na barra superior do sistema.</span></div><input className="settings-text-input" maxLength={50} value={preferences.businessName} onChange={(event) => changePreference('businessName', event.target.value)} /></div>
        <button className="button button-primary" disabled={preferencesBusy}>{preferencesBusy ? 'Salvando…' : 'Salvar aparência e alertas'}</button>
      </form>
    </section>

    <section className="panel settings-section"><header className="settings-section-heading"><span className="settings-section-icon">03</span><div><h3>Alertas da operação</h3><p>Escolha quais avisos aparecem no painel e quando recebê-los.</p></div></header>
      <form onSubmit={saveVisualSettings} className="settings-alert-options"><label className="settings-toggle-row"><span><strong>Alertas de prazo de pedidos</strong><small>Avisa sobre o prazo de entrega antes do vencimento e destaca entregas atrasadas.</small></span><input type="checkbox" checked={preferences.dailyDueAlertsEnabled} onChange={(event) => changePreference('dailyDueAlertsEnabled', event.target.checked)} /></label>
        <label className="settings-alert-days"><span>Alertar pedidos com prazo em até</span><select value={preferences.dueAlertDays} onChange={(event) => changePreference('dueAlertDays', Number(event.target.value))}><option value="1">1 dia</option><option value="3">3 dias</option><option value="5">5 dias</option><option value="7">7 dias</option><option value="14">14 dias</option></select></label>
        <label className="settings-toggle-row"><span><strong>Alertas de estoque baixo</strong><small>Avisa quando um produto atinge ou fica abaixo do mínimo.</small></span><input type="checkbox" checked={preferences.lowStockAlertsEnabled} onChange={(event) => changePreference('lowStockAlertsEnabled', event.target.checked)} /></label>
        <div className="settings-notification-row"><div><strong>Notificações do navegador</strong><small>Receba um resumo diário quando o sistema estiver aberto.</small></div><button type="button" className="button button-secondary" onClick={enableBrowserNotifications}>{preferences.desktopNotificationsEnabled ? 'Permissão ativada' : 'Ativar notificações'}</button></div>
        <button className="button button-primary" disabled={preferencesBusy}>{preferencesBusy ? 'Salvando…' : 'Salvar preferências de alertas'}</button>
      </form>
    </section>
    <section className="panel settings-section app-install-section"><header className="settings-section-heading"><span className="settings-section-icon">04</span><div><h3>Aplicativo para celular</h3><p>Instale o Print Caju pelo site na tela inicial para abrir em uma janela própria, como um aplicativo.</p></div></header>
      <div className="app-install-content"><div className="app-install-icon"><img src="/icons/icon-192.png" alt="" /></div><div className="app-install-copy"><strong>{appInstalled ? 'Print Caju instalado neste dispositivo' : 'Acesse suas vendas e sua produção pelo celular'}</strong><small>O app usa sua conta habitual e os dados sincronizados do sistema. Para instalar, use um navegador compatível e mantenha a conexão com a internet.</small>{installHelp && !appInstalled && <small className="app-install-help">{/iphone|ipad|ipod/i.test(navigator.userAgent) ? 'No Safari, toque em Compartilhar e escolha “Adicionar à Tela de Início”.' : 'No Android, use o Chrome ou Edge e escolha “Instalar aplicativo” ou “Adicionar à tela inicial” no menu do navegador.'}</small>}</div><button type="button" className="button button-primary" onClick={installApp} disabled={appInstalled}>{appInstalled ? 'Instalado' : installPrompt ? 'Instalar aplicativo' : 'Ver como instalar'}</button></div>
      <p className="app-install-note">No Android compatível, o botão abre a confirmação nativa de instalação do navegador. Se ela não estiver disponível, use Chrome ou Edge e escolha “Instalar aplicativo” no menu. No iPhone, use Safari e “Adicionar à Tela de Início”.</p>
    </section>
    <section className="panel settings-section"><header className="settings-section-heading"><span className="settings-section-icon">05</span><div><h3>Dados da empresa</h3><p>Essas informações aparecem nos orçamentos e comprovantes comerciais. CPF/CNPJ é opcional.</p></div></header>
      {businessLoading ? <div className="sales-loading">Carregando dados da empresa…</div> : <form className="settings-company-form" onSubmit={saveCompanySettings}>
        <label>Nome ou razão social<input required maxLength={120} value={businessForm.name} onChange={(event) => setBusinessForm((current) => ({ ...current, name: event.target.value }))} /></label>
        <label>CPF/CNPJ <span className="optional-label">opcional</span><input inputMode="numeric" maxLength={18} value={formatBrazilianTaxId(businessForm.taxId)} onChange={(event) => setBusinessForm((current) => ({ ...current, taxId: formatBrazilianTaxId(event.target.value) }))} placeholder="000.000.000-00 ou 00.000.000/0000-00" /></label>
        <label>Telefone<input type="tel" inputMode="tel" maxLength={16} value={formatBrazilianPhone(businessForm.phone)} onChange={(event) => setBusinessForm((current) => ({ ...current, phone: formatBrazilianPhone(event.target.value) }))} placeholder="(00) 00000-0000" /></label>
        <label>E-mail<input type="email" maxLength={160} value={businessForm.email} onChange={(event) => setBusinessForm((current) => ({ ...current, email: event.target.value }))} /></label>
        <label className="settings-company-span-two">Endereço<input maxLength={180} value={businessForm.address} onChange={(event) => setBusinessForm((current) => ({ ...current, address: event.target.value }))} /></label>
        <label>Cidade<input maxLength={80} value={businessForm.city} onChange={(event) => setBusinessForm((current) => ({ ...current, city: event.target.value }))} /></label>
        <label>Estado<input maxLength={2} value={businessForm.state} onChange={(event) => setBusinessForm((current) => ({ ...current, state: event.target.value }))} placeholder="UF" /></label>
        <label>CEP<input maxLength={10} value={businessForm.postalCode} onChange={(event) => setBusinessForm((current) => ({ ...current, postalCode: event.target.value }))} /></label>
        <div className="document-settings-heading settings-company-span-two"><h4>Personalizar orçamento e comprovante</h4><p>Defina os títulos, textos e seções que aparecem ao imprimir ou salvar em PDF.</p></div>
        <label>Título do orçamento<input maxLength={60} value={businessForm.quoteTitle} onChange={(event) => setBusinessForm((current) => ({ ...current, quoteTitle: event.target.value }))} /></label>
        <label>Título do comprovante<input maxLength={60} value={businessForm.receiptTitle} onChange={(event) => setBusinessForm((current) => ({ ...current, receiptTitle: event.target.value }))} /></label>
        <label className="settings-company-span-two">Texto de apresentação do orçamento<textarea rows="3" maxLength={500} value={businessForm.quoteIntro} onChange={(event) => setBusinessForm((current) => ({ ...current, quoteIntro: event.target.value }))} placeholder="Ex.: Obrigado por solicitar um orçamento. Confira abaixo os produtos e condições." /></label>
        <label className="settings-company-span-two">Rodapé do orçamento<textarea rows="3" maxLength={500} value={businessForm.quoteFooter} onChange={(event) => setBusinessForm((current) => ({ ...current, quoteFooter: event.target.value }))} placeholder="Prazo, condições ou informações que deseja incluir no final do orçamento." /></label>
        <label className="settings-company-span-two">Rodapé do comprovante de venda<textarea rows="3" maxLength={500} value={businessForm.receiptFooter} onChange={(event) => setBusinessForm((current) => ({ ...current, receiptFooter: event.target.value }))} placeholder="Agradecimento, política de troca ou informações adicionais." /></label>
        <div className="document-settings-options settings-company-span-two">
          <label className="document-setting-toggle"><input type="checkbox" checked={businessForm.showCompanyDetails !== false} onChange={(event) => setBusinessForm((current) => ({ ...current, showCompanyDetails: event.target.checked }))} /><span>Exibir CPF/CNPJ e contatos da empresa</span></label>
          <label className="document-setting-toggle"><input type="checkbox" checked={businessForm.showCustomerTaxId !== false} onChange={(event) => setBusinessForm((current) => ({ ...current, showCustomerTaxId: event.target.checked }))} /><span>Exibir CPF/CNPJ do cliente</span></label>
          <label className="document-setting-toggle"><input type="checkbox" checked={businessForm.showCustomerContact !== false} onChange={(event) => setBusinessForm((current) => ({ ...current, showCustomerContact: event.target.checked }))} /><span>Exibir telefone e e-mail do cliente</span></label>
          <label className="document-setting-toggle"><input type="checkbox" checked={businessForm.showSalesChannel !== false} onChange={(event) => setBusinessForm((current) => ({ ...current, showSalesChannel: event.target.checked }))} /><span>Exibir canal da venda</span></label>
          <label className="document-setting-toggle"><input type="checkbox" checked={businessForm.showPaymentDetails !== false} onChange={(event) => setBusinessForm((current) => ({ ...current, showPaymentDetails: event.target.checked }))} /><span>Exibir forma e status do pagamento</span></label>
          <label className="document-setting-toggle"><input type="checkbox" checked={businessForm.showDeliveryDetails !== false} onChange={(event) => setBusinessForm((current) => ({ ...current, showDeliveryDetails: event.target.checked }))} /><span>Exibir entrega e prazo</span></label>
          <label className="document-setting-toggle"><input type="checkbox" checked={businessForm.showDocumentSignatures !== false} onChange={(event) => setBusinessForm((current) => ({ ...current, showDocumentSignatures: event.target.checked }))} /><span>Incluir campos para assinaturas</span></label>
        </div>
        <div className="settings-company-actions"><button className="button button-primary" disabled={preferencesBusy}>{preferencesBusy ? 'Salvando…' : 'Salvar dados da empresa'}</button></div>
      </form>}
    </section>
    <div className="settings-security-note"><img src="/printcaju-mark.png" alt="" /><p>Suas preferências e dados do perfil ficam vinculados à sua conta administradora.</p></div>
  </div>
}
