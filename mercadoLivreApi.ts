import type { MercadoLivreProduct } from "./mercadoLivreExtractor";

/**
 * Extrai o ID do item (ex.: "MLB4340627705") a partir de uma URL de produto do
 * Mercado Livre/Mercado Libre, em qualquer país (MLB=Brasil, MLA=Argentina,
 * MLM=México, MCO=Colômbia, MLC=Chile, etc.) e com ou sem hífen entre as letras
 * e os números (funciona tanto para "MLB-4340627705-..." quanto para "MLB4340627705").
 */
export function extractMercadoLivreItemId(url: string): string | null {
  const match = /\b([A-Za-z]{3})-?(\d{6,12})\b/.exec(url);
  if (!match) return null;
  return `${match[1].toUpperCase()}${match[2]}`;
}

export function isMercadoLivreUrl(url: string): boolean {
  return /mercadolivre\.com|mercadolibre\.com/i.test(url);
}

interface MercadoLivreApiItem {
  id: string;
  title: string;
  price: number;
  original_price?: number | null;
  currency_id: string;
  pictures?: { id: string; url: string; secure_url?: string }[];
  installments?: { quantity: number; amount: number; rate: number } | null;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  BRL: "R$",
  ARS: "$",
  MXN: "$",
  CLP: "$",
  COP: "$",
  PEN: "S/",
  UYU: "$U",
  USD: "US$",
};

/**
 * Busca os dados do produto direto na API pública do Mercado Livre
 * (https://api.mercadolibre.com/items/{id}), sem precisar renderizar/raspar
 * a página HTML. Como é a API oficial usada por integrações legítimas, não
 * cai nas páginas de verificação anti-robô que bloqueiam scraping de HTML
 * a partir de IPs de datacenter/VPS.
 */
export async function fetchMercadoLivreProductViaApi(itemId: string): Promise<MercadoLivreProduct | null> {
  const response = await fetch(`https://api.mercadolibre.com/items/${itemId}`);
  if (!response.ok) return null;

  const item: MercadoLivreApiItem = await response.json();
  if (!item?.title || !(item.price > 0)) return null;

  const moeda = CURRENCY_SYMBOLS[item.currency_id] || item.currency_id;
  const valor = item.price;
  const valorOriginal = item.original_price && item.original_price > valor ? item.original_price : null;

  const parcelamento =
    item.installments?.quantity && item.installments?.amount
      ? {
          valor_total: item.installments.amount * item.installments.quantity,
          valor_parcela: item.installments.amount,
          numero_parcelas: item.installments.quantity,
          juros: !!item.installments.rate && item.installments.rate > 0,
        }
      : null;

  const desconto =
    valorOriginal && valorOriginal > valor && valor > 0
      ? `${Math.round((1 - valor / valorOriginal) * 100)}%`
      : null;

  const pic = item.pictures?.[0];

  return {
    nome: item.title,
    precos: {
      com_desconto: { valor, moeda, codigo_moeda: item.currency_id },
      original: valorOriginal ? { valor: valorOriginal, moeda, codigo_moeda: item.currency_id } : null,
      parcelamento,
      desconto,
    },
    imagem: { url: pic?.secure_url || pic?.url || "", id: pic?.id || "" },
  };
}
