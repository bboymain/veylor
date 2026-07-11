import { useEffect } from "react";
import type { FashionScanResponse } from "./fashion-scan";

export const CORRECTION_FIELD_BY_LABEL = {
  "Item name": "name",
  Category: "category",
  "Primary color": "color",
  Style: "style",
  Material: "material",
  Pattern: "pattern",
  "Visible brand": "visibleBrand",
} as const;

export type CorrectionFieldName =
  (typeof CORRECTION_FIELD_BY_LABEL)[keyof typeof CORRECTION_FIELD_BY_LABEL];

type CorrectionPayload = {
  searchId: string;
  itemId: string;
  fieldName: CorrectionFieldName;
  previousValue: string | null;
  correctedValue: string | null;
};

type FocusSnapshot = {
  searchId: string;
  itemId: string;
  fieldName: CorrectionFieldName;
  previousValue: string | null;
};

export function correctionFieldFromLabel(label: string): CorrectionFieldName | null {
  return CORRECTION_FIELD_BY_LABEL[label.trim() as keyof typeof CORRECTION_FIELD_BY_LABEL] ?? null;
}

export function normalizeCorrectionInput(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized : null;
}

export function buildCorrectionPayload(
  snapshot: FocusSnapshot,
  currentValue: string,
): CorrectionPayload | null {
  const correctedValue = normalizeCorrectionInput(currentValue);
  if (snapshot.previousValue === correctedValue) return null;
  return { ...snapshot, correctedValue };
}

function requestPath(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.pathname;
  return new URL(input.url).pathname;
}

function editableArticles(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("#scanner article")).filter((article) =>
    Array.from(article.querySelectorAll("summary")).some(
      (summary) => summary.textContent?.trim() === "Edit details",
    ),
  );
}

/**
 * Captures explicit scanner-field edits without changing the existing editor UI.
 * It observes the successful scan response, then records a correction only when
 * an edit field loses focus with a meaningfully different normalized value.
 */
export function ScanCorrectionCaptureBridge() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);
    let currentSearchId: string | null = null;
    let currentItemIds: string[] = [];
    const focusSnapshots = new WeakMap<HTMLInputElement, FocusSnapshot>();

    window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await originalFetch(input, init);
      if (requestPath(input) === "/api/fashion-scan" && response.ok) {
        void response
          .clone()
          .json()
          .then((payload: FashionScanResponse) => {
            if ("error" in payload) return;
            currentSearchId = payload.searchId ?? null;
            currentItemIds = payload.result.items.map((item) => item.id);
          })
          .catch(() => {
            // Scan parsing must never affect the original request.
          });
      }
      return response;
    }) as typeof window.fetch;

    const onFocusIn = (event: FocusEvent) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement) || !currentSearchId) return;
      const label = input.closest("label");
      const article = input.closest("article");
      if (!label || !article) return;

      const labelText = label.querySelector("span")?.textContent ?? "";
      const fieldName = correctionFieldFromLabel(labelText);
      if (!fieldName) return;

      const itemIndex = editableArticles().indexOf(article);
      const itemId = currentItemIds[itemIndex];
      if (!itemId) return;

      focusSnapshots.set(input, {
        searchId: currentSearchId,
        itemId,
        fieldName,
        previousValue: normalizeCorrectionInput(input.value),
      });
    };

    const onFocusOut = (event: FocusEvent) => {
      const input = event.target;
      if (!(input instanceof HTMLInputElement)) return;
      const snapshot = focusSnapshots.get(input);
      if (!snapshot) return;
      focusSnapshots.delete(input);

      const payload = buildCorrectionPayload(snapshot, input.value);
      if (!payload) return;

      void originalFetch("/api/scan-correction", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // Correction evidence is best-effort and must never disrupt editing.
      });
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);

    return () => {
      window.fetch = originalFetch;
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return null;
}
