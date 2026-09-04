import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";
import { GoogleGenAI, Type, Schema } from "@google/genai";
import fs from "fs/promises";
import { extractMercadoLivreInitialState, buildMercadoLivreProduct } from "./mercadoLivreExtractor";
import {
  extractMercadoLivreItemId,
  isMercadoLivreUrl,
  fetchMercadoLivreProductViaApi,
  type MercadoLivreApiDiagnostics,
} from "./mercadoLivreApi";

const DB_FILE = path.join(process.cwd(), "data", "db.json");

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

      // 0. MERCADO LIVRE: tenta a API pública oficial primeiro. Ela devolve o item em
      // JSON diretamente, sem precisar renderizar a página — evita as páginas de
      // verificação anti-robô ("/gz/account-verification") que bloqueiam scraping de
      // HTML a partir de IPs de datacenter/VPS.
      if (isMercadoLivreUrl(url)) {
        const itemId = extractMercadoLivreItemId(url);
        if (itemId) {
          const apiDiagnostics: MercadoLivreApiDiagnostics = {};
          try {
            const produto = await fetchMercadoLivreProductViaApi(itemId, apiDiagnostics);
            if (produto) {
              console.log(`[extract] Produto obtido via API oficial do Mercado Livre (item ${itemId})`);
              return res.json({ produto });
            }
            console.warn(
              `[extract] API do Mercado Livre não retornou dados suficientes para ${itemId} (status=${apiDiagnostics.status} motivo=${apiDiagnostics.errorMessage}), tentando via HTML`
            );
          } catch (e) {
            console.error(`[extract] Erro ao consultar API do Mercado Livre para ${itemId}`, e);
          }
        }
      }

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

      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      console.log(
        `[extract] url=${url} finalUrl=${response.url} status=${response.status} htmlLength=${html.length} hasNordicScript=${!!$("#__NORDIC_RENDERING_CTX__").length}`
      );

      // 1. TENTATIVA DE EXTRAÇÃO DIRETA SEM IA (MERCADO LIVRE E OUTROS VIA SCRIPT)
      try {
        const initialState = extractMercadoLivreInitialState($);
        if (initialState) {
          const produto = buildMercadoLivreProduct(initialState);
          if (produto) {
            return res.json({ produto });
          }
          console.warn("[extract] initialState encontrado mas buildMercadoLivreProduct retornou null (faltou nome ou preço)");
        } else {
          console.warn("[extract] Nenhum initialState encontrado (nem NORDIC_RENDERING_CTX nem PRELOADED_STATE)");
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

      // Se nem o parse estruturado, nem a IA, nem as tags OG renderam nada útil,
      // não finja sucesso: isso costuma indicar que o site bloqueou a requisição
      // (página de verificação/captcha em vez do produto real).
      if (!data.name || (!data.price && !data.imageUrl)) {
        console.warn(
          `[extract] Extração sem dados suficientes. name=${JSON.stringify(data.name)} price=${data.price} imageUrl=${JSON.stringify(data.imageUrl)}`
        );
        return res.status(422).json({
          error:
            "Não foi possível extrair os dados do produto. O site pode estar bloqueando o acesso automático (ex.: verificação anti-robô) ou a página não é uma página de produto válida.",
        });
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
