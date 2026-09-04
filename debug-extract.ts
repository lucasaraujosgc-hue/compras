/**
 * Script de diagnóstico standalone: testa a extração de um link do Mercado Livre
 * sem passar pela UI, mostrando exatamente onde a extração falha (fetch bloqueado,
 * script não encontrado, JSON não parseado, campos faltando, etc.).
 *
 * Uso:
 *   bunx tsx debug-extract.ts "https://produto.mercadolivre.com.br/MLB-..."
 *   (ou: npx tsx debug-extract.ts "...")
 */
import * as cheerio from "cheerio";
import fs from "fs";
import {
  extractMercadoLivreInitialState,
  buildMercadoLivreProduct,
  type MercadoLivreDiagnostics,
} from "./mercadoLivreExtractor";
import { extractMercadoLivreItemId, isMercadoLivreUrl, fetchMercadoLivreProductViaApi } from "./mercadoLivreApi";

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Uso: bunx tsx debug-extract.ts "<url do produto>"');
    process.exit(1);
  }

  // ROTA 0: API oficial do Mercado Livre (não depende de renderizar a página).
  if (isMercadoLivreUrl(url)) {
    const itemId = extractMercadoLivreItemId(url);
    console.log(`\n>> URL do Mercado Livre detectada. ID extraído: ${itemId ?? "NENHUM"}`);
    if (itemId) {
      console.log(`>> Consultando https://api.mercadolibre.com/items/${itemId} ...`);
      try {
        const produto = await fetchMercadoLivreProductViaApi(itemId);
        if (produto) {
          console.log("\n>> SUCESSO via API oficial! Produto extraído:\n");
          console.log(JSON.stringify({ produto }, null, 2));
          console.log("\n(Pulando a rota de scraping HTML, pois a API já retornou os dados.)\n");
          return;
        }
        console.warn(">> API respondeu mas sem dados suficientes (título/preço). Tentando via HTML...\n");
      } catch (e) {
        console.error(">> Erro ao consultar a API oficial:", e, "\n   Tentando via HTML...\n");
      }
    }
  }

  console.log(`\n>> ROTA HTML — Buscando: ${url}\n`);

  const response = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      "Sec-Fetch-Mode": "navigate",
      "Sec-Fetch-Site": "none",
      "Sec-Fetch-User": "?1",
      "Sec-Fetch-Dest": "document",
      "Upgrade-Insecure-Requests": "1",
    },
  });

  console.log(`Status HTTP: ${response.status} ${response.statusText}`);
  console.log(`URL final (após redirects): ${response.url}`);

  const html = await response.text();
  console.log(`Tamanho do HTML: ${html.length} bytes`);

  const htmlPath = "/tmp/debug-extract-output.html";
  fs.writeFileSync(htmlPath, html);
  console.log(`HTML bruto salvo em: ${htmlPath}\n`);

  if (!response.ok) {
    console.error(`>> Fetch falhou com status ${response.status}. O site pode estar bloqueando o servidor.`);
    return;
  }

  const $ = cheerio.load(html);

  const pageTitle = $("title").text();
  const ogTitle = $('meta[property="og:title"]').attr("content") || "";
  const ogImage = $('meta[property="og:image"]').attr("content") || "";
  console.log(`<title>: ${JSON.stringify(pageTitle)}`);
  console.log(`og:title: ${JSON.stringify(ogTitle)}`);
  console.log(`og:image: ${JSON.stringify(ogImage)}\n`);

  // Sinais comuns de página de bloqueio/verificação anti-robô
  const suspiciousMarkers = [
    "captcha",
    "recaptcha",
    "unusual traffic",
    "tráfego incomum",
    "verifique que você não é um robô",
    "access denied",
    "acesso negado",
    "blocked",
  ];
  const lowerHtml = html.toLowerCase();
  const foundMarkers = suspiciousMarkers.filter((m) => lowerHtml.includes(m));
  if (foundMarkers.length > 0) {
    console.warn(`>> ATENÇÃO: sinais de bloqueio/anti-robô encontrados no HTML: ${foundMarkers.join(", ")}\n`);
  }

  const diagnostics: MercadoLivreDiagnostics = {
    nordicScriptFound: false,
    nordicCtxParsed: false,
    preloadedStateScriptFound: false,
    preloadedStateParsed: false,
    initialStateSource: null,
  };

  const initialState = extractMercadoLivreInitialState($, diagnostics);

  console.log("Diagnóstico da extração estruturada:");
  console.log(`  #__NORDIC_RENDERING_CTX__ encontrado: ${diagnostics.nordicScriptFound}`);
  console.log(`  _n.ctx.r parseado com sucesso: ${diagnostics.nordicCtxParsed}`);
  console.log(`  script com __PRELOADED_STATE__ encontrado: ${diagnostics.preloadedStateScriptFound}`);
  console.log(`  __PRELOADED_STATE__ parseado com sucesso: ${diagnostics.preloadedStateParsed}`);
  console.log(`  initialState localizado via: ${diagnostics.initialStateSource ?? "NENHUM"}\n`);

  if (!initialState) {
    console.error(
      ">> FALHA: nenhum initialState foi encontrado. A página recebida provavelmente não é a página real do produto\n" +
        "   (ex.: página de verificação anti-robô, captcha, ou redirecionamento). Confira o HTML salvo em " +
        htmlPath +
        "."
    );
    return;
  }

  console.log(">> initialState encontrado. Chaves de topo:", Object.keys(initialState));

  const produto = buildMercadoLivreProduct(initialState);
  if (!produto) {
    console.error(
      ">> FALHA: initialState foi encontrado, mas faltou nome ou preço (> 0) para montar o produto.\n" +
        "   header.title:",
      initialState.header?.title,
      "\n   seo.title:",
      initialState.seo?.title,
      "\n   price.price:",
      JSON.stringify(initialState.price?.price)
    );
    return;
  }

  console.log("\n>> SUCESSO! Produto extraído:\n");
  console.log(JSON.stringify({ produto }, null, 2));
}

main().catch((err) => {
  console.error("Erro inesperado:", err);
  process.exit(1);
});
