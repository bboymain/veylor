import { ArrowRight, Check, ImageIcon, RotateCw } from "lucide-react";
import type { ProductAcceptanceStatus } from "@/lib/product-acceptance";
import type { ProductSearchResult } from "@/lib/product-search";

export type ProductResultCardProps = {
  product: ProductSearchResult;
  tierLabel: string;
  canAccept: boolean;
  acceptanceStatus: ProductAcceptanceStatus;
  onRetailerClick: () => void;
  onAccept: () => void;
};

export function ProductResultCard({
  product,
  tierLabel,
  canAccept,
  acceptanceStatus,
  onRetailerClick,
  onAccept,
}: ProductResultCardProps) {
  const submitting = acceptanceStatus === "submitting";
  const confirmed = acceptanceStatus === "confirmed";

  return (
    <article className="group overflow-hidden border border-[rgba(201,169,106,0.18)] bg-white/[0.02] transition-colors hover:border-gold/50 focus-within:border-gold/70">
      <a
        href={product.productUrl}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onRetailerClick}
        className="block focus-visible:outline-none"
      >
        <div className="aspect-[4/3] overflow-hidden bg-white/5">
          {product.imageUrl ? (
            <img
              src={product.imageUrl}
              alt=""
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center" aria-hidden="true">
              <ImageIcon className="h-8 w-8 text-gold/25" />
            </div>
          )}
        </div>
        <div className="p-3">
          <div className="text-[8px] uppercase tracking-luxe text-gold/70">{tierLabel}</div>
          <div className="mt-2 line-clamp-2 text-sm text-foreground/80">{product.title}</div>
          <div className="mt-3 flex items-end justify-between gap-2">
            <div>
              <div className="text-sm text-foreground">
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: product.currency,
                }).format(product.price)}
              </div>
              <div className="mt-1 text-[9px] uppercase tracking-luxe text-foreground/40">
                {product.retailer}
              </div>
            </div>
            <ArrowRight className="h-3.5 w-3.5 text-gold" aria-hidden="true" />
          </div>
          <span className="sr-only">Opens the retailer page in a new tab.</span>
        </div>
      </a>

      {canAccept && (
        <div className="border-t border-[rgba(201,169,106,0.12)] px-3 py-2.5">
          <button
            type="button"
            onClick={onAccept}
            disabled={submitting || confirmed}
            className="inline-flex min-h-9 w-full items-center justify-center gap-2 text-[9px] uppercase tracking-luxe text-gold/75 transition-colors hover:text-gold disabled:cursor-default disabled:text-gold/50"
          >
            {submitting ? (
              <RotateCw className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : confirmed ? (
              <Check className="h-3 w-3" aria-hidden="true" />
            ) : null}
            {submitting
              ? "Confirming..."
              : confirmed
                ? "Confirmed match"
                : "This is the correct item"}
          </button>
        </div>
      )}
    </article>
  );
}
