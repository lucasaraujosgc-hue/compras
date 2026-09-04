/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect } from "react";
import { WishlistItemType } from "./types";
import { Header } from "./components/Header";
import { AddProductForm } from "./components/AddProductForm";
import { WishlistItem } from "./components/WishlistItem";
import { LayoutList, Star, ListOrdered, X, Plus } from "lucide-react";
import { formatPrice, cn } from "./lib/utils";

export default function App() {
  const [items, setItems] = useState<WishlistItemType[]>([]);
  const [availableCategories, setAvailableCategories] = useState<string[]>(["Geral", "Eletrônicos", "Casa", "Jogos", "Saúde"]);
  const [isLoaded, setIsLoaded] = useState(false);
  
  const [newCategory, setNewCategory] = useState("");
  
  const [searchTerm, setSearchTerm] = useState("");
  const [maxPrice, setMaxPrice] = useState("");

  useEffect(() => {
    fetch('/api/state')
      .then(res => res.json())
      .then(data => {
        if (data.items) setItems(data.items);
        if (data.categories) setAvailableCategories(data.categories);
        setIsLoaded(true);
      })
      .catch(err => {
        console.error("Failed to load state from server, falling back to localStorage", err);
        // Fallback for seamless migration from localstorage to backend
        const savedItems = localStorage.getItem("wishlist_items");
        const savedCats = localStorage.getItem("wishlist_categories");
        if (savedItems) setItems(JSON.parse(savedItems));
        if (savedCats) setAvailableCategories(JSON.parse(savedCats));
        setIsLoaded(true);
      });
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    
    // Save to server
    fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, categories: availableCategories })
    }).catch(console.error);
    
    // Also save to localStorage as a backup
    localStorage.setItem("wishlist_items", JSON.stringify(items));
    localStorage.setItem("wishlist_categories", JSON.stringify(availableCategories));
  }, [items, availableCategories, isLoaded]);

  const handleAddItem = (item: WishlistItemType) => {
    setItems((prev) => [item, ...prev]);
  };

  const updateItem = (id: string, updates: Partial<WishlistItemType>) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...updates } : item))
    );
  };

  const deleteItem = (id: string) => {
    setItems((prev) => prev.filter((item) => item.id !== id));
  };
  
  const handleAddCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCategory.trim();
    if (trimmed && !availableCategories.includes(trimmed)) {
      setAvailableCategories(prev => [...prev, trimmed]);
      setNewCategory("");
    }
  };
  
  const [categoryToDelete, setCategoryToDelete] = useState<string | null>(null);

  const handleDeleteCategory = (catToDelete: string) => {
    setCategoryToDelete(catToDelete);
  };

  const confirmDeleteCategory = () => {
    if (categoryToDelete) {
      setAvailableCategories(prev => prev.filter(c => c !== categoryToDelete));
      setCategoryToDelete(null);
    }
  };

  // Calculate grand total based on selected options
  const grandTotal = items.reduce((sum, item) => {
    const selectedOption = item.options[item.selectedOptionIndex];
    if (selectedOption && selectedOption.price !== null) {
      return sum + selectedOption.price;
    }
    return sum;
  }, 0);

  // Filter logic
  const filteredItems = items.filter(item => {
    const opt = item.options[item.selectedOptionIndex] || item.options[0];
    const matchesSearch = !searchTerm || opt?.name?.toLowerCase().includes(searchTerm.toLowerCase());
    const itemPrice = opt?.price || 0;
    const matchesPrice = !maxPrice || itemPrice <= Number(maxPrice);
    return matchesSearch && matchesPrice;
  });

  // Sort items: First by priority (descending), then by name
  const sortedItems = [...filteredItems].sort((a, b) => {
    if (b.priority !== a.priority) {
      return b.priority - a.priority;
    }
    const aName = a.options[0]?.name || "";
    const bName = b.options[0]?.name || "";
    return aName.localeCompare(bName);
  });

  const groupedCategories = availableCategories.map(cat => ({
    category: cat,
    items: sortedItems.filter(i => (i.category || 'Geral') === cat)
  })).filter(group => group.items.length > 0);

  const highPriorityCount = items.filter(i => i.priority >= 4).length;
  
  // Calculate Categories Totals
  const categoriesData = items.reduce((acc, item) => {
    const cat = item.category || 'Geral';
    const price = item.options[item.selectedOptionIndex]?.price || 0;
    if (!acc[cat]) acc[cat] = { total: 0 };
    acc[cat].total += price;
    return acc;
  }, {} as Record<string, { total: number }>);
  
  const colors = ['bg-yellow-400', 'bg-blue-400', 'bg-purple-400', 'bg-emerald-400', 'bg-rose-400', 'bg-orange-400', 'bg-cyan-400'];

  return (
    <div className="h-screen bg-zinc-100 text-zinc-900 font-sans flex flex-col overflow-hidden p-4 md:p-6">
      <div className="max-w-7xl mx-auto w-full h-full flex flex-col overflow-hidden">
        <Header total={grandTotal} itemsCount={items.length} />
        
        <div className="grid grid-cols-1 lg:grid-cols-12 lg:grid-rows-6 gap-4 flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
          {/* Main List Area (Bento 8x6) */}
          <div className="col-span-1 lg:col-span-8 lg:row-span-6 flex flex-col gap-4 overflow-y-auto h-[500px] lg:h-full pr-1 pb-20 lg:pb-0">
            {/* Top Bar with Add and Filters */}
            <div className="bg-white border border-zinc-200 rounded-3xl shadow-sm p-4 md:p-5 flex flex-col xl:flex-row justify-between xl:items-center gap-4 shrink-0">
              <div className="flex flex-col sm:flex-row gap-2 w-full xl:w-auto">
                <input
                  type="text"
                  value={searchTerm}
                  onChange={e => setSearchTerm(e.target.value)}
                  placeholder="Buscar pelo nome..."
                  className="bg-zinc-50 border border-zinc-200 text-xs px-3 py-2 rounded-lg w-full sm:w-48 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
                <input
                  type="number"
                  value={maxPrice}
                  onChange={e => setMaxPrice(e.target.value)}
                  placeholder="Preço máximo..."
                  className="bg-zinc-50 border border-zinc-200 text-xs px-3 py-2 rounded-lg w-full sm:w-32 focus:outline-none focus:ring-2 focus:ring-yellow-400"
                />
              </div>
              <AddProductForm onAdd={handleAddItem} categories={availableCategories} />
            </div>
            
            {/* Category Boards */}
            {items.length === 0 ? (
              <div className="bg-white border border-zinc-200 rounded-3xl shadow-sm p-10 text-center flex-1 flex flex-col items-center justify-center">
                <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-zinc-100 text-zinc-400 mb-3">
                  <LayoutList className="w-6 h-6" />
                </div>
                <p className="text-zinc-500 text-sm font-medium">Sua lista está vazia</p>
                <p className="text-zinc-400 text-xs mt-1">Adicione um link acima para começar</p>
              </div>
            ) : groupedCategories.length === 0 ? (
               <div className="bg-white border border-zinc-200 rounded-3xl shadow-sm p-10 text-center flex-1 flex flex-col items-center justify-center">
                 <p className="text-zinc-500 text-sm font-medium">Nenhum item encontrado com esses filtros.</p>
               </div>
            ) : (
              groupedCategories.map(group => (
                <div key={group.category} className="bg-white border border-zinc-200 rounded-3xl shadow-sm overflow-hidden flex flex-col shrink-0">
                  <div className="p-3 md:p-4 border-b border-zinc-100 flex justify-between items-center bg-zinc-50/50">
                    <h2 className="font-bold text-zinc-700 flex items-center gap-2">
                      <ListOrdered className="w-4 h-4 text-yellow-500" />
                      {group.category}
                    </h2>
                    <span className="text-[10px] font-bold text-zinc-400 bg-zinc-200/50 px-2 py-0.5 rounded-full">
                      {group.items.length} {group.items.length === 1 ? 'item' : 'itens'}
                    </span>
                  </div>
                  
                  <div className="p-3 md:p-4 space-y-3">
                    {group.items.map((item) => (
                      <WishlistItem
                        key={item.id}
                        item={item}
                        updateItem={updateItem}
                        deleteItem={deleteItem}
                        categories={availableCategories}
                      />
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Side Panels - visible mainly on large screens, stack on small */}
          
          {/* Stats/Alerts Box (Bento 4x3) */}
          <div className="col-span-1 lg:col-span-4 lg:row-span-3 bg-zinc-800 text-white rounded-3xl p-6 shadow-lg flex flex-col justify-between hidden sm:flex">
            <div>
              <h3 className="text-lg font-bold mb-4 flex items-center gap-2">
                <div className="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
                Top Itens
              </h3>
              <div className="space-y-4 overflow-y-auto max-h-[140px] pr-2">
                {sortedItems.slice(0, 4).map((item) => (
                  <div key={item.id} className="flex justify-between items-center gap-3">
                    <span className="text-xs text-zinc-400 truncate flex-1" title={item.options[item.selectedOptionIndex]?.name}>
                      {item.options[item.selectedOptionIndex]?.name || 'Sem nome'}
                    </span>
                    <span className="text-xs font-bold text-emerald-400 whitespace-nowrap">
                      {formatPrice(item.options[item.selectedOptionIndex]?.price)}
                    </span>
                  </div>
                ))}
                {items.length === 0 && (
                  <span className="text-xs text-zinc-500">Adicione itens para ver o top rank.</span>
                )}
              </div>
            </div>
            <div className="pt-5 border-t border-zinc-700 mt-4">
              <div className="flex justify-between items-end">
                <div>
                  <p className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Total Geral</p>
                  <p className="text-2xl font-black text-white truncate max-w-[200px]">{formatPrice(grandTotal)}</p>
                </div>
                <div className="bg-zinc-700 p-2.5 rounded-xl text-white">
                  <LayoutList className="w-5 h-5" />
                </div>
              </div>
            </div>
          </div>

          {/* Priority Box (Bento 2x3) */}
          <div className="col-span-1 lg:col-span-2 lg:row-span-3 bg-white border border-zinc-200 rounded-3xl p-5 flex flex-col items-center justify-center text-center hidden sm:flex">
            <div className="w-12 h-12 bg-yellow-100 text-yellow-600 rounded-2xl flex items-center justify-center mb-3">
              <Star className="w-6 h-6 fill-yellow-600" />
            </div>
            <span className="text-[10px] uppercase font-bold text-zinc-400 tracking-tighter mb-1">Alta Prioridade</span>
            <span className="text-3xl font-black text-zinc-800">{String(highPriorityCount).padStart(2, '0')}</span>
            <span className="text-[10px] text-zinc-500 mt-2 font-medium">Itens 4+ estrelas</span>
          </div>

          {/* Categories Box (Bento 2x3) */}
          <div className="col-span-1 lg:col-span-2 lg:row-span-3 bg-zinc-100 border border-zinc-200 rounded-3xl p-5 flex flex-col overflow-hidden">
            <h4 className="text-[10px] uppercase font-bold text-zinc-500 mb-4 tracking-widest shrink-0">Gerenciar Categorias</h4>
            <div className="space-y-3 overflow-y-auto flex-1 pr-1">
              {availableCategories.map((cat, i) => (
                <div key={cat} className="flex justify-between items-center gap-2 group">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={cn("w-2 h-2 rounded-full flex-shrink-0", colors[i % colors.length])}></div>
                    <span className="text-xs font-bold text-zinc-700 truncate" title={cat}>{cat}</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-[10px] font-bold text-zinc-500 shrink-0">
                      {formatPrice(categoriesData[cat]?.total || 0)}
                    </span>
                    {cat !== "Geral" && categoryToDelete === cat ? (
                      <div className="flex items-center gap-1">
                        <button onClick={confirmDeleteCategory} className="text-white bg-red-500 hover:bg-red-600 rounded px-1.5 py-0.5 text-[8px] font-bold">Sim</button>
                        <button onClick={() => setCategoryToDelete(null)} className="text-zinc-500 bg-zinc-200 hover:bg-zinc-300 rounded px-1.5 py-0.5 text-[8px] font-bold">Não</button>
                      </div>
                    ) : cat !== "Geral" && (
                      <button 
                        onClick={() => handleDeleteCategory(cat)} 
                        className="text-zinc-300 hover:text-red-500 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity p-0.5"
                        title="Excluir categoria"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              {availableCategories.length === 0 && (
                <span className="text-xs text-zinc-400 font-medium">Sem dados</span>
              )}
            </div>
            
            <form onSubmit={handleAddCategory} className="flex gap-2 shrink-0 border-t border-zinc-200 pt-3 mt-3">
              <input 
                type="text" 
                value={newCategory} 
                onChange={e => setNewCategory(e.target.value)} 
                placeholder="Nova categoria..."
                className="w-full bg-white border border-zinc-200 text-[10px] px-2 py-1.5 rounded-lg focus:outline-none focus:border-yellow-400 text-zinc-800"
              />
              <button 
                type="submit" 
                disabled={!newCategory.trim()}
                className="bg-zinc-800 text-white px-2 py-1.5 rounded-lg text-[10px] font-bold hover:bg-zinc-700 disabled:opacity-50 flex items-center justify-center transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
              </button>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
