import { createHash, randomBytes } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { defineSecret, defineString } from 'firebase-functions/params'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'
import { onDocumentWritten } from 'firebase-functions/v2/firestore'

initializeApp()
const db = getFirestore()
const ML_APP_ID = defineSecret('ML_APP_ID')
const ML_CLIENT_SECRET = defineSecret('ML_CLIENT_SECRET')
const ML_REDIRECT_URI = defineString('ML_REDIRECT_URI', { default: 'https://sistema-de-controle-de.web.app/mercadolivre/callback' })
const IG_APP_ID = defineString('IG_APP_ID')
const IG_APP_SECRET = defineSecret('IG_APP_SECRET')
const IG_REDIRECT_URI = defineString('IG_REDIRECT_URI', { default: 'https://sistema-de-controle-de.web.app/instagram/callback' })
const REGION = 'southamerica-east1'
const API = 'https://api.mercadolibre.com'

export const syncPublicProductAvailability = onDocumentWritten({
  document: 'users/{workspaceUid}/products/{productId}',
  region: REGION,
}, async (event) => {
  const product = event.data?.after.data()
  const publicProductRef = db.doc(`publicSiteProducts/${event.params.productId}`)
  if (!event.data?.after.exists || product?.active === false) {
    await publicProductRef.delete()
    return
  }
  const publicProduct = await publicProductRef.get()
  if (!publicProduct.exists) return
  const hasInventory = product.type === 'fisico'
  const quantity = hasInventory ? Math.max(0, Math.floor(Number(product.quantity) || 0)) : 0
  const inStock = !hasInventory || quantity > 0
  const publicData = publicProduct.data()
  if (publicData.hasInventory !== hasInventory || publicData.quantity !== quantity || publicData.inStock !== inStock) {
    await publicProductRef.set({ hasInventory, quantity, inStock }, { merge: true })
  }
})

async function workspaceFor(uid) {
  const [profile, owner] = await Promise.all([
    db.doc(`users/${uid}`).get(),
    db.doc('_system/owner').get(),
  ])
  const isOwner = owner.exists && owner.data().uid === uid
  if (!isOwner && (!profile.exists || profile.data().role !== 'admin')) {
    throw new HttpsError('permission-denied', 'Apenas administradores podem conectar o Mercado Livre.')
  }
  return owner.exists ? owner.data().uid : uid
}

async function authorizedWorkspace(request) {
  if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Entre no sistema para continuar.')
  return workspaceFor(request.auth.uid)
}

async function customerWorkspace() {
  const owner = await db.doc('_system/owner').get()
  if (owner.exists) return owner.data().uid
  const site = await db.doc('siteContent/main').get()
  return site.data()?.workspaceUid || process.env.PUBLIC_SITE_WORKSPACE_UID || ''
}

async function findCustomersByEmail(clientsRef, email) {
  const normalizedEmail = String(email || '').trim().toLocaleLowerCase('pt-BR')
  if (!normalizedEmail) return []
  const emailVariants = [...new Set([String(email || '').trim(), normalizedEmail].filter(Boolean))]
  const snapshots = await Promise.all([
    clientsRef.where('emailNormalized', '==', normalizedEmail).limit(3).get(),
    ...emailVariants.map((variant) => clientsRef.where('email', '==', variant).limit(3).get()),
  ])
  const matches = new Map()
  for (const snapshot of snapshots) {
    for (const document of snapshot.docs) {
      const data = document.data()
      const storedEmails = [data.emailNormalized, data.email]
      if (storedEmails.some((value) => typeof value === 'string' && value.trim().toLocaleLowerCase('pt-BR') === normalizedEmail)) {
        matches.set(document.id, document)
      }
    }
  }
  return [...matches.values()]
}

function selectCustomerMatch(matches, uid) {
  const linkedToAccount = matches.filter((document) => document.data().linkedAuthUid === uid)
  if (linkedToAccount.length > 1) {
    throw new HttpsError('failed-precondition', 'Encontramos mais de um cadastro vinculado à sua conta. Fale com a Print Caju para unificar os cadastros.')
  }
  if (linkedToAccount.length === 1) return linkedToAccount[0]
  if (matches.some((document) => document.data().linkedAuthUid)) {
    throw new HttpsError('already-exists', 'Este e-mail já está vinculado a outra conta. Fale com a Print Caju.')
  }
  const profileScore = (document) => {
    const data = document.data()
    const scoreFields = ['name', 'phone', 'taxId', 'address', 'city', 'state', 'postalCode']
    const populatedFields = scoreFields.filter((field) => String(data[field] || '').trim()).length
    const formSource = ['google-forms', 'public-form', 'website-form'].includes(data.registrationSource) ? 2 : 0
    return populatedFields + formSource
  }
  return [...matches].sort((first, second) => profileScore(second) - profileScore(first))[0]
}

export const startMercadoLivreConnection = onCall({ region: REGION, secrets: [ML_APP_ID] }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Entre no sistema para conectar sua conta.')
  const workspaceUid = await workspaceFor(uid)
  const state = randomBytes(32).toString('hex')
  await db.doc(`_oauthStates/${state}`).set({ uid, workspaceUid, createdAt: FieldValue.serverTimestamp(), expiresAt: Date.now() + 10 * 60 * 1000 })
  const url = new URL('https://auth.mercadolivre.com.br/authorization')
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', ML_APP_ID.value())
  url.searchParams.set('redirect_uri', ML_REDIRECT_URI.value())
  url.searchParams.set('state', state)
  return { authorizationUrl: url.toString() }
})

export const mercadoLivreCallback = onRequest({ region: REGION, secrets: [ML_APP_ID, ML_CLIENT_SECRET], cors: false }, async (req, res) => {
  const { code, state, error } = req.query
  const finish = (success, message) => res.status(success ? 200 : 400).set('Content-Type', 'text/html; charset=utf-8').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mercado Livre</title><body style="font:16px system-ui;max-width:520px;margin:12vh auto;padding:24px;color:#25252b"><h1>${success ? 'Conta conectada' : 'NÃ£o foi possÃ­vel conectar'}</h1><p>${message}</p><p>VocÃª pode fechar esta janela e voltar ao sistema.</p></body></html>`)
  try {
    if (error) return finish(false, 'A autorizaÃ§Ã£o foi cancelada no Mercado Livre.')
    if (typeof code !== 'string' || typeof state !== 'string') return finish(false, 'O retorno da autorizaÃ§Ã£o estÃ¡ incompleto. Tente conectar novamente.')
    const stateRef = db.doc(`_oauthStates/${state}`)
    const stateSnapshot = await stateRef.get()
    if (!stateSnapshot.exists || stateSnapshot.data().expiresAt < Date.now()) return finish(false, 'A solicitaÃ§Ã£o expirou. Volte ao sistema e conecte novamente.')
    const { workspaceUid } = stateSnapshot.data()
    await stateRef.delete()
    const tokenResponse = await fetch(`${API}/oauth/token`, {
      method: 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: ML_APP_ID.value(), client_secret: ML_CLIENT_SECRET.value(), code, redirect_uri: ML_REDIRECT_URI.value() }),
    })
    const token = await tokenResponse.json()
    if (!tokenResponse.ok || !token.access_token || !token.refresh_token) return finish(false, 'O Mercado Livre nÃ£o aceitou a autorizaÃ§Ã£o. Confira o endereÃ§o de retorno cadastrado e tente de novo.')
    await db.doc(`_privateIntegrations/${workspaceUid}`).set({
      provider: 'mercadolivre', sellerId: String(token.user_id), accessToken: token.access_token,
      refreshToken: token.refresh_token, expiresAt: Date.now() + Number(token.expires_in || 21600) * 1000,
      connectedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
    })
    return finish(true, 'A conta foi autorizada. Volte ao sistema e importe seus anÃºncios e estoques.')
  } catch (cause) {
    console.error('Falha no retorno OAuth Mercado Livre:', cause)
    return finish(false, 'Ocorreu um erro ao concluir a conexÃ£o. Tente novamente pelo sistema.')
  }
})

export const mercadoLivreNotification = onRequest({ region: REGION, cors: false }, async (req, res) => {
  if (req.method !== 'POST') return res.status(405).send('Method not allowed')
  const { topic, user_id: userId } = req.body || {}
  console.info('NotificaÃ§Ã£o recebida do Mercado Livre.', {
    topic: typeof topic === 'string' ? topic : 'unknown',
    userId: typeof userId === 'string' || typeof userId === 'number' ? userId : undefined,
  })
  return res.sendStatus(200)
})

async function getAccessToken(integrationRef, integration) {
  if (integration.expiresAt > Date.now() + 60_000) return integration.accessToken
  const response = await fetch(`${API}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'refresh_token', client_id: ML_APP_ID.value(), client_secret: ML_CLIENT_SECRET.value(), refresh_token: integration.refreshToken }),
  })
  const token = await response.json()
  if (!response.ok || !token.access_token || !token.refresh_token) throw new HttpsError('failed-precondition', 'A autorizaÃ§Ã£o expirou. Desconecte e conecte sua conta novamente.')
  await integrationRef.set({ accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + Number(token.expires_in || 21600) * 1000, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return token.access_token
}

async function mlGet(url, accessToken) {
  const response = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  const body = await response.json()
  if (!response.ok) throw new HttpsError('unavailable', body.message || `O Mercado Livre respondeu com erro ${response.status}.`)
  return body
}

export const getMercadoLivreConnection = onCall({ region: REGION }, async (request) => {
  const workspaceUid = await authorizedWorkspace(request)
  const integration = await db.doc(`_privateIntegrations/${workspaceUid}`).get()
  return integration.exists ? { connected: true, sellerId: integration.data().sellerId, connectedAt: integration.data().connectedAt?.toDate?.().toISOString() || null } : { connected: false }
})

export const syncMercadoLivreProducts = onCall({ region: REGION, secrets: [ML_APP_ID, ML_CLIENT_SECRET], timeoutSeconds: 540, memory: '1GiB' }, async (request) => {
  const workspaceUid = await authorizedWorkspace(request)
  const integrationRef = db.doc(`_privateIntegrations/${workspaceUid}`)
  const integrationSnapshot = await integrationRef.get()
  if (!integrationSnapshot.exists) throw new HttpsError('failed-precondition', 'Conecte sua conta do Mercado Livre primeiro.')
  const integration = integrationSnapshot.data()
  const accessToken = await getAccessToken(integrationRef, integration)

  const itemIds = []
  let scrollId = ''
  do {
    const url = new URL(`${API}/users/${encodeURIComponent(integration.sellerId)}/items/search`)
    url.searchParams.set('search_type', 'scan')
    url.searchParams.set('status', 'active')
    if (scrollId) url.searchParams.set('scroll_id', scrollId)
    const page = await mlGet(url, accessToken)
    itemIds.push(...(page.results || []))
    scrollId = page.scroll_id || ''
    if (!page.scroll_id) break
  } while (itemIds.length < 20_000)

  const productsRef = db.collection(`users/${workspaceUid}/products`)
  const current = await productsRef.get()
  const existingByItemId = new Map(current.docs.filter((item) => item.data().mlItemId).map((item) => [item.data().mlItemId, item]))
  let imported = 0
  for (let offset = 0; offset < itemIds.length; offset += 20) {
    const ids = itemIds.slice(offset, offset + 20)
    const url = new URL(`${API}/items/bulk`)
    url.searchParams.set('ids', ids.join(','))
    url.searchParams.set('attributes', 'body.id,body.title,body.price,body.available_quantity,body.status,body.seller_custom_field,body.category_id,body.permalink,body.variations')
    const results = await mlGet(url, accessToken)
    const batch = db.batch()
    for (const result of results) {
      const item = result.body
      if (result.status_code < 200 || result.status_code >= 300 || !item?.id) continue
      const existing = existingByItemId.get(item.id)
      const productRef = existing?.ref || productsRef.doc()
      const prior = existing?.data() || {}
      const variationStock = Array.isArray(item.variations) && item.variations.length
        ? item.variations.reduce((sum, variation) => sum + (Number(variation.available_quantity) || 0), 0)
        : Number(item.available_quantity) || 0
      batch.set(productRef, {
        ...prior,
        name: item.title || prior.name || item.id,
        sku: item.seller_custom_field || prior.sku || item.id,
        type: 'mercadolivre', mlItemId: item.id, mlStatus: item.status || 'active',
        mlUrl: item.permalink || '', category: item.category_id || prior.category || '',
        quantity: variationStock, price: Number(item.price) || 0,
        cost: Number(prior.cost) || 0, minStock: Number(prior.minStock) || 0,
        description: prior.description || '', active: true,
        inventorySyncedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        ...(!existing ? { createdAt: FieldValue.serverTimestamp() } : {}),
      }, { merge: true })
      imported += 1
    }
    await batch.commit()
  }
  return { imported, sellerId: integration.sellerId, truncated: itemIds.length >= 20_000 }
})

export const createPublicOrderForm = onCall({ region: REGION }, async (request) => {
  const workspaceUid = await authorizedWorkspace(request)
  const saleId = request.data?.saleId
  if (typeof saleId !== 'string' || !saleId || saleId.length > 128) throw new HttpsError('invalid-argument', 'Pedido inválido.')
  const saleRef = db.doc(`users/${workspaceUid}/externalSales/${saleId}`)
  const token = randomBytes(24).toString('hex')
  return db.runTransaction(async (tx) => {
    const sale = await tx.get(saleRef)
    if (!sale.exists) throw new HttpsError('not-found', 'Pedido não encontrado.')
    if (sale.data().customerFormToken) return { token: sale.data().customerFormToken }
    tx.update(saleRef, { customerFormToken: token, updatedAt: FieldValue.serverTimestamp() })
    tx.create(db.doc(`_publicOrderForms/${token}`), { workspaceUid, saleId, createdAt: FieldValue.serverTimestamp(), submittedAt: null })
    return { token }
  })
})

export const createCustomerRegistrationForm = onCall({ region: REGION }, async (request) => {
  const workspaceUid = await authorizedWorkspace(request)
  const token = randomBytes(24).toString('hex')
  await db.doc(`_publicOrderForms/${token}`).set({ kind: 'registration', workspaceUid, createdAt: FieldValue.serverTimestamp(), submittedAt: null })
  return { token }
})

export const getPublicOrderForm = onCall({ region: REGION }, async (request) => {
  const token = request.data?.token
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) throw new HttpsError('not-found', 'Link inválido.')
  const form = await db.doc(`_publicOrderForms/${token}`).get()
  if (!form.exists) throw new HttpsError('not-found', 'Este formulário não está disponível.')
  const data = form.data()
  if (data.submittedAt) return { submitted: true, kind: data.kind || 'order' }
  if (data.kind === 'registration') return { submitted: false, kind: 'registration' }
  const sale = await db.doc(`users/${data.workspaceUid}/externalSales/${data.saleId}`).get()
  if (!sale.exists) throw new HttpsError('not-found', 'Pedido não encontrado.')
  return { submitted: false, orderCode: data.saleId.slice(0, 7).toUpperCase(), itemNames: (sale.data().items || []).map((item) => item.description).slice(0, 20) }
})

export const submitPublicOrderForm = onCall({ region: REGION }, async (request) => {
  const token = request.data?.token
  const input = request.data?.profile
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token) || !input || typeof input !== 'object') throw new HttpsError('invalid-argument', 'Confira os dados do formulário.')
  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
  const profile = { name: clean(input.name, 120), taxId: clean(input.taxId, 18), phone: clean(input.phone, 20), email: clean(input.email, 160), address: clean(input.address, 180), city: clean(input.city, 80), state: clean(input.state, 2).toUpperCase(), postalCode: clean(input.postalCode, 10) }
  if (profile.name.length < 2 || (!profile.phone && !profile.email)) throw new HttpsError('invalid-argument', 'Informe seu nome e telefone ou e-mail.')
  const formRef = db.doc(`_publicOrderForms/${token}`)
  await db.runTransaction(async (tx) => {
    const form = await tx.get(formRef)
    if (!form.exists || form.data().submittedAt) throw new HttpsError('failed-precondition', 'Este formulário já foi respondido ou não está disponível.')
    const { workspaceUid, saleId } = form.data()
    if (form.data().kind === 'registration') {
      const clientsRef = db.collection(`users/${workspaceUid}/clients`)
      const clientRef = clientsRef.doc()
      const normalized = {
        ...profile,
        taxIdDigits: profile.taxId.replace(/\D/g, ''),
        phoneDigits: profile.phone.replace(/\D/g, ''),
        emailNormalized: profile.email.toLocaleLowerCase('pt-BR'),
        createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        registrationSource: 'public-form',
      }
      tx.create(clientRef, normalized)
      tx.update(formRef, { submittedAt: FieldValue.serverTimestamp(), clientId: clientRef.id })
      return
    }
    const saleRef = db.doc(`users/${workspaceUid}/externalSales/${saleId}`)
    const sale = await tx.get(saleRef)
    if (!sale.exists) throw new HttpsError('not-found', 'Pedido não encontrado.')
    tx.update(saleRef, { client: profile, ...(profile.address ? { delivery: { ...(sale.data().delivery || {}), address: profile.address, city: profile.city, state: profile.state, postalCode: profile.postalCode } } : {}), customerFormSubmittedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    tx.update(formRef, { submittedAt: FieldValue.serverTimestamp() })
  })
  return { ok: true }
})

export const submitWebsiteCustomerRegistration = onCall({ region: REGION }, async (request) => {
  const input = request.data?.profile
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new HttpsError('invalid-argument', 'Confira os dados do formulário.')
  }
  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
  const profile = {
    name: clean(input.name, 120),
    phone: clean(input.phone, 20),
    email: clean(input.email, 160),
    taxId: clean(input.taxId, 18),
    address: clean(input.address, 180),
    city: clean(input.city, 80),
    state: clean(input.state, 2).toUpperCase(),
    postalCode: clean(input.postalCode, 10),
  }
  const normalizedEmail = profile.email.toLocaleLowerCase('pt-BR')
  if (profile.name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new HttpsError('invalid-argument', 'Informe seu nome completo e um e-mail válido.')
  }
  const workspaceUid = await customerWorkspace()
  if (!workspaceUid) throw new HttpsError('failed-precondition', 'O cadastro de clientes ainda não está configurado.')
  const clients = db.collection(`users/${workspaceUid}/clients`)
  const clientId = `site_${createHash('sha256').update(normalizedEmail).digest('hex').slice(0, 40)}`
  const clientRef = clients.doc(clientId)
  await db.runTransaction(async (tx) => {
    const existing = await tx.get(clientRef)
    if (existing.exists && existing.data().emailNormalized === normalizedEmail) return
    const matches = await tx.get(clients.where('emailNormalized', '==', normalizedEmail).limit(2))
    if (!matches.empty) throw new HttpsError('already-exists', 'Este e-mail já possui cadastro. Entre na sua conta ou fale com a Print Caju.')
    tx.create(clientRef, {
      ...profile,
      emailNormalized: normalizedEmail,
      phoneDigits: profile.phone.replace(/\D/g, ''),
      taxIdDigits: profile.taxId.replace(/\D/g, ''),
      registrationSource: 'website-form',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    })
  })
  return { ok: true }
})

export const registerCustomerAccount = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid
  const email = request.auth?.token?.email
  if (!uid || !email) throw new HttpsError('unauthenticated', 'Entre na sua conta para continuar.')
  if (request.auth.token.email_verified !== true) throw new HttpsError('failed-precondition', 'Confirme seu e-mail antes de acessar seus pedidos.')
  const workspaceUid = await customerWorkspace()
  if (!workspaceUid) throw new HttpsError('failed-precondition', 'A conta da empresa ainda não está configurada para o portal de clientes.')
  const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : ''
  const normalizedEmail = email.trim().toLocaleLowerCase('pt-BR')
  const clientsRef = db.collection(`users/${workspaceUid}/clients`)
  const matches = await findCustomersByEmail(clientsRef, email)
  const profile = { name: clean(request.data?.name || request.auth.token.name, 120), phone: clean(request.data?.phone, 30) }
  if (matches.length) {
    const existing = selectCustomerMatch(matches, uid)
    const existingData = existing.data()
    const linkedUid = existingData.linkedAuthUid
    if (linkedUid && linkedUid !== uid) throw new HttpsError('already-exists', 'Este cadastro já está vinculado a outra conta. Fale com a Print Caju.')
    const updates = {}
    if (!linkedUid) {
      updates.linkedAuthUid = uid
      updates.linkedAt = FieldValue.serverTimestamp()
    }
    if (existingData.emailNormalized !== normalizedEmail) updates.emailNormalized = normalizedEmail
    if (!existingData.email) updates.email = email.slice(0, 160)
    if (Object.keys(updates).length) {
      updates.updatedAt = FieldValue.serverTimestamp()
      await existing.ref.update(updates)
    }
    return { linked: true, created: false }
  }
  if (profile.name.length < 2) return { linked: false, created: false }
  const newClient = clientsRef.doc(`portal_${uid}`)
  await newClient.set({ ...profile, email: email.slice(0, 160), emailNormalized: normalizedEmail, phoneDigits: profile.phone.replace(/\D/g, ''), taxId: '', taxIdDigits: '', address: '', city: '', state: '', postalCode: '', linkedAuthUid: uid, linkedAt: FieldValue.serverTimestamp(), registrationSource: 'customer-portal', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  return { linked: true, created: true }
})

export const getCustomerPortalData = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid
  const email = request.auth?.token?.email
  if (!uid || !email) throw new HttpsError('unauthenticated', 'Entre na sua conta para continuar.')
  if (request.auth.token.email_verified !== true) throw new HttpsError('failed-precondition', 'Confirme seu e-mail antes de acessar seus pedidos.')
  const workspaceUid = await customerWorkspace()
  if (!workspaceUid) return { linked: false, client: null, orders: [] }
  const normalizedEmail = email.trim().toLocaleLowerCase('pt-BR')
  const clients = await db.collection(`users/${workspaceUid}/clients`).where('linkedAuthUid', '==', uid).limit(1).get()
  let clientDoc = clients.docs[0]
  if (!clientDoc) {
    const matching = await findCustomersByEmail(db.collection(`users/${workspaceUid}/clients`), email)
    clientDoc = matching.length ? selectCustomerMatch(matching, uid) : undefined
    if (clientDoc) {
      const clientData = clientDoc.data()
      const linkedUid = clientData.linkedAuthUid
      if (linkedUid && linkedUid !== uid) throw new HttpsError('already-exists', 'Este cadastro já está vinculado a outra conta. Fale com a Print Caju.')
      const updates = {}
      if (!linkedUid) {
        updates.linkedAuthUid = uid
        updates.linkedAt = FieldValue.serverTimestamp()
      }
      if (clientData.emailNormalized !== normalizedEmail) updates.emailNormalized = normalizedEmail
      if (!clientData.email) updates.email = email.slice(0, 160)
      if (Object.keys(updates).length) {
        updates.updatedAt = FieldValue.serverTimestamp()
        await clientDoc.ref.update(updates)
      }
    }
  }
  if (!clientDoc) return { linked: false, client: null, orders: [] }
  const client = clientDoc.data()
  const profileUpdates = {}
  if (client.emailNormalized !== normalizedEmail) profileUpdates.emailNormalized = normalizedEmail
  if (!client.email) profileUpdates.email = email.slice(0, 160)
  if (Object.keys(profileUpdates).length) {
    profileUpdates.updatedAt = FieldValue.serverTimestamp()
    await clientDoc.ref.update(profileUpdates)
    Object.assign(client, profileUpdates)
  }
  const salesCollection = db.collection(`users/${workspaceUid}/externalSales`)
  const [byClientId, byExactEmail, byNormalizedEmail] = await Promise.all([
    salesCollection.where('clientId', '==', clientDoc.id).get(),
    salesCollection.where('client.email', '==', String(client.email || '')).get(),
    salesCollection.where('client.email', '==', normalizedEmail).get(),
  ])
  const uniqueSales = new Map([...byClientId.docs, ...byExactEmail.docs, ...byNormalizedEmail.docs].map((item) => [item.id, { id: item.id, ...item.data() }]))
  const orders = [...uniqueSales.values()]
    .sort((a, b) => String(b.soldAt || '').localeCompare(String(a.soldAt || '')))
    .slice(0, 100)
    .map((sale) => ({
      id: sale.id,
      soldAt: String(sale.soldAt || ''),
      dueDate: String(sale.dueDate || ''),
      items: (Array.isArray(sale.items) ? sale.items : []).slice(0, 30).filter((item) => item && typeof item === 'object').map((item) => ({
        description: String(item.description || '').slice(0, 120),
        quantity: Number(item.quantity) || 0,
        unitPrice: Number(item.unitPrice) || 0,
        scheduledPurchase: item.scheduledPurchase === true,
        scheduledQuantity: Number(item.scheduledQuantity) || 0,
      })),
      total: Number(sale.total) || 0,
      receivedAmount: Number(sale.receivedAmount) || 0,
      outstandingAmount: Number(sale.outstandingAmount) || 0,
      paymentStatus: String(sale.paymentStatus || 'pending'),
      productionStatus: String(sale.productionStatus || 'not_started'),
      deliveryStatus: String(sale.deliveryStatus || 'pending'),
      orderApprovalStatus: String(sale.orderApprovalStatus || 'approved'),
      status: sale.status === 'cancelled' ? 'cancelled' : 'active',
    }))
  const site = await db.doc('siteContent/main').get()
  return { linked: true, client: { name: String(client.name || '').slice(0, 120), email: normalizedEmail, phone: String(client.phone || '').slice(0, 30), taxId: String(client.taxId || '').slice(0, 24), address: String(client.address || '').slice(0, 180), city: String(client.city || '').slice(0, 80), state: String(client.state || '').slice(0, 2), postalCode: String(client.postalCode || '').slice(0, 12) }, whatsapp: String(site.data()?.whatsapp || '5584987115381').replace(/\D/g, ''), orders }
})

export const createCustomerOrderRequest = onCall({ region: REGION }, async (request) => {
  const uid = request.auth?.uid
  const email = request.auth?.token?.email
  if (!uid || !email) throw new HttpsError('unauthenticated', 'Entre na sua conta para enviar a solicitação.')
  if (request.auth.token.email_verified !== true) throw new HttpsError('failed-precondition', 'Confirme seu e-mail antes de solicitar a compra.')

  const inputItems = request.data?.items
  const requestId = request.data?.requestId
  if (typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestId)) {
    throw new HttpsError('invalid-argument', 'Não foi possível validar esta tentativa de compra. Atualize a página e tente novamente.')
  }
  if (!Array.isArray(inputItems) || inputItems.length < 1 || inputItems.length > 30) {
    throw new HttpsError('invalid-argument', 'A sacola deve conter de 1 a 30 produtos.')
  }
  const quantities = new Map()
  for (const item of inputItems) {
    if (typeof item?.productId !== 'string' || !/^[A-Za-z0-9_-]{1,150}$/.test(item.productId)) {
      throw new HttpsError('invalid-argument', 'Um dos produtos da sacola é inválido.')
    }
    const quantity = Number(item.quantity)
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
      throw new HttpsError('invalid-argument', 'A quantidade de cada produto deve estar entre 1 e 50.')
    }
    quantities.set(item.productId, (quantities.get(item.productId) || 0) + quantity)
    if (quantities.get(item.productId) > 50) throw new HttpsError('invalid-argument', 'A quantidade máxima por produto é 50.')
  }

  const workspaceUid = await customerWorkspace()
  if (!workspaceUid) throw new HttpsError('failed-precondition', 'A loja ainda não está configurada para receber solicitações.')
  const normalizedEmail = email.trim().toLocaleLowerCase('pt-BR')
  const clientMatches = await db.collection(`users/${workspaceUid}/clients`).where('linkedAuthUid', '==', uid).limit(2).get()
  if (clientMatches.size !== 1) throw new HttpsError('failed-precondition', 'Conclua o cadastro e confirme seu e-mail antes de enviar a solicitação.')

  const clientRef = clientMatches.docs[0].ref
  const salesRef = db.collection(`users/${workspaceUid}/externalSales`).doc()
  const mailRef = db.collection('mail').doc()
  const requestRef = db.doc(`_websiteOrderRequests/${uid}_${requestId}`)
  const publicRefs = [...quantities.keys()].map((id) => db.doc(`publicSiteProducts/${id}`))
  const productRefs = [...quantities.keys()].map((id) => db.doc(`users/${workspaceUid}/products/${id}`))
  const siteSnapshot = await db.doc('siteContent/main').get()
  const site = siteSnapshot.data() || {}
  const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[character])
  let orderTotal = 0
  let customerName = ''
  const orderItems = []
  const orderResult = await db.runTransaction(async (tx) => {
    const previousRequest = await tx.get(requestRef)
    if (previousRequest.exists) return { orderId: previousRequest.data().orderId, total: previousRequest.data().total, emailQueued: false }
    orderTotal = 0
    customerName = ''
    orderItems.length = 0
    const [clientSnapshot, publicSnapshots, productSnapshots] = await Promise.all([
      tx.get(clientRef),
      Promise.all(publicRefs.map((ref) => tx.get(ref))),
      Promise.all(productRefs.map((ref) => tx.get(ref))),
    ])
    const linkedClient = clientSnapshot.data()
    const linkedClientEmail = String(linkedClient?.emailNormalized || linkedClient?.email || '').trim().toLocaleLowerCase('pt-BR')
    if (!clientSnapshot.exists || linkedClient.linkedAuthUid !== uid || linkedClientEmail !== normalizedEmail) {
      throw new HttpsError('permission-denied', 'Não foi possível validar o cadastro vinculado à sua conta.')
    }
    customerName = String(clientSnapshot.data().name || '').slice(0, 120)
    for (let index = 0; index < productSnapshots.length; index += 1) {
      const product = productSnapshots[index].data()
      const publicProduct = publicSnapshots[index].data()
      const productId = [...quantities.keys()][index]
      if (!productSnapshots[index].exists || !publicSnapshots[index].exists
        || product.active === false || publicProduct.published !== true
        || Number(product.price) !== Number(publicProduct.price)
        || !Number.isFinite(Number(product.price)) || Number(product.price) < 0) {
        throw new HttpsError('failed-precondition', 'Um produto da sacola mudou ou não está mais disponível. Atualize o catálogo e tente novamente.')
      }
      const quantity = quantities.get(productId)
      const unitPrice = Number(product.price)
      const availableQuantity = product.type === 'fisico' ? Math.max(0, Math.floor(Number(product.quantity) || 0)) : quantity
      const scheduledQuantity = Math.max(0, quantity - availableQuantity)
      orderTotal += unitPrice * quantity
      orderItems.push({
        ...(product.type === 'fisico' ? { productId } : {}),
        description: String(product.name || publicProduct.name || 'Produto').slice(0, 120),
        quantity,
        unitPrice,
        scheduledPurchase: scheduledQuantity > 0,
        scheduledQuantity,
      })
    }
    const now = new Date()
    const soldAt = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza' }).format(now)
    const orderCode = salesRef.id.slice(0, 7).toUpperCase()
    const customer = clientSnapshot.data()
    const scheduledItems = orderItems.filter((item) => item.scheduledPurchase)
    const scheduledSummary = scheduledItems.map((item) => `${item.description}: ${item.scheduledQuantity} unidade(s)`).join(', ')
    const sale = {
      source: 'website',
      channel: 'website',
      status: 'active',
      orderApprovalStatus: 'pending',
      scheduledPurchase: scheduledItems.length > 0,
      inventoryApplied: false,
      clientId: clientRef.id,
      client: {
        name: customerName,
        email: normalizedEmail,
        phone: String(customer.phone || '').slice(0, 30),
        taxId: String(customer.taxId || '').slice(0, 24),
      },
      items: orderItems,
      soldAt,
      total: orderTotal,
      discount: 0,
      fees: 0,
      extraAmount: 0,
      receivedAmount: 0,
      outstandingAmount: orderTotal,
      paymentStatus: 'pending',
      paymentMethod: 'outro',
      deliveryMethod: 'delivery',
      delivery: {
        address: String(customer.address || '').slice(0, 180),
        city: String(customer.city || '').slice(0, 80),
        state: String(customer.state || '').slice(0, 2),
        postalCode: String(customer.postalCode || '').slice(0, 12),
      },
      deliveryStatus: 'pending',
      productionStatus: 'not_started',
      orderType: 'physical',
      notes: `Solicitação enviada pelo site. Aguardando confirmação da Print Caju.${scheduledSummary ? ` Compra agendada, aguardando reposição: ${scheduledSummary}.` : ''}`,
      customerAuthUid: uid,
      createdBy: 'website-customer',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    }
    const rows = orderItems.map((item) => `<tr><td style="padding:10px;border-bottom:1px solid #eee">${escapeHtml(item.description)} × ${item.quantity}${item.scheduledPurchase ? `<br><small style="color:#a64b37">Agendada: ${item.scheduledQuantity} unidade(s), aguardando reposição</small>` : ''}</td><td style="padding:10px;border-bottom:1px solid #eee;text-align:right">${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.unitPrice * item.quantity)}</td></tr>`).join('')
    const logoUrl = 'https://sistema-de-controle-de.web.app/printcaju-logo.png'
    const subject = `Recebemos sua solicitação de compra #${orderCode} · ${site.brandName || 'Print Caju'}`
    tx.create(salesRef, sale)
    tx.create(mailRef, {
      to: normalizedEmail,
      message: {
        subject,
        text: `Olá, ${customerName}! Recebemos sua solicitação #${orderCode}, no valor de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(orderTotal)}.${scheduledSummary ? ` Compra agendada aguardando reposição: ${scheduledSummary}.` : ''} A Print Caju vai confirmar disponibilidade, previsão e próximos passos. Acompanhe em sua conta no site.`,
        html: `<div style="max-width:560px;margin:24px auto;padding:32px;background:#fffdfa;border:1px solid #eee9e1;border-radius:12px;font-family:Arial,sans-serif;color:#292638"><img src="${logoUrl}" alt="${escapeHtml(site.brandName || 'Print Caju')}" style="width:160px;max-height:60px;object-fit:contain"><p style="color:#bd6b26;font-size:12px;font-weight:bold;letter-spacing:2px">SOLICITAÇÃO RECEBIDA</p><h1 style="font-family:Georgia,serif;font-weight:500">Olá, ${escapeHtml(customerName)}!</h1><p>Recebemos sua solicitação <strong>#${orderCode}</strong>. A compra ainda depende da confirmação da disponibilidade pela Print Caju.${scheduledItems.length ? ' Os itens agendados aguardam reposição; a equipe confirmará a previsão.' : ''}</p><table style="width:100%;border-collapse:collapse">${rows}<tr><td style="padding:14px 10px"><strong>Total solicitado</strong></td><td style="padding:14px 10px;text-align:right"><strong>${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(orderTotal)}</strong></td></tr></table><p>Você pode acompanhar o pedido em sua conta no site ${escapeHtml(site.brandName || 'Print Caju')}.</p></div>`,
      },
      createdAt: FieldValue.serverTimestamp(),
    })
    tx.create(requestRef, { orderId: salesRef.id, total: orderTotal, createdAt: FieldValue.serverTimestamp() })
    return { orderId: salesRef.id, total: orderTotal, emailQueued: true }
  })
  return { ...orderResult, orderCode: orderResult.orderId.slice(0, 7).toUpperCase(), whatsapp: String(site.whatsapp || '5584987115381').replace(/\D/g, '') }
})

export const startInstagramConnection = onCall({ region: REGION, secrets: [IG_APP_SECRET] }, async (request) => {
  const workspaceUid = await authorizedWorkspace(request)
  if (!IG_APP_ID.value() || !IG_APP_SECRET.value()) throw new HttpsError('failed-precondition', 'Configure o ID e o segredo do aplicativo Instagram no Firebase Functions antes de conectar.')
  const state = randomBytes(32).toString('hex')
  await db.doc(`_oauthStates/instagram_${state}`).set({ uid: request.auth.uid, workspaceUid, createdAt: FieldValue.serverTimestamp(), expiresAt: Date.now() + 10 * 60 * 1000 })
  const url = new URL('https://www.instagram.com/oauth/authorize')
  url.searchParams.set('client_id', IG_APP_ID.value())
  url.searchParams.set('redirect_uri', IG_REDIRECT_URI.value())
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', 'instagram_business_basic')
  url.searchParams.set('state', state)
  url.searchParams.set('enable_fb_login', '0')
  return { authorizationUrl: url.toString() }
})

export const instagramCallback = onRequest({ region: REGION, secrets: [IG_APP_SECRET], cors: false }, async (req, res) => {
  const { code, state, error } = req.query
  const redirect = (status) => {
    const destination = new URL('/admin/site', new URL(IG_REDIRECT_URI.value()).origin)
    destination.searchParams.set('instagram', status)
    return res.redirect(302, destination.toString())
  }
  try {
    if (error || typeof code !== 'string' || typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) return redirect('cancelled')
    const stateRef = db.doc(`_oauthStates/instagram_${state}`)
    const stateSnapshot = await stateRef.get()
    if (!stateSnapshot.exists || stateSnapshot.data().expiresAt < Date.now()) return redirect('expired')
    const { workspaceUid } = stateSnapshot.data()
    await stateRef.delete()
    const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: IG_APP_ID.value(), client_secret: IG_APP_SECRET.value(), grant_type: 'authorization_code', redirect_uri: IG_REDIRECT_URI.value(), code }),
    })
    const shortToken = await tokenResponse.json()
    if (!tokenResponse.ok || !shortToken.access_token || !shortToken.user_id) return redirect('token_error')
    const longTokenUrl = new URL('https://graph.instagram.com/access_token')
    longTokenUrl.search = new URLSearchParams({ grant_type: 'ig_exchange', client_secret: IG_APP_SECRET.value(), access_token: shortToken.access_token }).toString()
    const longResponse = await fetch(longTokenUrl)
    const longToken = await longResponse.json()
    if (!longResponse.ok || !longToken.access_token) return redirect('token_error')
    const profileUrl = new URL(`https://graph.instagram.com/${encodeURIComponent(shortToken.user_id)}`)
    profileUrl.search = new URLSearchParams({ fields: 'user_id,username', access_token: longToken.access_token }).toString()
    const profileResponse = await fetch(profileUrl)
    const profile = await profileResponse.json()
    if (!profileResponse.ok || !profile.username) return redirect('profile_error')
    if (String(profile.username).toLocaleLowerCase('en-US') !== 'printcaju') return redirect('wrong_account')
    await db.doc(`_privateInstagram/${workspaceUid}`).set({ userId: String(profile.user_id || shortToken.user_id), username: String(profile.username).slice(0, 80), accessToken: longToken.access_token, expiresAt: Date.now() + Number(longToken.expires_in || 5184000) * 1000, connectedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() })
    return redirect('connected')
  } catch (cause) {
    console.error('Falha no retorno OAuth Instagram:', cause)
    return redirect('error')
  }
})

export const syncInstagramPosts = onCall({ region: REGION, timeoutSeconds: 540, secrets: [IG_APP_SECRET] }, async (request) => {
  const workspaceUid = await authorizedWorkspace(request)
  const integrationRef = db.doc(`_privateInstagram/${workspaceUid}`)
  const integrationSnapshot = await integrationRef.get()
  if (!integrationSnapshot.exists) throw new HttpsError('failed-precondition', 'Conecte uma conta profissional do Instagram primeiro.')
  const integration = integrationSnapshot.data()
  let accessToken = integration.accessToken
  if (integration.expiresAt < Date.now() + 7 * 24 * 60 * 60 * 1000) {
    const refreshUrl = new URL('https://graph.instagram.com/refresh_access_token')
    refreshUrl.search = new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: accessToken }).toString()
    const refreshedResponse = await fetch(refreshUrl)
    const refreshed = await refreshedResponse.json()
    if (!refreshedResponse.ok || !refreshed.access_token) throw new HttpsError('failed-precondition', 'A conexão com o Instagram expirou. Conecte novamente.')
    accessToken = refreshed.access_token
    await integrationRef.set({ accessToken, expiresAt: Date.now() + Number(refreshed.expires_in || 5184000) * 1000, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  }
  const mediaUrl = new URL(`https://graph.instagram.com/${encodeURIComponent(integration.userId)}/media`)
  mediaUrl.search = new URLSearchParams({ fields: 'id,caption,media_type,media_url,permalink,thumbnail_url,timestamp', limit: '100', access_token: accessToken }).toString()
  const posts = []
  let nextUrl = mediaUrl
  let pageCount = 0
  while (nextUrl) {
    if (++pageCount > 500) throw new HttpsError('resource-exhausted', 'O Instagram retornou mais de 50.000 publicações. A sincronização foi interrompida com segurança.')
    const mediaResponse = await fetch(nextUrl)
    const media = await mediaResponse.json()
    if (!mediaResponse.ok) throw new HttpsError('unavailable', media.error?.message || 'Não foi possível carregar todas as publicações do Instagram.')
    for (const item of media.data || []) {
      const image = item.media_type === 'VIDEO' ? item.thumbnail_url || '' : item.media_url || item.thumbnail_url || ''
      if (!item.id || !item.permalink) continue
      posts.push({
        id: String(item.id),
        caption: String(item.caption || '').slice(0, 1000),
        type: String(item.media_type || 'IMAGE'),
        image: String(image),
        url: String(item.permalink),
        timestamp: String(item.timestamp || ''),
        published: true,
        syncedAt: FieldValue.serverTimestamp(),
      })
    }
    const next = media.paging?.next
    if (!next) {
      nextUrl = null
    } else {
      const candidate = new URL(next)
      if (candidate.protocol !== 'https:' || candidate.hostname !== 'graph.instagram.com') {
        throw new HttpsError('unavailable', 'O Instagram retornou um endereço de paginação inválido.')
      }
      nextUrl = candidate
    }
  }

  const postsCollection = db.collection('publicInstagramPosts')
  const existing = await postsCollection.get()
  const postIds = new Set(posts.map((post) => post.id))
  const writes = [
    ...posts.map((post) => ({ ref: postsCollection.doc(post.id), data: post })),
    ...existing.docs.filter((snapshot) => !postIds.has(snapshot.id)).map((snapshot) => ({ ref: snapshot.ref, delete: true })),
  ]
  for (let offset = 0; offset < writes.length; offset += 450) {
    const batch = db.batch()
    for (const write of writes.slice(offset, offset + 450)) {
      if (write.delete) batch.delete(write.ref)
      else batch.set(write.ref, write.data)
    }
    await batch.commit()
  }
  await db.doc('siteContent/main').set({
    instagramUsername: String(integration.username || ''),
    instagramPosts: [],
    instagramPostCount: posts.length,
    instagramSyncedAt: FieldValue.serverTimestamp(),
  }, { merge: true })
  return { username: integration.username, count: posts.length }
})

export const getInstagramConnection = onCall({ region: REGION }, async (request) => {
  const workspaceUid = await authorizedWorkspace(request)
  const integration = await db.doc(`_privateInstagram/${workspaceUid}`).get()
  return integration.exists ? { connected: true, username: String(integration.data().username || '') } : { connected: false, username: '' }
})
