import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { SearchIdSchema } from "@/lib/database-identifiers";
import { jsonResponse } from "@/lib/fashion-scan";
import {
  recordScanCorrection,
  SCAN_CORRECTION_FIELDS,
} from "@/lib/scan-corrections.server";

const ScanCorrectionInputSchema = z.object({
  searchId: SearchIdSchema,
  itemId: z.string().trim().min(1).max(200),
  fieldName: z.enum(SCAN_CORRECTION_FIELDS),
  previousValue: z.string().max(200).nullable(),
  correctedValue: z.string().max(200).nullable(),
});

export const Route = createFileRoute("/api/scan-correction")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const contentType = request.headers.get("content-type") ?? "";
        if (!contentType.includes("application/json")) {
          return jsonResponse(
            { error: { code: "INVALID_REQUEST", message: "Expected a JSON request." } },
            415,
          );
        }

        const input = ScanCorrectionInputSchema.safeParse(await request.json());
        if (!input.success) {
          return jsonResponse(
            { error: { code: "INVALID_REQUEST", message: "Invalid scan-correction input." } },
            400,
          );
        }

        const saved = await recordScanCorrection(input.data);
        return jsonResponse({ success: saved });
      },
    },
  },
});
