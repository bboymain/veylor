export type ProductAcceptanceStatus = "idle" | "submitting" | "confirmed";

export type ProductAcceptanceRequest = {
  searchId: string;
  productUrl: string;
};

export function acceptanceKey(searchId: string, productUrl: string): string {
  return `${searchId}:${productUrl}`;
}

export function completedAcceptanceStatus(accepted: boolean): ProductAcceptanceStatus {
  return accepted ? "confirmed" : "idle";
}

export async function requestProductAcceptance(input: ProductAcceptanceRequest): Promise<boolean> {
  try {
    const response = await fetch("/api/product-accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) return false;
    const payload = (await response.json()) as { accepted?: unknown };
    return payload.accepted === true;
  } catch {
    return false;
  }
}
