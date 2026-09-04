import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import fs from "fs/promises";

const DB_FILE = path.join(process.cwd(), "data", "db.json");

// ---------------------------------------------------------------------------
// Extração estruturada do Mercado Livre (script __NORDIC_RENDERING_CTX__)
// ---------------------------------------------------------------------------

/**
 * Extrai o objeto JSON balanceado que começa em `startIndex` (posição de um "{"),
 * respeitando strings/escapes. Mais robusto que heurísticas de regex/split para
 * cortar exatamente onde o objeto termina, independente do que vier depois no script.
 */
function extractBalancedJson(text: string, startIndex: number): string | null {
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
function extractAssignedJson(scriptText: string, varRegex: RegExp): any | null {
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
function deepFind<T = any>(
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

/**
 * Localiza o `initialState` da página dentro do HTML.
 * 1) Prioriza o script #__NORDIC_RENDERING_CTX__ (_n.ctx.r = {...}), conforme documentado.
 * 2) Se ausente/inválido, procura um __PRELOADED_STATE__ em qualquer <script>.
 */
function extractMercadoLivreInitialState($: cheerio.CheerioAPI): any | null {
  const nordicScript = $("#__NORDIC_RENDERING_CTX__").html();
  if (nordicScript) {
    const ctx = extractAssignedJson(nordicScript, /_n\.ctx\.r\s*=\s*/);
    if (ctx) {
      const initialState =
        ctx?.appProps?.pageProps?.initialState ?? deepFind(ctx, isInitialStateShape, 8);
      if (initialState) return initialState;
    }
  }

  // Fallback: window.__PRELOADED_STATE__ (objeto direto ou JSON.parse("..."))
  let preloadedState: any = null;
  $("script").each((_, el) => {
    if (preloadedState) return;
    const content = $(el).html() || "";
    if (!content.includes("PRELOADED_STATE")) return;

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
      preloadedState = parsed?.initialState ?? deepFind(parsed, isInitialStateShape, 8);
    }
  });

  return preloadedState;
}

interface MercadoLivreProduct {
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
function buildMercadoLivreProduct(initialState: any): MercadoLivreProduct | null {
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

async function initDB() {
  try {
    await fs.mkdir(path.dirname(DB_FILE), { recursive: true });
    try {
      await fs.access(DB_FILE);
    } catch {
      await fs.writeFile(
        DB_FILE,
        JSON.stringify({
          items: [],
          categories: ["Geral", "Casa", "Roupas", "Jogos", "Eletrônicos"],
        })
      );
    }
  } catch (e) {
    console.error("Failed to init DB", e);
  }
}

async function startServer() {
  await initDB();
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.get("/api/state", async (req, res) => {
    try {
      const data = await fs.readFile(DB_FILE, "utf-8");
      res.json(JSON.parse(data));
    } catch (e) {
      res.status(500).json({ error: "Failed to read state" });
    }
  });

  app.post("/api/state", async (req, res) => {
    try {
      await fs.writeFile(DB_FILE, JSON.stringify(req.body, null, 2));
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: "Failed to save state" });
    }
  });

  app.post("/api/extract", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // 1. TENTATIVA DE EXTRAÇÃO DIRETA SEM IA (MERCADO LIVRE E OUTROS VIA SCRIPT)
      try {
        const initialState = extractMercadoLivreInitialState($);
        if (initialState) {
          const produto = buildMercadoLivreProduct(initialState);
          if (produto) {
            return res.json({ produto });
          }
        }
      } catch (e) {
        console.error("Erro ao fazer parse do NORDIC_RENDERING_CTX/PRELOADED_STATE", e);
      }

      // FALLBACK 2: Se não for ML ou falhou, extrair OG tags básicas
      const ogImage = $('meta[property="og:image"]').attr("content") 
        || $('meta[name="twitter:image"]').attr("content")
        || $('link[rel="image_src"]').attr("href")
        || "";
        
      const ogTitle = $('meta[property="og:title"]').attr("content") || $("title").text() || "";
      
      // Clean up HTML to reduce token usage
      $("script, style, noscript, iframe, svg, path").remove();
      const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 30000);

      const schema: Schema = {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING, description: "The name of the product" },
          price: { type: Type.NUMBER, description: "The current selling price of the product as a number (e.g., 1500.50)." },
          imageUrl: { type: Type.STRING, description: "The main image URL of the product. Use absolute URL." },
        },
        required: ["name"],
      };

      const prompt = `
      Extract product information from the following webpage content.
      URL: ${url}
      Meta Title: ${ogTitle}
      Meta Image: ${ogImage}
      
      CRITICAL INSTRUCTIONS FOR PRICE:
      1. Find the ACTUAL CURRENT SELLING PRICE (often the lowest price for cash/PIX).
      2. DO NOT return installment values (e.g., if it says "10x de R$ 50", the price is 500. Return 500).
      3. DO NOT return old crossed-out prices.
      
      CRITICAL INSTRUCTIONS FOR IMAGE:
      1. Always prioritize the 'Meta Image' provided above.
      2. If not provided, try to find the absolute URL of the main product image in the text/context.
      
      Webpage Text Content:
      ${bodyText}
      `;

      let data: any = {};

      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const aiResponse = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              responseSchema: schema,
              temperature: 0.1,
            },
          });
          data = JSON.parse(aiResponse.text || "{}");
        } catch (aiError) {
          console.error("AI Extraction failed:", aiError);
        }
      } else {
        console.warn("GEMINI_API_KEY is not set. Skipping AI extraction.");
      }
      
      // Fallbacks
      if (!data.imageUrl && ogImage) {
        data.imageUrl = ogImage;
      }
      if (!data.name && ogTitle) {
        data.name = ogTitle;
      }

      res.json(data);
    } catch (error: any) {
      console.error("Extraction error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
