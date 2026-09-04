import * as cheerio from "cheerio";

// ---------------------------------------------------------------------------
// Extração estruturada do Mercado Livre (script __NORDIC_RENDERING_CTX__)
// ---------------------------------------------------------------------------

/**
 * Extrai o objeto JSON balanceado que começa em `startIndex` (posição de um "{"),
 * respeitando strings/escapes. Mais robusto que heurísticas de regex/split para
 * cortar exatamente onde o objeto termina, independente do que vier depois no script.
 */
export function extractBalancedJson(text: string, startIndex: number): string | null {
  let depth = 0;
  let inString = false;
  let stringChar = "";
  let escaped = false;

  for (let i = startIndex; i < text.length; i++) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === stringChar) {
        inString = false;
      }
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      stringChar = ch;
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return text.slice(startIndex, i + 1);
      }
    }
  }
  return null;
}

/** Encontra `varRegex` (ex.: `_n.ctx.r =`) e faz o parse do objeto JSON atribuído a ela. */
export function extractAssignedJson(scriptText: string, varRegex: RegExp): any | null {
  const match = varRegex.exec(scriptText);
  if (!match) return null;

  const braceIndex = scriptText.indexOf("{", match.index + match[0].length);
  if (braceIndex === -1) return null;

  const jsonStr = extractBalancedJson(scriptText, braceIndex);
  if (!jsonStr) return null;

  try {
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Busca em profundidade (com limite de profundidade e de nós visitados) o primeiro
 * objeto que satisfaça `predicate`. Usado para localizar o `initialState` mesmo que
 * o caminho `appProps.pageProps.initialState` mude, e para achar dados de parcelamento
 * que às vezes vêm aninhados em `subtitles`/`price_breakdown`.
 */
export function deepFind<T = any>(
  obj: any,
  predicate: (o: any) => boolean,
  maxDepth = 6,
  budget: { count: number } = { count: 5000 }
): T | null {
  if (!obj || typeof obj !== "object" || maxDepth < 0 || budget.count <= 0) return null;
  budget.count--;

  if (predicate(obj)) return obj as T;

  const children = Array.isArray(obj) ? obj : Object.values(obj);
  for (const child of children) {
    if (child && typeof child === "object") {
      const found = deepFind<T>(child, predicate, maxDepth - 1, budget);
      if (found) return found;
    }
  }
  return null;
}

const isInitialStateShape = (o: any) => !!(o && o.header && o.price && o.gallery);

export interface MercadoLivreDiagnostics {
  nordicScriptFound: boolean;
  nordicCtxParsed: boolean;
  preloadedStateScriptFound: boolean;
  preloadedStateParsed: boolean;
  initialStateSource: "nordic" | "preloaded_state" | null;
}

/**
 * Localiza o `initialState` da página dentro do HTML.
 * 1) Prioriza o script #__NORDIC_RENDERING_CTX__ (_n.ctx.r = {...}), conforme documentado.
 * 2) Se ausente/inválido, procura um __PRELOADED_STATE__ em qualquer <script>.
 */
export function extractMercadoLivreInitialState(
  $: cheerio.CheerioAPI,
  diagnostics?: MercadoLivreDiagnostics
): any | null {
  const nordicScript = $("#__NORDIC_RENDERING_CTX__").html();
  if (diagnostics) diagnostics.nordicScriptFound = !!nordicScript;

  if (nordicScript) {
    const ctx = extractAssignedJson(nordicScript, /_n\.ctx\.r\s*=\s*/);
    if (diagnostics) diagnostics.nordicCtxParsed = !!ctx;
    if (ctx) {
      const initialState =
        ctx?.appProps?.pageProps?.initialState ?? deepFind(ctx, isInitialStateShape, 8);
      if (initialState) {
        if (diagnostics) diagnostics.initialStateSource = "nordic";
        return initialState;
      }
    }
  }

  // Fallback: window.__PRELOADED_STATE__ (objeto direto ou JSON.parse("..."))
  let preloadedState: any = null;
  $("script").each((_, el) => {
    if (preloadedState) return;
    const content = $(el).html() || "";
    if (!content.includes("PRELOADED_STATE")) return;
    if (diagnostics) diagnostics.preloadedStateScriptFound = true;

    let parsed = extractAssignedJson(content, /__PRELOADED_STATE__\s*=\s*/);
    if (!parsed) {
      const wrapped = /__PRELOADED_STATE__\s*=\s*JSON\.parse\((".*?")\)/s.exec(content);
      if (wrapped) {
        try {
          parsed = JSON.parse(JSON.parse(wrapped[1]));
        } catch {
          parsed = null;
        }
      }
    }

    if (parsed) {
      if (diagnostics) diagnostics.preloadedStateParsed = true;
      preloadedState = parsed?.initialState ?? deepFind(parsed, isInitialStateShape, 8);
      if (preloadedState && diagnostics) diagnostics.initialStateSource = "preloaded_state";
    }
  });

  return preloadedState;
}

export interface MercadoLivreProduct {
  nome: string;
  precos: {
    com_desconto: { valor: number; moeda: string; codigo_moeda: string };
    original: { valor: number; moeda: string; codigo_moeda: string } | null;
    parcelamento: { valor_total: number; valor_parcela: number; numero_parcelas: number; juros: boolean } | null;
    desconto: string | null;
  };
  imagem: { url: string; id: string };
}

/** Monta o produto no formato de saída a partir do `initialState` já localizado. */
export function buildMercadoLivreProduct(initialState: any): MercadoLivreProduct | null {
  const nome = initialState.header?.title || initialState.seo?.title || "";

  // ETAPA 3: preços — campos obrigatórios em initialState.price.price
  const priceData = initialState.price?.price || {};
  const valor = priceData.value || 0;
  const moeda = priceData.currency_symbol || "R$";
  const codigoMoeda = priceData.currency_id || "BRL";

  // Preço original: prioriza price.price.original_value; fallback para price.original_price
  let valorOriginal = priceData.original_value;
  let moedaOriginal = priceData.currency_symbol;
  let codigoMoedaOriginal = priceData.currency_id;
  if (!valorOriginal) {
    const originalPriceData = initialState.price?.original_price;
    if (originalPriceData?.value) {
      valorOriginal = originalPriceData.value;
      moedaOriginal = originalPriceData.currency_symbol || moedaOriginal;
      codigoMoedaOriginal = originalPriceData.currency_id || codigoMoedaOriginal;
    }
  }

  // Parcelamento: normalmente em price.price_installments/installments_amount/total_price,
  // mas também pode estar dentro de price.subtitles ou price.price_breakdown.
  let priceInstallments = initialState.price?.price_installments;
  let installmentsAmount = initialState.price?.installments_amount;
  let totalPrice = initialState.price?.total_price;
  if (!priceInstallments?.value || !installmentsAmount) {
    const found = deepFind<any>(
      initialState.price,
      (o) => !!(o && (o.price_installments?.value || o.installments_amount)),
      4
    );
    if (found) {
      priceInstallments = priceInstallments?.value ? priceInstallments : found.price_installments;
      installmentsAmount = installmentsAmount || found.installments_amount;
      totalPrice = totalPrice || found.total_price;
    }
  }

  const parcelamento =
    priceInstallments?.value && installmentsAmount
      ? {
          valor_total: totalPrice?.value || priceInstallments.value * installmentsAmount,
          valor_parcela: priceInstallments.value,
          numero_parcelas: installmentsAmount,
          juros: totalPrice?.value ? totalPrice.value > valor : false,
        }
      : null;

  const desconto =
    valorOriginal && valorOriginal > valor && valor > 0
      ? `${Math.round((1 - valor / valorOriginal) * 100)}%`
      : null;

  // ETAPA 4: imagem em alta resolução via template_zoom
  let imageUrl = "";
  let imageId = "";
  const gallery = initialState.gallery;
  if (gallery?.picture_config?.template_zoom) {
    const template = gallery.picture_config.template_zoom;
    const pic = gallery.pictures?.[0];
    let sanitizedTitle = pic?.sanitized_title || "";

    if (pic?.id) {
      imageId = pic.id;
    } else if (gallery.previews && typeof gallery.previews === "object") {
      const firstPreview: any = Object.values(gallery.previews)[0];
      if (firstPreview?.id) {
        imageId = firstPreview.id;
        sanitizedTitle = sanitizedTitle || firstPreview.sanitized_title || "";
      }
    }

    if (imageId) {
      imageUrl = template.replace("{id}", imageId).replace("{sanitizedTitle}", sanitizedTitle);
    }
  }

  if (!nome || valor <= 0) return null;

  return {
    nome,
    precos: {
      com_desconto: { valor, moeda, codigo_moeda: codigoMoeda },
      original: valorOriginal
        ? { valor: valorOriginal, moeda: moedaOriginal || "R$", codigo_moeda: codigoMoedaOriginal || "BRL" }
        : null,
      parcelamento,
      desconto,
    },
    imagem: { url: imageUrl, id: imageId },
  };
}
