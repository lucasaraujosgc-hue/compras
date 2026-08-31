import { Star } from "lucide-react";
import { cn } from "@/src/lib/utils";

interface StarRatingProps {
  rating: number;
  onRatingChange?: (rating: number) => void;
  readonly?: boolean;
}

export function StarRating({ rating, onRatingChange, readonly = false }: StarRatingProps) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => !readonly && onRatingChange?.(star)}
          disabled={readonly}
          className={cn(
            "focus:outline-none transition-transform",
            !readonly && "hover:scale-110 active:scale-95",
            readonly && "cursor-default"
          )}
        >
          <Star
            className={cn(
              "w-3 h-3 md:w-3.5 md:h-3.5",
              star <= rating ? "fill-yellow-400 text-yellow-400" : "fill-zinc-200 text-zinc-200"
            )}
          />
        </button>
      ))}
    </div>
  );
}
