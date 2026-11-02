import { Bytes, deleteField, doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore'
import { sendPasswordResetEmail, updateProfile, verifyBeforeUpdateEmail } from 'firebase/auth'
import { auth, db } from '../firebase/config.js'

const MAX_PROFILE_PHOTO_BYTES = 400 * 1024

export const DEFAULT_PREFERENCES = {
  accentColor: '#FF8A00',
  fontScale: 'normal',
  dailyDueAlertsEnabled: true,
  dueAlertDays: 3,
  lowStockAlertsEnabled: true,
  desktopNotificationsEnabled: false,
  businessName: 'Print Caju',
  weeklySalesGoal: 1250,
  monthlySalesGoal: 5000,
  annualSalesGoal: 60000,
}

export const DEFAULT_BUSINESS_DETAILS = {
  name: 'Print Caju',
  taxId: '',
  phone: '',
  email: '',
  address: '',
  city: '',
  state: '',
  postalCode: '',
  quoteTitle: 'ORÇAMENTO',
  quoteIntro: '',
  quoteFooter: '',
  receiptTitle: 'COMPROVANTE DE VENDA',
  receiptFooter: '',
  showCompanyDetails: true,
  showCustomerTaxId: true,
  showCustomerContact: true,
  showSalesChannel: true,
  showPaymentDetails: true,
  showDeliveryDetails: true,
  showDocumentSignatures: true,
}

const preferencesRef = (uid) => doc(db, 'users', uid, 'settings', 'preferences')
const profileRef = (uid) => doc(db, 'users', uid, 'settings', 'profile')
const businessDetailsRef = (uid) => doc(db, 'users', uid, 'settings', 'business')

export function watchPreferences(uid, onValue, onError) {
  return onSnapshot(preferencesRef(uid), (snapshot) => onValue({ ...DEFAULT_PREFERENCES, ...(snapshot.exists() ? snapshot.data() : {}) }), onError)
}

export function watchProfile(uid, onValue, onError) {
  return onSnapshot(profileRef(uid), (snapshot) => onValue(snapshot.exists() ? snapshot.data() : {}), onError)
}

export function savePreferences(uid, preferences) {
  return setDoc(preferencesRef(uid), { ...preferences, updatedAt: serverTimestamp() }, { merge: true })
}

export function watchBusinessDetails(uid, onValue, onError) {
  return onSnapshot(businessDetailsRef(uid), (snapshot) => onValue({ ...DEFAULT_BUSINESS_DETAILS, ...(snapshot.exists() ? snapshot.data() : {}) }), onError)
}

export function saveBusinessDetails(uid, details) {
  return setDoc(businessDetailsRef(uid), { ...details, updatedAt: serverTimestamp() }, { merge: true })
}

export async function saveProfile(uid, { displayName }) {
  const saved = await setDoc(profileRef(uid), { displayName, photoURL: deleteField(), updatedAt: serverTimestamp() }, { merge: true })
  if (auth.currentUser?.uid === uid && auth.currentUser.displayName !== displayName) {
    try { await updateProfile(auth.currentUser, { displayName }) }
    catch (cause) { console.warn('O perfil foi salvo, mas o nome do Firebase Authentication não foi atualizado.', cause) }
  }
  return saved
}

export function changeAccountEmail(newEmail) {
  if (!auth.currentUser) throw new Error('Faça login novamente para continuar.')
  return verifyBeforeUpdateEmail(auth.currentUser, newEmail)
}

export function requestPasswordReset(email) {
  return sendPasswordResetEmail(auth, email)
}

export async function saveProfilePhoto(uid, file) {
  if (file.size > MAX_PROFILE_PHOTO_BYTES) {
    throw new Error('A foto otimizada excedeu 400 KB. Escolha outra imagem ou tente novamente.')
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  return setDoc(profileRef(uid), {
    photoBytes: Bytes.fromUint8Array(bytes),
    photoContentType: file.type,
    photoURL: deleteField(),
    updatedAt: serverTimestamp(),
  }, { merge: true })
}

export function clearProfilePhoto(uid) {
  return setDoc(profileRef(uid), {
    photoBytes: deleteField(),
    photoContentType: deleteField(),
    photoURL: deleteField(),
    updatedAt: serverTimestamp(),
  }, { merge: true })
}
