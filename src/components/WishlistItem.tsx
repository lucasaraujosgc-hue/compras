import { useState } from "react";
import { WishlistItemType } from "../types";
import { StarRating } from "./StarRating";
import { Trash2, ExternalLink, RefreshCw } from "lucide-react";
import { cn, extractProduct, formatPrice } from "../lib/utils";

interface WishlistItemProps {
  item: WishlistItemType;
  updateItem: (id: string, updates: Partial<WishlistItemType>) => void;
  deleteItem: (id: string) => void;
  categories: string[];
}

export function WishlistItem({ item, updateItem, deleteItem, categories }: WishlistItemProps) {
  const [newOptionUrl, setNewOptionUrl] = useState("");
  const [isAddingOption, setIsAddingOption] = useState(false);
  const [loadingOption, setLoadingOption] = useState(false);

  const selectedOption = item.options[item.selectedOptionIndex] || item.options[0];
  
  // Ensure the current item's category is always visible in the dropdown, even if deleted from global list
  const displayCategories = Array.from(new Set([...categories, item.category]));

  const handleAddOption = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOptionUrl.trim()) return;

    setLoadingOption(true);
    try {
      const data = await extractProduct(newOptionUrl);
      const newOption = {
        id: crypto.randomUUID(),
        url: newOptionUrl,
        name: data.name || "Produto sem nome",
        price: data.price || null,
        imageUrl: data.imageUrl || "https://placehold.co/400x400?text=Sem+Imagem",
      };
      updateItem(item.id, {
        options: [...item.options, newOption]
      });
      setNewOptionUrl("");
      setIsAddingOption(false);
    } catch (err) {
      alert("Erro ao extrair dados da opção. Verifique o link.");
    } finally {
      setLoadingOption(false);
    }
  };

  const handleRefreshOption = async (optionIndex: number) => {
    const option = item.options[optionIndex];
    const newOptions = [...item.options];
    newOptions[optionIndex] = { ...option, loading: true };
    updateItem(item.id, { options: newOptions });

    try {
      const data = await extractProduct(option.url);
      newOptions[optionIndex] = {
        ...option,
        name: data.name || option.name,
        price: data.price !== undefined ? data.price : option.price,
        imageUrl: data.imageUrl || option.imageUrl,
        loading: false
      };
      updateItem(item.id, { options: newOptions });
    } catch (err) {
      newOptions[optionIndex] = { ...option, loading: false, error: "Falha" };
      updateItem(item.id, { options: newOptions });
    }
  };

  return (
    <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 p-3 bg-white border border-zinc-100 rounded-2xl hover:border-yellow-200 transition-colors relative group shadow-sm">
      {item.priority === 5 && (
        <div className="absolute top-0 right-0 bg-emerald-500 text-white text-[9px] font-bold px-3 py-1 rounded-bl-xl rounded-tr-2xl z-10">
          MÁXIMA
        </div>
      )}
      
      <div className="w-20 h-20 bg-zinc-100 rounded-xl flex-shrink-0 flex items-center justify-center overflow-hidden border border-zinc-100">
        <img 
          src={selectedOption?.imageUrl} 
          alt={selectedOption?.name} 
          className="w-full h-full object-cover"
        />
      </div>

      <div className="flex-1 w-full min-w-0">
        <div className="flex justify-between items-start gap-2">
          <h3 className="font-bold text-sm text-zinc-800 line-clamp-2" title={selectedOption?.name}>
            {selectedOption?.name}
          </h3>
          <select
            value={item.category}
            onChange={(e) => updateItem(item.id, { category: e.target.value })}
            className="px-1 py-0.5 bg-zinc-100/50 hover:bg-white text-[10px] font-bold rounded uppercase text-zinc-600 flex-shrink-0 w-28 border border-dashed border-zinc-200 focus:border-yellow-400 focus:bg-white focus:outline-none text-center transition-colors cursor-pointer"
            title="Alterar categoria"
          >
            {displayCategories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        
        <div className="flex items-center gap-1 my-1.5">
          <StarRating 
            rating={item.priority} 
            onRatingChange={(rating) => updateItem(item.id, { priority: rating })}
          />
        </div>
        
        <div className="flex items-center gap-2">
          <span className="text-lg font-black text-zinc-900">
            {formatPrice(selectedOption?.price)}
          </span>
          <button
            onClick={() => handleRefreshOption(item.selectedOptionIndex)}
            disabled={selectedOption?.loading}
            className="p-1.5 text-zinc-300 hover:text-emerald-500 rounded-full transition-colors disabled:opacity-50"
            title="Atualizar preço"
          >
            <RefreshCw className={cn("w-3.5 h-3.5", selectedOption?.loading && "animate-spin")} />
          </button>
          <a 
            href={selectedOption?.url} 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-zinc-300 hover:text-zinc-600 p-1.5"
            title="Abrir no site"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>

      <div className="flex flex-col gap-2 w-full sm:w-auto mt-2 sm:mt-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-zinc-100 items-start sm:items-end">
        <div className="flex flex-col gap-1.5 w-full">
          {item.options.map((option, index) => (
            <button 
              key={option.id}
              onClick={() => updateItem(item.id, { selectedOptionIndex: index })}
              className={cn(
                "px-3 py-1.5 rounded-lg text-[10px] font-bold transition-colors w-full text-left sm:text-right truncate max-w-full sm:max-w-[180px]",
                item.selectedOptionIndex === index 
                  ? "bg-zinc-800 text-white" 
                  : "border border-zinc-200 text-zinc-500 hover:bg-zinc-50"
              )}
              title={option.name}
            >
              {index === 0 ? "Opção 1" : `Opção ${index + 1}`}: {formatPrice(option.price)}
            </button>
          ))}
        </div>
        
        <div className="flex items-center justify-between sm:justify-end gap-3 w-full mt-1">
          {isAddingOption ? (
            <form onSubmit={handleAddOption} className="flex gap-1 flex-1 sm:flex-initial">
              <input
                type="url"
                required
                value={newOptionUrl}
                onChange={(e) => setNewOptionUrl(e.target.value)}
                placeholder="Link..."
                className="flex-1 sm:w-28 text-[10px] bg-white border border-zinc-200 rounded px-2 py-1 focus:outline-none focus:border-yellow-400"
              />
              <button
                type="submit"
                disabled={loadingOption}
                className="bg-yellow-400 text-black px-2 py-1 rounded text-[10px] font-bold disabled:opacity-70"
              >
                OK
              </button>
              <button
                type="button"
                onClick={() => setIsAddingOption(false)}
                className="text-zinc-400 hover:text-zinc-600 px-1"
              >
                ×
              </button>
            </form>
          ) : (
            <button
              onClick={() => setIsAddingOption(true)}
              className="text-[10px] font-bold text-zinc-400 hover:text-yellow-600 transition-colors"
            >
              + Opção
            </button>
          )}
          <button
            onClick={() => {
              if (window.confirm("Deseja remover este item da sua lista?")) {
                deleteItem(item.id);
              }
            }}
            className="text-zinc-300 hover:text-red-500 p-1 rounded-full hover:bg-red-50 transition-colors"
            title="Remover produto"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
