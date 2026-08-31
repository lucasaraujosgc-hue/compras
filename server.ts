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
