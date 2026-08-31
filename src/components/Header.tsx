import { formatPrice } from "../lib/utils";

interface HeaderProps {
  total: number;
  itemsCount: number;
}

export function Header({ total, itemsCount }: HeaderProps) {
  return (
    <header className="flex flex-col md:flex-row justify-between items-start md:items-end mb-6 gap-4 shrink-0">
      <div className="flex flex-col">
        <h1 className="text-3xl font-bold tracking-tight text-zinc-800">
          Preço<span className="text-yellow-500">Watch</span>
        </h1>
        <p className="text-zinc-500 text-sm">Monitoramento inteligente de e-commerce</p>
      </div>
      <div className="flex gap-6 md:gap-8 items-center bg-white border border-zinc-200 px-6 py-4 rounded-2xl shadow-sm w-full md:w-auto justify-between md:justify-start">
        <div className="flex flex-col">
          <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">Total Estimado</span>
          <span className="text-2xl md:text-3xl font-black text-zinc-800 tracking-tighter">
            {formatPrice(total)}
          </span>
        </div>
        <div className="w-[1px] h-10 bg-zinc-200"></div>
        <div className="flex flex-col text-right md:text-left">
          <span className="text-[10px] uppercase tracking-widest text-zinc-400 font-bold">Alertas</span>
          <span className="text-2xl md:text-3xl font-black text-emerald-500 tracking-tighter">
            {String(itemsCount).padStart(2, '0')}
          </span>
        </div>
      </div>
    </header>
  );
}
