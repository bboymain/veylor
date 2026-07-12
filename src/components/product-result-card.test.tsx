import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProductResultCard } from "./product-result-card";
import type { ProductSearchResult } from "@/lib/product-search";

const product: ProductSearchResult = {
  id: "serpapi-1",
  title: "Black wool coat",
  imageUrl: "https://images.example.com/coat.jpg",
  productUrl: "https://shop.example.com/coat",
  price: 120,
  currency: "USD",
  retailer: "Example Shop",
  source: "serpapi",
  tier: "premium",
};

function render(status: "idle" | "submitting" | "confirmed", canAccept = true): string {
  return renderToStaticMarkup(
    <ProductResultCard
      product={product}
      tierLabel="Premium"
      canAccept={canAccept}
      acceptanceStatus={status}
      onRetailerClick={() => undefined}
      onAccept={() => undefined}
    />,
  );
}

describe("product result card acceptance UI", () => {
  test("shows the explicit default confirmation action", () => {
    const html = render("idle");

    expect(html).toContain("This is the correct item");
    expect(html).not.toContain("Confirmed match");
    expect(html).not.toContain('disabled=""');
  });

  test("disables the action while submitting and after confirmation", () => {
    const submitting = render("submitting");
    const confirmed = render("confirmed");

    expect(submitting).toContain("Confirming...");
    expect(submitting).toContain('disabled=""');
    expect(confirmed).toContain("Confirmed match");
    expect(confirmed).toContain('disabled=""');
  });

  test("keeps the retailer link separate from the acceptance button", () => {
    const html = render("idle");
    const anchorStart = html.indexOf("<a ");
    const anchorEnd = html.indexOf("</a>");
    const buttonStart = html.indexOf("<button");

    expect(anchorStart).toBeGreaterThanOrEqual(0);
    expect(anchorEnd).toBeGreaterThan(anchorStart);
    expect(buttonStart).toBeGreaterThan(anchorEnd);
    expect(html).toContain('href="https://shop.example.com/coat"');
  });

  test("omits acceptance for non-persisted result cards", () => {
    const html = render("idle", false);

    expect(html).not.toContain("This is the correct item");
    expect(html).toContain('href="https://shop.example.com/coat"');
  });
});
