# Google Forms â†’ Print Caju

This Apps Script syncs each new response in the linked Google Sheets response tab into `users/{workspaceUid}/clients/{clientId}` in Firestore. It uses the Google account's OAuth token and Firestore REST API, so it does not require deploying Firebase Functions.

## Setup

1. Open the linked Google Sheets response spreadsheet and choose **Extensions â†’ Apps Script**.
2. Replace the starter script with `.apps-script/PrintCajuSync.gs`.
3. In Apps Script **Project Settings**, enable **Show `appsscript.json` manifest file** and replace the manifest with `.apps-script/appsscript.json`.
4. In **Project Settings â†’ Script Properties**, add `PRINTCAJU_WORKSPACE_UID` with the UID of the admin account that owns the Print Caju workspace. If the Firestore document `_system/owner` exists and the script account can read it, the script finds this UID automatically.
5. The Google account that owns the script needs Firestore IAM access to read the workspace owner and create/update documents. A project administrator can grant the account `roles/datastore.user` in Google Cloud IAM. This role grants database access beyond this form, so use a dedicated Google account if possible.
6. Select `installPrintCajuTrigger` in the Apps Script function menu and click **Run** once. Approve the requested Sheets, external request, and Firestore scopes. The installable trigger then runs after each form submission.
7. Submit one test response and confirm a new client appears in Print Caju.

After updating the script, run `syncExistingFormResponses` once from the response sheet to apply the corrected email-first matching to previous responses. If a customer account is already open, use **Atualizar cadastro e pedidos** in the customer portal after the sync completes.

The script recognizes common Portuguese column titles for name, CPF/CNPJ, phone/WhatsApp, e-mail, address, city, state, and CEP. Name and either phone or e-mail are required. It hashes CPF, e-mail, or phone into a stable Firestore document ID (in that order) so repeat submissions with the same identity update that client instead of adding another one.

Google Apps Script and Firestore have usage quotas and limits; this avoids the Firebase Functions Blaze deployment requirement but is not an unlimited service. The Google Forms response stays in the response spreadsheet as well.
