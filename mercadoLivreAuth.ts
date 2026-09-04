import fs from "fs/promises";
import path from "path";

const TOKEN_FILE = path.join(process.cwd(), "data", "ml-oauth-token.json");

interface StoredToken {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

let cached: StoredToken | null = null;

async function readStoredToken(): Promise<StoredToken | null> {
  if (cached) return cached;
  try {
    const raw = await fs.readFile(TOKEN_FILE, "utf-8");
    cached = JSON.parse(raw);
    return cached;
  } catch {
    return null;
  }
}

async function writeStoredToken(token: StoredToken): Promise<void> {
  cached = token;
  await fs.mkdir(path.dirname(TOKEN_FILE), { recursive: true });
  await fs.writeFile(TOKEN_FILE, JSON.stringify(token, null, 2));
}

async function requestToken(params: Record<string, string>): Promise<StoredToken | null> {
  const response = await fetch("https://api.mercadolibre.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams(params).toString(),
  });

  const bodyText = await response.text();
  if (!response.ok) {
    console.error(`[ml-auth] Falha ao obter/renovar token do Mercado Livre (status ${response.status}): ${bodyText}`);
    return null;
  }

  try {
    const data = JSON.parse(bodyText);
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      // margem de segurança de 60s antes do vencimento real
      expires_at: Date.now() + (data.expires_in - 60) * 1000,
    };
  } catch {
    console.error("[ml-auth] Resposta do /oauth/token não é JSON válido:", bodyText);
    return null;
  }
}

/**
 * Retorna um access_token válido para a API do Mercado Livre, renovando
 * automaticamente via refresh_token quando necessário. Como o Mercado Livre
 * ROTACIONA o refresh_token a cada renovação (o token antigo é invalidado),
 * o token mais recente é persistido em data/ml-oauth-token.json — é ele
 * (não a variável de ambiente ML_REFRESH_TOKEN) que vale depois da primeira
 * renovação.
 *
 * Retorna null se ML_CLIENT_ID/ML_CLIENT_SECRET não estiverem configurados,
 * ou se não houver refresh_token disponível (nem no arquivo, nem em
 * ML_REFRESH_TOKEN) — nesses casos, quem chamar deve cair para outra rota.
 */
export async function getMercadoLivreAccessToken(): Promise<string | null> {
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;

  const stored = await readStoredToken();
  if (stored && stored.expires_at > Date.now()) {
    return stored.access_token;
  }

  const refreshToken = stored?.refresh_token || process.env.ML_REFRESH_TOKEN;
  if (!refreshToken) {
    console.warn(
      "[ml-auth] ML_CLIENT_ID/ML_CLIENT_SECRET configurados, mas não há refresh_token (nem em data/ml-oauth-token.json, nem em ML_REFRESH_TOKEN). Rode ml-get-token.ts para autorizar o app."
    );
    return null;
  }

  const refreshed = await requestToken({
    grant_type: "refresh_token",
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
  });

  if (!refreshed) {
    console.error(
      "[ml-auth] Não foi possível renovar o token do Mercado Livre. O refresh_token pode ter expirado ou sido invalidado — refaça a autorização com ml-get-token.ts."
    );
    return null;
  }

  await writeStoredToken(refreshed);
  return refreshed.access_token;
}
