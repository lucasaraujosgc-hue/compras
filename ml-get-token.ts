/**
 * Passo único (manual) para autorizar o app do Mercado Livre e obter o
 * primeiro refresh_token. Depois disso, o servidor renova o access_token
 * sozinho (veja mercadoLivreAuth.ts) — você não precisa rodar isso de novo,
 * a menos que o refresh_token seja revogado/expire.
 *
 * PASSO A PASSO:
 *
 * 1. Crie um app em https://developers.mercadolivre.com.br/ (menu "Minhas
 *    aplicações" → "Criar aplicação"). Anote o Client ID e o Client Secret.
 *    Em "Redirect URI" (URI de redirecionamento), informe qualquer URL HTTPS
 *    que você controle (ex.: um domínio seu, ou até algo como
 *    https://www.google.com — você só vai copiar o "code" da barra de
 *    endereço depois do redirect, não precisa haver nada rodando lá).
 *
 * 2. Visite esta URL no navegador (troque CLIENT_ID e REDIRECT_URI pelos
 *    seus valores, mantendo o resto igual):
 *
 *    https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=CLIENT_ID&redirect_uri=REDIRECT_URI
 *
 *    Faça login com sua conta do Mercado Livre e clique em "Autorizar".
 *
 * 3. Você será redirecionado para REDIRECT_URI?code=XXXXXXXXX — copie o
 *    valor de "code" da barra de endereço (ele expira em poucos minutos,
 *    então já parta para o passo 4).
 *
 * 4. Rode este script:
 *
 *    bunx tsx ml-get-token.ts <client_id> <client_secret> <redirect_uri> <code>
 *    (ou: npx tsx ml-get-token.ts <client_id> <client_secret> <redirect_uri> <code>)
 *
 * 5. O script salva o token em data/ml-oauth-token.json e imprime as duas
 *    variáveis para você colocar no seu .env (ML_CLIENT_ID e
 *    ML_CLIENT_SECRET — o refresh_token fica só no arquivo, e é renovado
 *    automaticamente a partir daí). Reinicie o servidor depois.
 */
import fs from "fs/promises";
import path from "path";

async function main() {
  const [clientId, clientSecret, redirectUri, code] = process.argv.slice(2);
  if (!clientId || !clientSecret || !redirectUri || !code) {
    console.error("Uso: bunx tsx ml-get-token.ts <client_id> <client_secret> <redirect_uri> <code>");
    console.error("Veja o passo a passo no topo deste arquivo (ml-get-token.ts).");
    process.exit(1);
  }

  console.log("\n>> Trocando o code por um access_token/refresh_token...\n");

  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    console.error(`>> Falha (status ${response.status}):\n${bodyText}\n`);
    console.error(
      "Motivos comuns: o 'code' já expirou (peça um novo repetindo o passo 2/3) ou o redirect_uri não é exatamente igual ao cadastrado no app."
    );
    process.exit(1);
  }

  const data = JSON.parse(bodyText);
  const tokenFile = path.join(process.cwd(), "data", "ml-oauth-token.json");
  await fs.mkdir(path.dirname(tokenFile), { recursive: true });
  await fs.writeFile(
    tokenFile,
    JSON.stringify(
      {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: Date.now() + (data.expires_in - 60) * 1000,
      },
      null,
      2
    )
  );

  console.log(`>> Token salvo em ${tokenFile}\n`);
  console.log("Adicione estas duas variáveis no seu .env e reinicie o servidor:\n");
  console.log(`ML_CLIENT_ID=${clientId}`);
  console.log(`ML_CLIENT_SECRET=${clientSecret}`);
  console.log(
    "\n(O refresh_token não precisa ir no .env — já está salvo no arquivo acima, e o servidor cuida de renová-lo sozinho.)\n"
  );
}

main().catch((err) => {
  console.error("Erro inesperado:", err);
  process.exit(1);
});
