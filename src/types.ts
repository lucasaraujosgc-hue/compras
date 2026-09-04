export interface ProductOption {
  id: string; // for React keys
  url: string;
  name: string;
  price: number | null;
  originalPrice?: number | null;
  installments?: {
    count: number;
    value: number;
    interestFree: boolean;
  } | null;
  imageUrl: string;
  loading?: boolean;
  error?: string;
}

export interface WishlistItemType {
  id: string;
  category: string;
  priority: number; // 1-5
  options: ProductOption[];
  selectedOptionIndex: number;
}
