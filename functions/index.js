import { randomBytes } from 'node:crypto'
import { initializeApp } from 'firebase-admin/app'
import { getFirestore, FieldValue } from 'firebase-admin/firestore'
import { defineSecret, defineString } from 'firebase-functions/params'
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https'

initializeApp()
const db = getFirestore()
const ML_APP_ID = defineSecret('ML_APP_ID')
const ML_CLIENT_SECRET = defineSecret('ML_CLIENT_SECRET')
const ML_REDIRECT_URI = defineString('ML_REDIRECT_URI', { default: 'https://sistema-de-controle-de.web.app/mercadolivre/callback' })
const REGION = 'southamerica-east1'
const API = 'https://api.mercadolibre.com'

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


