# Stage 10 verification policy

Stage 10 separates user evidence from AI confidence.

- A product click verifies only the persisted `alternatives` row attached to the clicked search and its linked `products` row.
- The URL must normalize to the stored product URL and the alternative must belong to that same search.
- A manual search click can verify the clicked product, but cannot verify an image-scan cache entry.
- A scan cache entry is promoted only when the search succeeded, has an image SHA-256 fingerprint, and the clicked persisted alternative belongs to it.
- AI confidence, brand confidence, classification confidence, price, and title similarity are not verification evidence.
- Verification runs only through the server-side service-role RPC and is idempotent.
