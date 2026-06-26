# Veylor

Veylor is a TanStack Start React app for an AI fashion discovery experience. It uses Vite, TanStack Router, Tailwind CSS, and Cloudflare Workers configuration.

## Tech Stack

- React 19
- TanStack Start and TanStack Router
- Vite
- Tailwind CSS v4
- shadcn-style UI components
- Bun package manager
- Cloudflare Workers via Wrangler

## Local Setup

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

## Project Structure

- `src/routes/__root.tsx`: root route, document shell, metadata, global providers
- `src/routes/index.tsx`: main Veylor page
- `src/router.tsx`: TanStack Router setup
- `src/start.ts`: TanStack Start middleware
- `src/server.ts`: Cloudflare Worker SSR wrapper and branded error handling
- `src/assets/`: image assets used by the page
- `src/components/ui/`: reusable UI components
- `wrangler.jsonc`: Cloudflare Worker deployment configuration

## Environment Variables

No required environment variables were found in the current codebase.

For future client-side variables, use the `VITE_` prefix and document them in `.env.example`. For Cloudflare local-only secrets, use `.dev.vars`; it is ignored by git.

## External Services

The repository is configured for Cloudflare Workers deployment with Wrangler. To deploy, configure Cloudflare account access locally or in CI, then run the production build and deploy with Wrangler.

This repo no longer depends on Lovable-specific Vite packages or project metadata.
