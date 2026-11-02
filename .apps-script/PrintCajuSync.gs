/**
 * Sync Google Forms submissions from the linked response Sheet to Print Caju.
 * Bind this script to the response spreadsheet and install an onFormSubmit trigger.
 */
const PRINTCAJU_PROJECT_ID = 'sistema-de-controle-de'

function installPrintCajuTrigger() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet()
  if (!spreadsheet) throw new Error('Abra este script pela planilha de respostas do Forms.')
  const alreadyInstalled = ScriptApp.getProjectTriggers().some((trigger) =>
    trigger.getHandlerFunction() === 'onPrintCajuFormSubmit' && trigger.getEventType() === ScriptApp.EventType.ON_FORM_SUBMIT)
  if (!alreadyInstalled) {
    ScriptApp.newTrigger('onPrintCajuFormSubmit').forSpreadsheet(spreadsheet).onFormSubmit().create()
  }
}

function syncExistingFormResponses() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet()?.getActiveSheet()
  if (!sheet) throw new Error('Abra a aba de respostas do Forms antes de executar a importação inicial.')
  const values = sheet.getDataRange().getValues()
  if (values.length < 2) throw new Error('A planilha ainda não tem respostas para importar.')
  const headers = values[0].map((header) => String(header || '').trim())
  let imported = 0
  for (let index = 1; index < values.length; index += 1) {
    if (values[index].every((value) => value === '' || value == null)) continue
    const namedValues = Object.fromEntries(headers.map((header, column) => [header, [values[index][column]]]))
    try {
      onPrintCajuFormSubmit({ namedValues, range: sheet.getRange(index + 1, 1) })
      imported += 1
    } catch (error) {
      throw new Error(`Falha na linha ${index + 1}: ${error.message}`)
    }
  }
  console.log(`${imported} resposta(s) foram sincronizadas com o Print Caju.`)
}

function onPrintCajuFormSubmit(event) {
  if (!event || !event.namedValues || !event.range) throw new Error('Evento de envio inválido. Execute pelo gatilho da planilha.')
  const answers = event.namedValues
  const contactAnswer = answer(answers, ['contato', 'forma de contato', 'telefone para contato'])
  const locationAnswer = answer(answers, ['localização', 'localizacao', 'cidade e estado', 'cidade/estado', 'onde você mora', 'onde mora'])
  const cityAnswer = answer(answers, ['cidade', 'município'])
  const stateAnswer = answer(answers, ['estado', 'uf'])
  const parsedLocation = splitLocation(locationAnswer)
  const profile = {
    name: answer(answers, ['nome completo', 'nome', 'nome do cliente', 'seu nome']),
    taxId: answer(answers, ['cpf/cnpj', 'cpf', 'cnpj', 'documento']),
    phone: answer(answers, ['whatsapp', 'telefone', 'celular', 'numero de telefone', 'numero do telefone', 'numero para contato', 'telefone com ddd', 'whatsapp com ddd']) || (contactAnswer.includes('@') ? '' : contactAnswer),
    email: answer(answers, ['e-mail', 'email', 'seu email', 'seu e-mail']) || (contactAnswer.includes('@') ? contactAnswer : ''),
    address: answer(answers, ['endereco', 'endereco completo', 'rua e numero', 'logradouro', 'endereco de entrega', 'rua']),
    city: cityAnswer || parsedLocation.city,
    state: stateAnswer || parsedLocation.state,
    postalCode: answer(answers, ['cep', 'codigo postal']),
  }
  if (!profile.name) throw new Error('Não encontrei a pergunta de nome na planilha. Confira os títulos das colunas.')
  if (!profile.phone && !profile.email) throw new Error('A resposta precisa ter telefone ou e-mail para identificar o cliente.')

  const workspaceUid = getWorkspaceUid()
  const existingClient = findExistingClient(workspaceUid, profile)
  const identity = digits(profile.taxId) || profile.email.toLowerCase() || digits(profile.phone) || `${event.range.getSheet().getSheetId()}-${event.range.getRow()}`
  const clientId = existingClient ? existingClient.name.split('/').pop() : sha256Hex(identity).slice(0, 40)
  const now = new Date().toISOString()
  const client = {
    name: profile.name,
    taxId: profile.taxId,
    taxIdDigits: digits(profile.taxId),
    phone: profile.phone,
    phoneDigits: digits(profile.phone),
    email: profile.email,
    emailNormalized: profile.email.toLowerCase(),
    address: profile.address,
    city: profile.city,
    state: profile.state.toUpperCase(),
    postalCode: profile.postalCode,
    registrationSource: 'google-forms',
    createdAt: { timestampValue: now },
    updatedAt: { timestampValue: now },
  }

  const documentName = existingClient?.name || `projects/${PRINTCAJU_PROJECT_ID}/databases/(default)/documents/users/${workspaceUid}/clients/${clientId}`
  const fields = { ...(existingClient?.fields || {}) }
  Object.entries(client).forEach(([key, value]) => {
    if (key === 'createdAt' && fields.createdAt) return
    if (typeof value === 'string' && !value && fields[key]) return
    fields[key] = firestoreValue(value)
  })
  const response = UrlFetchApp.fetch(`https://firestore.googleapis.com/v1/projects/${PRINTCAJU_PROJECT_ID}/databases/(default)/documents:commit`, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` },
    payload: JSON.stringify({ writes: [{ update: { name: documentName, fields } }] }),
    muteHttpExceptions: true,
  })
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error(`Firestore recusou o cadastro (${response.getResponseCode()}): ${response.getContentText().slice(0, 500)}`)
  }
}

function findExistingClient(workspaceUid, profile) {
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${PRINTCAJU_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(workspaceUid)}/clients`
  let pageToken = ''
  const candidates = []
  do {
    const url = `${baseUrl}?pageSize=1000${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    const response = UrlFetchApp.fetch(url, { headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }, muteHttpExceptions: true })
    if (response.getResponseCode() !== 200) throw new Error(`Não foi possível procurar clientes existentes (${response.getResponseCode()}): ${response.getContentText().slice(0, 300)}`)
    const page = JSON.parse(response.getContentText())
    candidates.push(...(page.documents || []))
    pageToken = page.nextPageToken || ''
  } while (pageToken)

  const taxId = digits(profile.taxId)
  const phone = digits(profile.phone)
  const email = profile.email.toLowerCase()
  const matches = candidates.filter((document) => {
    const fields = document.fields || {}
    const existingTaxId = fieldString(fields.taxIdDigits) || digits(fieldString(fields.taxId))
    const existingPhone = fieldString(fields.phoneDigits) || digits(fieldString(fields.phone))
    const existingEmail = fieldString(fields.emailNormalized || fields.email).toLowerCase()
    return (taxId && existingTaxId === taxId) || (phone && existingPhone === phone) || (email && existingEmail === email)
  })
  if (matches.length <= 1) return matches[0] || null

  const salesUrl = `https://firestore.googleapis.com/v1/projects/${PRINTCAJU_PROJECT_ID}/databases/(default)/documents/users/${encodeURIComponent(workspaceUid)}/externalSales?pageSize=1000`
  const salesResponse = UrlFetchApp.fetch(salesUrl, { headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }, muteHttpExceptions: true })
  if (salesResponse.getResponseCode() === 200) {
    const linkedClientIds = new Set((JSON.parse(salesResponse.getContentText()).documents || [])
      .map((sale) => fieldString(sale.fields?.clientId)).filter(Boolean))
    const linkedMatch = matches.find((document) => linkedClientIds.has(document.name.split('/').pop()))
    if (linkedMatch) return linkedMatch
  }
  return matches[0]
}

function fieldString(value) { return value?.stringValue || '' }

function getWorkspaceUid() {
  const configuredUid = PropertiesService.getScriptProperties().getProperty('PRINTCAJU_WORKSPACE_UID')
  if (configuredUid) return configuredUid
  const url = `https://firestore.googleapis.com/v1/projects/${PRINTCAJU_PROJECT_ID}/databases/(default)/documents/_system/owner`
  const response = UrlFetchApp.fetch(url, { headers: { Authorization: `Bearer ${ScriptApp.getOAuthToken()}` }, muteHttpExceptions: true })
  if (response.getResponseCode() === 200) {
    const uid = JSON.parse(response.getContentText()).fields?.uid?.stringValue
    if (uid) return uid
  }
  throw new Error('Configure a propriedade PRINTCAJU_WORKSPACE_UID no Apps Script com o UID do administrador do Print Caju.')
}

function answer(namedValues, aliases) {
  const entries = Object.entries(namedValues)
  const wanted = aliases.map(normalize)
  const match = entries.find(([question]) => {
    const key = normalize(question)
    return wanted.some((alias) => key === alias || key.includes(alias))
  })
  return match ? String(match[1]?.[0] || '').trim().slice(0, 500) : ''
}

function normalize(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

function digits(value) { return String(value || '').replace(/\D/g, '') }

function splitLocation(value) {
  const match = String(value || '').trim().match(/^(.+?)[,\-/]\s*([A-Za-z]{2})$/)
  return match ? { city: match[1].trim(), state: match[2].toUpperCase() } : { city: String(value || '').trim(), state: '' }
}

function sha256Hex(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8)
    .map((byte) => (byte & 255).toString(16).padStart(2, '0')).join('')
}

function firestoreValue(value) {
  if (value && typeof value === 'object' && value.timestampValue) return value
  return { stringValue: String(value ?? '') }
}
