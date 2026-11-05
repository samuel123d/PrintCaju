# Sincronizar todas as publicações do Instagram

O painel **Administração → Site institucional** usa a Instagram API oficial para importar as publicações e Reels disponíveis em `@printcaju`, percorrendo todas as páginas retornadas pela API. O site exibe a lista completa na seção de Instagram. Stories e conteúdo que a API não disponibiliza para a conta não podem ser importados.

## Configuração inicial

1. No Meta for Developers, configure um app com **Instagram API** e **Instagram Login** para a conta profissional `@printcaju`.
2. Cadastre este URI de redirecionamento: `https://sistema-de-controle-de.web.app/instagram/callback`.
3. Configure o App ID e o App Secret no Firebase Functions. O App Secret deve ser informado no prompt seguro, nunca no site, no Git ou no chat:

   ```powershell
   firebase use sistema-de-controle-de
   firebase functions:secrets:set IG_APP_SECRET
   ```

4. Publique as regras, o endpoint OAuth e a sincronização:

   ```powershell
   firebase deploy --only firestore:rules,functions:startInstagramConnection,functions:instagramCallback,functions:syncInstagramPosts,functions:getInstagramConnection,functions:submitWebsiteCustomerRegistration,hosting
   ```

   No primeiro deploy, informe o `IG_APP_ID` quando o Firebase solicitar o parâmetro.

5. Entre como administrador, abra **Site institucional**, clique em **Conectar @printcaju** e autorize a conta.
6. Clique em **Sincronizar todas as publicações**. O painel informa quantos posts e Reels foram copiados. Repita a sincronização para atualizar o site quando houver novas publicações.

O feed Behold `R9x0OkdwtIceyUI4rfzB` já é carregado automaticamente no site como alternativa; não é necessário conectar a conta nem sincronizar as publicações pelo painel. A quantidade de itens exibidos continua sujeita ao conteúdo e às opções de exibição configuradas no próprio feed Behold.
