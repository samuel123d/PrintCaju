# PrintCaju Admin

Painel administrativo da PrintCaju feito com React, Vite e Firebase.

## Executar localmente

Requisitos: Node.js 22.12+ (ou 20.19+) e npm.

```bash
npm install
npm run dev
```

Configure `.env.local` com os valores públicos da aplicação Web Firebase, usando `.env.example` como referência. Nunca coloque credenciais administrativas ou tokens privados no frontend.

O build de produção usa `.env.production`, que contém somente a configuração pública do app Web Firebase para funcionar no Vercel sem variáveis configuradas separadamente. Variáveis de ambiente com os mesmos nomes no Vercel podem substituir esses valores. Nunca coloque credenciais de conta de serviço ou tokens privados nesse arquivo.

## Criar contas e atribuir acesso

O cadastro é feito diretamente no Firebase, sem formulário público no site:

1. Em **Authentication → Sign-in method**, ative **E-mail/senha**.
2. Em **Authentication → Users**, selecione **Add user** e crie a conta com e-mail e senha.
3. Copie o UID da conta.
4. No **Firestore Database → Data**, crie o documento `users/{UID}` (o ID deve ser exatamente o UID).
5. Adicione o campo `role` do tipo string, com valor `admin` para liberar o painel ou `user` para manter a conta sem acesso administrativo.
6. Publique `firestore.rules` em **Firestore Database → Rules**.

A área operacional é compartilhada entre todas as contas `admin`, usando o UID salvo em `_system/owner` como área comum. Os dados atuais ficam no mesmo local `users/{UID do administrador principal}/...`, sem precisar movê-los. Somente administradores acessam vendas, financeiro, produtos, estoque e configurações de pagamento. Perfil e preferências visuais permanecem por conta.

O próprio usuário só consegue ler seu documento de função. As regras impedem alterações de função pelo app. Atribua funções pelo Console Firebase ou por um processo confiável com Admin SDK.

## Segurança

Leia [SECURITY.md](SECURITY.md) para orientações de configuração e publicação segura. A chave Web do Firebase é pública por natureza; restrinja-a aos domínios usados e não inclua chaves de serviço no cliente.

## Build

```bash
npm run build
npm run preview
```

## Publicar no Vercel

Ao importar o repositório no Vercel, use o framework **Vite**, o comando de build `npm run build` e o diretório de saída `dist`. O arquivo `vercel.json` reescreve as rotas do React para `index.html`, permitindo abrir o site institucional em `/` e acessar ou atualizar diretamente as páginas internas.

O repositório inclui `.env.production` com a configuração pública do Firebase Web necessária ao build. Se preferir configurar ou substituir os valores no painel, em **Settings → Environment Variables** use estas variáveis:

- `VITE_FIREBASE_API_KEY`
- `VITE_FIREBASE_AUTH_DOMAIN`
- `VITE_FIREBASE_PROJECT_ID`
- `VITE_FIREBASE_MESSAGING_SENDER_ID`
- `VITE_FIREBASE_APP_ID`
- `VITE_FIREBASE_MEASUREMENT_ID` (opcional)

Use os valores da configuração do app Web em **Firebase Console → Project settings → General**. Depois de salvar alterações no painel, faça um novo deploy. No Firebase Authentication, adicione também o domínio do deploy Vercel aos domínios autorizados. Os valores `VITE_*` são enviados ao navegador; não coloque chaves de serviço ou outros segredos neles.

## Publicar no Firebase Hosting

Para publicar o site e as regras do Firestore, execute na raiz do projeto:

```bash
npm run build
firebase deploy --only hosting,firestore:rules
```

O portal de clientes e os pedidos pelo site usam acesso direto ao Firestore e funcionam no plano Spark; não inclua `functions` nesse deploy. A publicação de Cloud Functions exige o plano Blaze.

Na aba pública **Compras**, o catálogo exibe todos os produtos ativos e sincroniza automaticamente novos produtos, alterações e fotos. Na primeira publicação, entre em **Administração → Site institucional** para inicializar o vínculo da loja com as contas dos clientes e sincronizar os produtos já cadastrados. O catálogo público recebe nome, descrição, categoria, preço, foto e quantidade disponível. O feed Behold da Print Caju já vem configurado e é carregado automaticamente na página inicial, sem sincronização manual; a conexão direta ao Instagram requer Cloud Functions, que exige o plano Blaze.

## Compras no site e e-mails

Os clientes podem adicionar produtos à sacola, criar ou acessar uma conta e enviar uma solicitação de compra. Cada solicitação é gravada como venda do canal **Site institucional**, aguardando confirmação em **Vendas externas**; o estoque só é baixado quando o administrador confirma o pedido. O cliente acompanha o pedido na área da conta e pode abrir a conversa pelo WhatsApp configurado em **Site institucional**.

O Firebase Authentication envia o e-mail de verificação da conta. No fluxo de pedidos pelo site no plano Spark, a solicitação fica visível no portal do cliente e em **Vendas externas** para confirmação administrativa; não é enviado um e-mail de confirmação do pedido automaticamente.

Para personalizar os e-mails de verificação do Firebase Authentication, configure o nome do remetente e o modelo em **Firebase Console → Authentication → Templates**. O link de verificação volta para a tela da Print Caju com a identidade visual; o domínio do site também precisa estar autorizado em **Authentication → Settings → Authorized domains**.

## Cadastro manual de produtos e vendas

Por enquanto, a integração com o Mercado Livre está desativada na interface. Cadastre os produtos em **Produtos → Novo produto**, escolhendo o grupo **Vendas online (manual)** ou **Físicos**. Informe nome, custo, preço e saldo inicial; o SKU de produtos físicos é gerado automaticamente ao salvar. Produtos online podem receber um código manual. Ajustes posteriores de estoque ficam na área **Estoque**. Produtos arquivados ficam na aba **Arquivados** em Produtos; é possível excluí-los permanentemente do cadastro por essa lista. A exclusão remove o cadastro, mas preserva os históricos de vendas e movimentações de estoque.

Registre vendas externas feitas por WhatsApp, Instagram, presencialmente ou por outro canal em **Vendas externas**. A integração com marketplaces está pausada; os registros antigos continuam no histórico.

## Materiais, ficha técnica e preço sugerido

Todas as compras são registradas em **Financeiro → Estoque de materiais**, junto com despesas e histórico financeiro. Informe quantidade, unidade e valor total. O sistema converte kg para g, L para ml e mm/cm para m, calcula o custo médio na unidade base e lança a compra como despesa. Para materiais vendidos por área, selecione “unidade por largura × comprimento”, informe a quantidade de rolos/placas e suas dimensões em mm, cm ou m; o estoque e o custo serão calculados em m². Para repor um insumo, selecione o material já cadastrado; não crie outro item para a mesma matéria-prima.

Compras antigas ainda não vinculadas ao estoque podem ser integradas pelo **Histórico de lançamentos**: nas despesas das categorias **Materiais e insumos** ou **Embalagens**, escolha **Incluir no estoque**, informe a quantidade e a unidade e selecione um material existente ou cadastre um novo. O sistema usa o valor e a data do lançamento original, atualiza o estoque e o custo médio sem criar uma segunda despesa. Faça isso apenas para compras reais de produtos ou insumos; contas, serviços e taxas não são estoque.

No **Estoque**, use **Editar estoque** para corrigir a quantidade física e o mínimo de um material. No **Histórico de lançamentos**, use **Editar quantidade** em uma compra vinculada para corrigir a quantidade/unidade da compra; o estoque e o custo médio são recalculados sem duplicar a despesa. Uma correção que deixaria o saldo negativo é recusada.

Em **Produtos → Novo produto**, cadastre o filamento em **Financeiro → Estoque de materiais** com unidade em gramas (pode comprar em kg; o sistema converte). No produto, selecione o filamento, informe os gramas usados por peça e o tempo de impressão; o custo do filamento e a energia entram automaticamente no custo e no preço sugerido. A margem sugerida começa em 50%, pode ser ajustada sem limite máximo e é aplicada como percentual sobre o custo; as taxas são consideradas separadamente no preço sugerido. Use a ficha técnica para manter embalagem, chaveiro e outros materiais já cadastrados no custo por peça. Para materiais em m², informe largura e comprimento da peça em mm, cm ou m. A fila de **Produção** multiplica o tempo e a energia do produto pela quantidade do pedido. Mão de obra pode ser calculada por horas × valor/hora. O preço continua editável e o estoque de insumos não é baixado automaticamente ao registrar vendas.

## Orçamentos e comprovantes comerciais

Em **Vendas e orçamentos**, crie uma proposta com produtos do catálogo ou descrições manuais, cliente, validade, entrega, desconto e observações. Orçamentos ficam salvos e podem ser impressos ou convertidos em venda; a conversão usa os dados dos itens e evita converter a mesma proposta duas vezes. Vendas e pedidos podem ser cancelados sem apagar o histórico ou excluídos permanentemente. Orçamentos abertos também podem ser cancelados; excluir um orçamento convertido não apaga a venda nem seu comprovante. O comprovante é parte do registro da venda: cancelar a venda o preserva no histórico, mas deixa de oferecê-lo para impressão; excluir a venda remove o registro e o comprovante do Firestore.

Na aba **Clientes**, cadastre e edite nome, CPF/CNPJ, telefone, e-mail e endereço. Clique no nome de um cliente ou em **Histórico** para consultar pedidos/vendas, situação de entrega e pagamento e orçamentos. Ao registrar uma venda ou orçamento, escolha um cliente salvo para preencher os dados automaticamente; clientes informados manualmente também são salvos para reutilização. O sistema procura evitar duplicatas usando CPF/CNPJ, telefone ou e-mail, nessa ordem, e mantém uma cópia dos dados no próprio documento da venda ou orçamento.

Preencha nome/razão social e contatos em **Configurações → Dados da empresa**. Na mesma seção, personalize os títulos, textos de apresentação e rodapés de orçamento/comprovante e escolha quais informações e blocos (contatos, resumo de venda, prazo e assinaturas) serão impressos. Os documentos usam os dados atuais da empresa configurados ali e a logo Print Caju; a impressão do navegador permite salvar como PDF. CPF/CNPJ da empresa e CPF do cliente são opcionais. Orçamentos e comprovantes são documentos comerciais e não substituem documento fiscal obrigatório. Publique `firestore.rules` depois de atualizar as regras de acesso a `settings/business`.

## Agenda e Google Agenda

Conecte o Google Agenda para enviar os itens criados neste sistema ao calendário. A sincronização é somente de saída: eventos criados ou alterados diretamente no Google não são importados. Na lista, selecione um ou mais itens (ou use **Selecionar visíveis**) e exclua todos de uma vez; os eventos vinculados também serão removidos do Google, assim que houver conexão.
