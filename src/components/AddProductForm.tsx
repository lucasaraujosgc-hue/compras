import { useState, useEffect } from "react";
import { WishlistItemType } from "../types";
import { extractProduct } from "../lib/utils";

interface AddProductFormProps {
  onAdd: (item: WishlistItemType) => void;
  categories: string[];
}

export function AddProductForm({ onAdd, categories }: AddProductFormProps) {
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState(categories[0] || "Geral");
  const [loading, setLoading] = useState(false);

  // Keep internal state in sync if categories prop changes and current category is no longer valid
  useEffect(() => {
    if (categories.length > 0 && !categories.includes(category)) {
      setCategory(categories[0]);
    }
  }, [categories, category]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) return;

    setLoading(true);
    try {
      const data = await extractProduct(url);
      
      const newOption = {
        id: crypto.randomUUID(),
        url,
        name: data.name || "Produto sem nome",
        price: data.price || null,
        imageUrl: data.imageUrl || "https://placehold.co/400x400?text=Sem+Imagem",
      };

      const newItem: WishlistItemType = {
        id: crypto.randomUUID(),
        category: category || "Geral",
        priority: 3,
        options: [newOption],
        selectedOptionIndex: 0,
      };

      onAdd(newItem);
      setUrl("");
    } catch (err) {
      alert("Erro ao extrair dados do produto. Verifique se o link é válido e tente novamente.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2 w-full md:w-auto">
      <input
        type="url"
        required
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        placeholder="Cole o link aqui..."
        className="bg-white border border-zinc-200 text-xs px-4 py-2 rounded-lg w-full sm:w-56 focus:outline-none focus:ring-2 focus:ring-yellow-400 transition-shadow text-zinc-800"
      />
      <select
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        className="bg-white border border-zinc-200 text-xs px-2 py-2 rounded-lg w-full sm:w-32 focus:outline-none focus:ring-2 focus:ring-yellow-400 transition-shadow text-zinc-800 cursor-pointer"
      >
        {categories.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <button
        type="submit"
        disabled={loading}
        className="bg-yellow-400 hover:bg-yellow-500 text-black font-bold text-xs px-4 py-2 rounded-lg transition-colors flex items-center justify-center disabled:opacity-70 disabled:cursor-not-allowed whitespace-nowrap"
      >
        {loading ? "Buscando..." : "Adicionar"}
      </button>
    </form>
  );
}
