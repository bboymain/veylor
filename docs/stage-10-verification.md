# Product signal and identity policy

Veylor keeps user behavior separate from trusted identity evidence.

- `clicked` means interest, curiosity, comparison, or ranking evidence. A click never verifies a product, alternative, scan, cache entry, brand, or identity.
- `accepted_match` means the user explicitly confirmed that a displayed result is the item they intended. Acceptance remains separate from verified identity.
- `verified_identity` requires stronger trusted evidence such as authoritative catalog matching, independent method agreement, or administrator review.
- Product authenticity and brand verification remain separate from both click and acceptance signals.
- Exact-image cache promotion requires its own trusted evidence policy; neither clicks nor accepted matches promote cache trust.
- All click and acceptance writes remain server-owned, relationship-scoped, and idempotent where appropriate.

The legacy Stage 10 click-verification RPC was neutralized by the accepted-match migration and retired after application click handling moved to the existing interest-only alternative path. Historical rows carrying its exact evidence labels are repaired by an audited, narrowly scoped migration.
