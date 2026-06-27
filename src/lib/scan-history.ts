import type { ScanHistoryItem } from "./fashion-analysis";

const HISTORY_KEY = "veylor.localScanHistory.v1";
const MAX_HISTORY_ITEMS = 8;

export function loadScanHistory(): ScanHistoryItem[] {
  if (typeof window === "undefined") return [];

  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    return raw ? (JSON.parse(raw) as ScanHistoryItem[]) : [];
  } catch {
    return [];
  }
}

export function saveScanToHistory(item: ScanHistoryItem) {
  const next = [item, ...loadScanHistory().filter((scan) => scan.id !== item.id)].slice(
    0,
    MAX_HISTORY_ITEMS,
  );
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function deleteScanFromHistory(id: string) {
  const next = loadScanHistory().filter((scan) => scan.id !== id);
  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  return next;
}

export function clearScanHistory() {
  window.localStorage.removeItem(HISTORY_KEY);
  return [];
}
