import { describe, expect, test } from "bun:test";
import {
  buildRetailerLinks,
  buildSearchQueries,
  makeEmptyAttributes,
  type FashionAttributes,
} from "./fashion-analysis";

function attributes(overrides: Partial<FashionAttributes> = {}) {
  return {
    ...makeEmptyAttributes(),
    ...overrides,
  };
}

describe("fashion search generation", () => {
  test("builds broad, balanced, and detailed search phrases from corrected attributes", () => {
    const queries = buildSearchQueries(
      attributes({
        category: { label: "bomber jacket", confidence: 84 },
        color: { label: "black", confidence: 79 },
        fit: { label: "oversized", confidence: 64 },
        material: { label: "faux leather", confidence: 58 },
        pattern: { label: "solid", confidence: 48 },
        sleeve: { label: "long sleeve", confidence: 52 },
      }),
    );

    expect(queries.broad).toBe("black bomber jacket");
    expect(queries.balanced).toBe("black oversized faux leather bomber jacket");
    expect(queries.detailed).toContain("black oversized long sleeve faux leather bomber jacket");
  });

  test("keeps broad queries generic but includes a corrected possible brand in detailed queries", () => {
    const base = attributes({
      category: { label: "sneakers", confidence: 82 },
      color: { label: "white", confidence: 72 },
    });

    const queries = buildSearchQueries(base, "", "Veylor");

    expect(queries.broad).toBe("white sneakers");
    expect(queries.balanced).toBe("white sneakers");
    expect(queries.detailed).toBe("Veylor white sneakers");
  });

  test("generates encoded public retailer search links", () => {
    const links = buildRetailerLinks("white low top sneakers green accent");

    expect(links.map((link) => link.name)).toContain("Google Shopping");
    expect(links.every((link) => link.url.includes("white%20low%20top"))).toBe(true);
  });

  test("uses corrected attributes when generating retailer queries", () => {
    const corrected = attributes({
      category: { label: "sneakers", confidence: 100 },
      color: { label: "white", confidence: 100 },
      secondaryColor: { label: "green", confidence: 100 },
      fit: { label: "regular fit", confidence: 100 },
      style: { label: "casual", confidence: 100 },
    });

    const queries = buildSearchQueries(corrected);
    const links = buildRetailerLinks(queries.broad);

    expect(queries.broad).toBe("white sneakers");
    expect(links.find((link) => link.name === "eBay")?.url).toContain("white%20sneakers");
  });

  test("falls back to a manual fashion item query when confidence is too low", () => {
    const queries = buildSearchQueries(
      attributes({
        category: { label: "coat", confidence: 8 },
        color: { label: "black", confidence: 7 },
      }),
    );

    expect(queries.broad).toBe("fashion item");
  });
});
