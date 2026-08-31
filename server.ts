import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import * as cheerio from "cheerio";
import { GoogleGenAI, Type, Schema } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  app.post("/api/extract", async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        return res.status(400).json({ error: "URL is required" });
      }

      const response = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
          "Accept-Encoding": "gzip, deflate, br",
          "sec-ch-ua": '"Chromium";v="120", "Not_A Brand";v="8"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Upgrade-Insecure-Requests": "1",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.status}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      const ogImage = $('meta[property="og:image"]').attr("content")
        || $('meta[property="og:image:secure_url"]').attr("content")
        || $('meta[name="twitter:image"]').attr("content")
        || $('link[rel="image_src"]').attr("href")
        || "";

      const ogTitle = $('meta[property="og:title"]').attr("content") || $("title").text() || "";

      // --- Structured data extraction (JSON-LD / meta price tags) ---
      // Mercado Livre and Shopee both embed a reliable "Product" JSON-LD block
      // for SEO/Google Shopping. This is unambiguous (no installments, no
      // crossed-out prices), so we must read it BEFORE stripping <script> tags.
      let ldName = "";
      let ldImage = "";
      let ldPrice: number | null = null;

      $('script[type="application/ld+json"]').each((_, el) => {
        const raw = $(el).contents().text();
        if (!raw) return;
        try {
          const parsed = JSON.parse(raw);
          const candidates = Array.isArray(parsed)
            ? parsed
            : Array.isArray((parsed as any)["@graph"])
              ? (parsed as any)["@graph"]
              : [parsed];

          for (const node of candidates) {
            const type = node?.["@type"];
            const isProduct = type === "Product" || (Array.isArray(type) && type.includes("Product"));
            if (!isProduct) continue;

            if (!ldName && typeof node.name === "string") ldName = node.name;

            if (!ldImage) {
              const img = node.image;
              if (typeof img === "string") ldImage = img;
              else if (Array.isArray(img) && img.length) ldImage = typeof img[0] === "string" ? img[0] : img[0]?.url || "";
              else if (img?.url) ldImage = img.url;
            }

            if (ldPrice === null) {
              let offers = node.offers;
              if (Array.isArray(offers)) offers = offers[0];
              const rawPrice = offers?.price ?? offers?.priceSpecification?.price ?? offers?.lowPrice;
              if (rawPrice !== undefined) {
                const num = typeof rawPrice === "string" ? parseFloat(rawPrice.replace(",", ".")) : Number(rawPrice);
                if (!Number.isNaN(num)) ldPrice = num;
              }
            }
          }
        } catch {
          // Ignore malformed JSON-LD blocks and keep looking / fall back to AI.
        }
      });

      // Extra structured price fallbacks some marketplaces use instead of JSON-LD.
      const metaPriceRaw =
        $('meta[property="product:price:amount"]').attr("content")
        || $('meta[property="og:price:amount"]').attr("content")
        || $('meta[itemprop="price"]').attr("content");
      const metaPrice = metaPriceRaw ? parseFloat(metaPriceRaw.replace(",", ".")) : null;

      const structuredPrice = ldPrice ?? (metaPrice !== null && !Number.isNaN(metaPrice) ? metaPrice : null);
      const structuredImage = ldImage || "";
      const structuredName = ldName || "";

      // Clean up HTML to reduce token usage (safe now that JSON-LD was already read)
      $("script, style, noscript, iframe, svg, path").remove();
      const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 30000);

      // Detect likely bot-block / empty shell pages (common on Shopee) so we can
      // surface a clear error instead of letting the AI hallucinate from nothing.
      const looksBlocked = html.length < 5000 && !structuredPrice && !ogImage && bodyText.length < 500;
      if (looksBlocked) {
        return res.status(422).json({
          error: "A página bloqueou o acesso automático (comum na Shopee) e não retornou dados suficientes para extrair o produto.",
        });
      }

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

      ${structuredPrice !== null || structuredImage || structuredName ? `
      STRUCTURED DATA FOUND ON PAGE (JSON-LD / meta tags — HIGH CONFIDENCE, ALWAYS PREFER THIS OVER FREE TEXT):
      ${structuredName ? `Structured Name: ${structuredName}` : ""}
      ${structuredPrice !== null ? `Structured Price: ${structuredPrice}` : ""}
      ${structuredImage ? `Structured Image: ${structuredImage}` : ""}
      If a structured value is present above, use it as-is instead of parsing it out of the free text below.
      ` : ""}

      CRITICAL INSTRUCTIONS FOR PRICE:
      1. If "Structured Price" was provided above, use exactly that value.
      2. Otherwise, find the ACTUAL CURRENT SELLING PRICE (often the lowest price for cash/PIX).
      3. DO NOT return installment values (e.g., if it says "10x de R$ 50", the price is 500. Return 500).
      4. DO NOT return old crossed-out prices.

      CRITICAL INSTRUCTIONS FOR IMAGE:
      1. Always prioritize "Structured Image" if provided, then 'Meta Image' provided above.
      2. If neither is available, try to find the absolute URL of the main product image in the text/context.

      Webpage Text Content:
      ${bodyText}
      `;

      const aiResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: schema,
          temperature: 0.1,
        },
      });

      const data = JSON.parse(aiResponse.text || "{}");

      // Fallbacks — structured data wins over AI output when available,
      // since it's the least ambiguous source.
      if (structuredPrice !== null) {
        data.price = structuredPrice;
      }
      if (structuredImage) {
        data.imageUrl = structuredImage;
      } else if (!data.imageUrl && ogImage) {
        data.imageUrl = ogImage;
      }
      if (!data.name && (structuredName || ogTitle)) {
        data.name = structuredName || ogTitle;
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