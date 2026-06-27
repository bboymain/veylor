# Veylor

Veylor is a TanStack Start React app for AI-assisted fashion discovery. Users upload an outfit photo, crop/focus the image, analyze visible clothing and accessories through a secure server route, correct broad fashion attributes, and open retailer search links without fabricated product matches.

## Tech Stack

- React 19
- TanStack Start and TanStack Router
- Vite
- Tailwind CSS v4
- shadcn-style UI components
- Google Gemini 2.5 Flash via `@google/genai`
- Optional local Ollama vision fallback
- Bun package manager
- Cloudflare Workers via Wrangler

## Scanner MVP

The active scanner sends the cropped image to `/api/fashion-scan`. The server chooses the AI provider from `AI_PROVIDER`:

- `AI_PROVIDER=gemini` uses Gemini 2.5 Flash and is the default.
- `AI_PROVIDER=local` uses the existing local Ollama integration as a fallback.

The server validates supported image data, sends JPEG/PNG/WebP image bytes to the selected provider, requires structured JSON output, validates the model response with Zod, and returns only structured fashion attributes to the browser.

Image limits:

- Supported formats: JPG, JPEG, PNG, WEBP
- Server-side maximum encoded image size: 6 MB
- The browser crops and resizes the selected image before sending it to the server route
- Uploaded images are not saved permanently

Gemini identifies visual attributes and search phrases, but it may not always identify an exact product or brand. A brand should only be returned when visible text, a logo, a label, or a highly distinctive detail supports it.

The MVP does not verify live prices, inventory, exact product matches, or retailer availability. Retailer buttons open normal public search URLs.

## Local Setup

Install dependencies:

```bash
bun install
```

Copy the development secrets template:

```bash
cp .dev.vars.example .dev.vars
```

On Windows PowerShell:

```powershell
Copy-Item .dev.vars.example .dev.vars
```

Add your Gemini API key to `.dev.vars`:

```env
GEMINI_API_KEY=your_real_key_here
AI_PROVIDER=gemini
```

Do not commit `.dev.vars`, `.env.local`, API keys, tokens, or secrets.

Start the development server:

```bash
bun run dev
```

Open the scanner, upload a fashion image, adjust the focus crop, then click **Scan Outfit**.

## Local Ollama Fallback

Gemini is the default provider. To use the local fallback instead, install Ollama, pull the local vision model, and set `AI_PROVIDER=local`.

```bash
ollama pull qwen2.5vl
```

Local fallback variables:

```env
AI_PROVIDER=local
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_VISION_MODEL=qwen2.5vl
```

Troubleshooting:

- `Missing Gemini API key`: add `GEMINI_API_KEY` to `.dev.vars`.
- `Gemini rejected the API key`: confirm the key is valid and active.
- `Gemini rate limit reached`: wait and try again on the free tier.
- `Unsupported image type`: use JPG, JPEG, PNG, or WEBP.
- `Image is too large`: crop tighter or use a smaller image.
- Local fallback `Ollama not running`: start Ollama and retry.
- Local fallback `Model not installed`: run `ollama pull qwen2.5vl`.

## Cloudflare Deployment

This repository is configured for Cloudflare Workers with Wrangler.

Set the production Gemini secret before deploying:

```bash
bunx wrangler secret put GEMINI_API_KEY
```

Set non-secret provider configuration in Wrangler or your deployment environment:

```env
AI_PROVIDER=gemini
```

Then build and deploy with your normal Cloudflare Workers workflow. Do not deploy from this setup step until you are ready.

## Commands

Build for production:

```bash
bun run build
```

Preview the production build locally:

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

Run tests:

```bash
bun test
```

## Project Structure

- `src/routes/__root.tsx`: root route, document shell, metadata, global providers
- `src/routes/index.tsx`: main Veylor page and scanner UI
- `src/routes/api/fashion-scan.ts`: provider-selected fashion scan endpoint
- `src/lib/gemini-fashion.ts`: Gemini 2.5 Flash schema, prompt, validation, and error handling
- `src/lib/ollama-fashion.ts`: local Ollama fallback provider
- `src/lib/fashion-scan.ts`: shared normalized scan result types
- `src/lib/image-data.ts`: shared image data URL validation
- `src/router.tsx`: TanStack Router setup
- `src/start.ts`: TanStack Start middleware
- `src/server.ts`: Cloudflare Worker SSR wrapper and branded error handling
- `src/assets/`: image assets used by the page
- `src/components/ui/`: reusable UI components
- `wrangler.jsonc`: Cloudflare Worker deployment configuration

## Environment Variables

- `GEMINI_API_KEY`: server-only Gemini API key. Required when `AI_PROVIDER=gemini`.
- `AI_PROVIDER`: `gemini` or `local`; defaults to `gemini`.
- `OLLAMA_BASE_URL`: local Ollama base URL for fallback, default `http://localhost:11434`.
- `OLLAMA_VISION_MODEL`: local vision model for fallback, default `qwen2.5vl`.

Never use a `VITE_` prefix for provider secrets. `GEMINI_API_KEY` must only be read by server routes or server functions.

## External Services

Gemini scans are sent from the server route to Google Gemini using the configured API key. Local fallback scans are sent from the server route to Ollama running on the developer machine. Veylor does not store uploaded photos permanently.

Commerce buttons open normal public retailer search URLs. Veylor does not scrape retailers, verify product results, or fabricate product cards.

This repo no longer depends on Lovable-specific Vite packages or project metadata.
