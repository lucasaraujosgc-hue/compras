import { GoogleGenAI, Type } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
async function test() {
  const schema = {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          price: { type: Type.NUMBER },
          imageUrl: { type: Type.STRING },
        },
      };
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash",
    contents: "Find the current price and main product image URL for this product: https://www.mercadolivre.com.br/tenis-reserva-typer-leve-respiravel-confortavel-cinza/up/MLBU4258759084?pdp_filters=item_id%3AMLB4863089069&matt_tool=38524122&ua=zks7twB47uwMK0xTvIEojajI_kjd8DobwVPucoDCuYp4L4M#origin=whatsapp&sid=whatsapp&wid=MLB4863089069",
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: schema
    }
  });
  console.log(response.text);
}
test();
