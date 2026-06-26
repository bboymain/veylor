# Veylor

**Veylor is the Shazam of fashion.**

<p align="center">
  <img src="https://raw.githubusercontent.com/bboymain/veylor/main/docs/veylor-preview.svg" alt="Veylor homepage showing the local fashion scanner" width="100%" />
</p>

Upload a photo of an outfit, paste an image link, or scan a look to identify the clothing and accessories being worn. Veylor is designed to help users discover exact products when possible, then find visually similar alternatives across luxury, premium, and affordable price ranges.

## What Veylor Does

Veylor turns an outfit image into a shoppable fashion breakdown.

The experience is designed to:

- Detect individual fashion items in an outfit
- Identify clothing, shoes, watches, and accessories
- Suggest possible brands and product matches
- Find the exact item when available
- Recommend similar-looking alternatives
- Compare options across different price tiers
- Help users recreate a complete look within their budget

## How It Works

1. **Upload or paste an outfit**  
   Add a photo from your device or paste a link to an image.

2. **AI analyzes the look**  
   Veylor separates the outfit into individual pieces such as outerwear, tops, pants, shoes, and accessories.

3. **Products are identified**  
   Each piece is matched to likely brands, products, styles, materials, and colors.

4. **Alternatives are discovered**  
   Users can explore the original item or similar options grouped into luxury, premium, and affordable tiers.

## Vision

Fashion inspiration is everywhere, but finding the actual products behind a look can be difficult. Veylor aims to make fashion discovery as simple as identifying a song with Shazam.

See an outfit you like. Upload it. Discover the look.

## Current Status

The current repository contains the Veylor landing page and product concept experience. The fashion-recognition, product-search, and recommendation systems are planned as the project develops.

## Tech Stack

- React 19
- TanStack Start
- TanStack Router
- Vite
- Tailwind CSS v4
- shadcn-style UI components
- Bun
- Cloudflare Workers
- Wrangler

## Local Development

Install dependencies:

```bash
bun install
```

Start the development server:

```bash
bun run dev
```

Build for production:

```bash
bun run build
```

Preview the production build:

```bash
bun run preview
```

Run linting:

```bash
bun run lint
```

Run TypeScript checks:

```bash
bunx tsc --noEmit
```

## Project Structure

- `src/routes/__root.tsx` — root route, metadata, document shell, and providers
- `src/routes/index.tsx` — main Veylor landing page
- `src/router.tsx` — TanStack Router setup
- `src/start.ts` — TanStack Start middleware
- `src/server.ts` — Cloudflare Worker SSR wrapper
- `src/assets/` — fashion images and visual assets
- `src/components/ui/` — reusable interface components
- `wrangler.jsonc` — Cloudflare Workers deployment configuration

## Environment Variables

The current landing page does not require environment variables.

Future AI, visual-search, product-search, and affiliate integrations may require API credentials. Client-side variables should use the `VITE_` prefix and be documented in an `.env.example` file. Local Cloudflare secrets should be stored in `.dev.vars`.

## Deployment

The project is configured for deployment through Cloudflare Workers using Wrangler.

```bash
bun run build
```

Configure Cloudflare access locally or in CI before deploying the production build.
