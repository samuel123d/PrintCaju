import { collection, deleteDoc, doc, onSnapshot, orderBy, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore'
import { db } from './firebase/config.js'

const contentRef = doc(db, 'siteContent', 'main')
const publishedRef = (id) => doc(db, 'publicSiteProducts', id)
const cartStorageKey = 'printcaju-shopping-cart'

export const DEFAULT_SITE_CONTENT = {
  brandName: 'Print Caju',
  tagline: 'Ideias que ganham forma.',
  heroTitle: 'Peças únicas, feitas para você.',
  heroText: 'Impressão 3D com criatividade, cuidado e acabamento de qualidade.',
  aboutTitle: 'Feito com cuidado, do primeiro desenho à peça final.',
  aboutText: 'Criamos produtos impressos em 3D para presentear, organizar e dar vida a novas ideias. Fale com a gente para encontrar a peça ideal ou desenvolver um projeto especial.',
  phone: '', email: '', instagram: '@printcaju', whatsapp: '5584987115381', beholdFeedId: 'R9x0OkdwtIceyUI4rfzB',
}

export function loadShoppingCart() {
  try {
    const stored = JSON.parse(localStorage.getItem(cartStorageKey) || '{}')
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {}
    return Object.fromEntries(Object.entries(stored)
      .filter(([id, quantity]) => /^[A-Za-z0-9_-]{1,150}$/.test(id) && Number.isInteger(quantity) && quantity > 0 && quantity <= 50))
  } catch (cause) {
    console.warn('Não foi possível ler a sacola de compras salva neste navegador.', cause)
    return {}
  }
}

export function saveShoppingCart(cart) {
  try {
    localStorage.setItem(cartStorageKey, JSON.stringify(cart))
  } catch (cause) {
    console.error('Não foi possível salvar a sacola neste navegador.', cause)
  }
}

export function watchSiteContent(onValue, onError) {
  return onSnapshot(contentRef, (snapshot) => {
    const content = { ...DEFAULT_SITE_CONTENT, ...(snapshot.exists() ? snapshot.data() : {}) }
    if (!String(content.whatsapp || '').replace(/\D/g, '')) content.whatsapp = DEFAULT_SITE_CONTENT.whatsapp
    if (!String(content.instagram || '').trim()) content.instagram = DEFAULT_SITE_CONTENT.instagram
    if (!String(content.beholdFeedId || '').trim()) content.beholdFeedId = DEFAULT_SITE_CONTENT.beholdFeedId
    onValue(content)
  }, onError)
}

export function watchPublicProducts(onValue, onError) {
  return onSnapshot(query(collection(db, 'publicSiteProducts'), where('published', '==', true)), (snapshot) => onValue(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })).sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))), onError)
}

export function watchPublicInstagramPosts(onValue, onError) {
  return onSnapshot(
    query(collection(db, 'publicInstagramPosts'), where('published', '==', true)),
    (snapshot) => {
      const posts = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .sort((a, b) => String(b.timestamp || '').localeCompare(String(a.timestamp || '')))
      onValue(posts)
    },
    onError,
  )
}

export function watchAdminProducts(uid, onValue, onError) {
  return onSnapshot(query(collection(db, 'users', uid, 'products'), orderBy('name')), (snapshot) => onValue(snapshot.docs.map((item) => ({ id: item.id, ...item.data() }))), onError)
}

export function publicSiteProductData(product) {
  let photo = ''
  const bytes = product.photoBytes?.toUint8Array?.()
  if (bytes?.length && product.photoContentType) {
    let binary = ''
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
    photo = `data:${product.photoContentType};base64,${btoa(binary)}`
  }
  return {
    name: String(product.name || '').slice(0, 120),
    description: String(product.description || '').slice(0, 700),
    category: String(product.category || '').slice(0, 80),
    price: Number(product.price) || 0,
    photo,
    hasInventory: product.type === 'fisico',
    quantity: product.type === 'fisico' ? Math.max(0, Math.floor(Number(product.quantity) || 0)) : 0,
    inStock: product.type !== 'fisico' || Number(product.quantity) > 0,
    published: true,
    updatedAt: serverTimestamp(),
  }
}

export async function syncPublicCatalog(products, publishedProducts) {
  const activeProducts = products.filter((product) => product.active !== false)
  const activeIds = new Set(activeProducts.map((product) => product.id))
  const operations = [
    ...activeProducts.map((product) => ({ type: 'set', ref: publishedRef(product.id), data: publicSiteProductData(product) })),
    ...publishedProducts.filter((product) => !activeIds.has(product.id)).map((product) => ({ type: 'delete', ref: publishedRef(product.id) })),
  ]
  for (let offset = 0; offset < operations.length; offset += 450) {
    const batch = writeBatch(db)
    for (const operation of operations.slice(offset, offset + 450)) {
      if (operation.type === 'set') batch.set(operation.ref, operation.data)
      else batch.delete(operation.ref)
    }
    await batch.commit()
  }
}

export function saveSiteContent(content, workspaceUid) {
  return setDoc(contentRef, { ...content, workspaceUid, updatedAt: serverTimestamp() }, { merge: true })
}

export async function publishSiteProduct(product) {
  await setDoc(publishedRef(product.id), publicSiteProductData(product))
}

export function unpublishSiteProduct(productId) {
  return deleteDoc(publishedRef(productId))
}
