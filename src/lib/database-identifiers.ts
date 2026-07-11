import { z } from "zod";

/**
 * Public API validation for identifiers that map to Supabase UUID primary keys.
 * Keeping this in a client-safe module is intentional: it contains validation
 * only and never reads database credentials or performs database I/O.
 */
export const SearchIdSchema = z.string().uuid();

export type SearchId = z.infer<typeof SearchIdSchema>;
