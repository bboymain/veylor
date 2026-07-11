import { createFileRoute } from "@tanstack/react-router";
import {
  clearAnonymousShopperCookie,
  deleteShopperProfile,
  loadShopperPreferences,
  resolveAnonymousShopper,
} from "@/lib/anonymous-shopper.server";
import { jsonResponse } from "@/lib/fashion-scan";

function topPreference(values: Record<string, number>): string | null {
  const entries = Object.entries(values);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return entries[0]?.[0] ?? null;
}

export const Route = createFileRoute("/api/personalization")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const shopper = resolveAnonymousShopper(request);
        if (shopper.isNew) {
          return jsonResponse({
            active: false,
            clickCount: 0,
            topRetailer: null,
            topTier: null,
            averagePrice: null,
          });
        }

        const preferences = await loadShopperPreferences(shopper.id);
        return jsonResponse({
          active: Boolean(preferences && preferences.clickCount >= 2),
          clickCount: preferences?.clickCount ?? 0,
          topRetailer: preferences ? topPreference(preferences.preferredRetailers) : null,
          topTier: preferences ? topPreference(preferences.preferredTiers) : null,
          averagePrice: preferences?.averagePrice ?? null,
        });
      },

      DELETE: async ({ request }) => {
        const shopper = resolveAnonymousShopper(request);
        const deleted = shopper.isNew ? false : await deleteShopperProfile(shopper.id);
        return clearAnonymousShopperCookie(
          jsonResponse({ success: true, profileDeleted: deleted }),
        );
      },
    },
  },
});
