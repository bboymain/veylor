# Veylor

Veylor is a TanStack Start app for AI-assisted fashion discovery. Users upload an outfit photo,
focus the crop, analyze visible clothing and accessories, review structured fashion details, and
open generated retailer searches for similar styles.

![Veylor preview](./2026-06-26%2015_43_15-.png)

## Current public flow

```text
Upload Photo
-> Preview Image
-> Scan Outfit
-> Review Detected Items
-> Open Similar-Style Searches
```

The production endpoint is `/api/fashion-scan`. It validates the image, sends supported image bytes
to Gemini from the server, validates the structured JSON response with Zod, and returns normalized
fashion data to the browser. `GEMINI_API_KEY` is server-only and must never use a `VITE_` prefix.

The current product does not verify exact product matches, live prices, inventory, or retailer
availability. Retailer buttons open normal public search URLs generated from detected or corrected
fashion details.

## Tech stack

- React 19
- TanStack Start and TanStack Router
- TypeScript and Vite
- Tailwind CSS v4
- Google GenAI SDK
- Zod
- Nitro on Vercel
- Bun package manager

## Local setup

Install dependencies:

```bash
bun install
```

Copy the environment template to an untracked local file:

```powershell
Copy-Item .env.example .env.local
```

Set the server-only key in `.env.local`:

```env
GEMINI_API_KEY=your_real_key_here
```

Start the development server:

```bash
bun run dev
```

Uploaded images are cropped and resized in the browser before scanning and are not saved by Veylor.
Saved scans use browser localStorage only.

## Private local-provider code

The standalone local experiment remains in `src/lib/ollama-fashion.ts` for private development and
unit testing. It is not imported by the page, the production scan endpoint, or any public route. It
has no default endpoint and requires a caller-supplied base URL, model, and invocation path from
untracked local development code.

Production does not read `AI_PROVIDER`, cannot select the local module, and never contacts a local
service.

## Vercel deployment

The app uses the Nitro Vite plugin. Vercel detects the TanStack Start/Nitro build and emits Vercel
Functions without a required `vercel.json` for this project.

In Vercel Project Settings, add `GEMINI_API_KEY` to Production and Preview as appropriate. Do not add
`AI_PROVIDER`, and do not prefix the key with `VITE_`.

Recommended deployment flow:

1. Import `bboymain/veylor` into Vercel.
2. Confirm the detected framework/build command uses `bun run build` (or the repository `build`
   script).
3. Add the server-only `GEMINI_API_KEY` environment variable.
4. Deploy and verify `/api/fashion-scan` with a real image.

## Commands

```bash
bun run dev
bunx tsc --noEmit
bun run lint
bun test
bun run build
```

## Project structure

- `src/routes/index.tsx`: homepage, scanner, results, retailer searches, and Recent Scans UI
- `src/routes/api/fashion-scan.ts`: Gemini-only production scan endpoint
- `src/lib/gemini-fashion.ts`: server-side model schema, prompt, parsing, and error handling
- `src/lib/fashion-scan.ts`: normalized public scan result types
- `src/lib/image-data.ts`: server-side image data URL validation
- `src/lib/image-processing.ts`: browser crop, resize, and thumbnail utilities
- `src/lib/scan-history.ts`: browser-local scan history persistence
- `src/start.ts`: TanStack Start request middleware
- `docs/implementation-roadmap.md`: phased product and implementation roadmap

## Roadmap

See [docs/implementation-roadmap.md](./docs/implementation-roadmap.md) for Phases 1-6. Phase 2 is
documented as a benchmark design only and is not implemented yet.
