import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatPrice(price: number | null) {
  if (price === null) return "Indisponível";
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(price);
}

export async function extractProduct(url: string) {
  const response = await fetch("/api/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  
  if (!response.ok) {
    throw new Error("Falha ao extrair dados do produto");
  }
  
  const data = await response.json();
  
  // Mapeia o formato estruturado do Mercado Livre se ele existir
  if (data.produto && data.produto.nome) {
    const parcelamento = data.produto.precos?.parcelamento;
    return {
      name: data.produto.nome,
      price: data.produto.precos?.com_desconto?.valor || 0,
      originalPrice: data.produto.precos?.original?.valor || null,
      installments: parcelamento ? {
        count: parcelamento.numero_parcelas,
        value: parcelamento.valor_parcela,
        interestFree: !parcelamento.juros
      } : null,
      imageUrl: data.produto.imagem?.url || "",
    };
  }
  
  // Formato padrão (IA ou Fallback OG)
  return data;
}
