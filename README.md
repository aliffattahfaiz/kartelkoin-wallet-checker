# KartelKoin Wallet Checker

A Vercel-ready Next.js app that pulls wallet addresses from Mem0 and displays live Solana + Ethereum balances with stablecoin token holdings — fetched on-chain in real time.

## Setup

### Environment Variables

Create a `.env.local` file in the project root (or set these in the Vercel dashboard):

```env
MEM0_API_URL=http://100.68.105.98:8889
MEM0_API_KEY=m0sk_b8Swg7LkdBHBPH-UG5h6_-zB0xkxSrfEqDzYDIZdzD8
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
ETH_RPC_URL=https://rpc.ankr.com/eth
```

| Variable | Purpose | Default |
|---|---|---|
| `MEM0_API_URL` | Mem0 REST endpoint | `http://100.68.105.98:8889` |
| `MEM0_API_KEY` | Mem0 bearer token | `m0sk_...dzD8` |
| `SOLANA_RPC_URL` | Solana RPC (balance + SPL token accounts) | Helius mainnet-beta |
| `ETH_RPC_URL` | Ethereum JSON‑RPC (balance + ERC20 `balanceOf`) | Ankr mainnet |

### Install

```bash
npm install
```

### Run locally

```bash
npm run dev
```

Open http://localhost:3000.

### Deploy to Vercel

```bash
vercel --prod
```

Make sure all four env vars are set in the Vercel project before deploying.

## Adding wallets

Wallets are stored as Mem0 memories whose `metadata.source` is `kartelkoin` (or unset). The API route filters by this so unrelated memories don't leak into the UI.

Each wallet memory's `text` should be JSON with at least `address` and `chain`:

```json
{
  "address": "4z... or 0x...",
  "chain": "solana",
  "nativeBalance": 2.5,
  "tokens": [
    { "symbol": "USDT", "name": "Tether USD", "balance": 500, "decimals": 6, "valueUsd": 500 }
  ]
}
```

Mem0 insert example:

```bash
curl -X POST http://100.68.105.98:8889/memories \
  -H "Authorization: Bearer m0sk_b...dzD8" \
  -H "Content-Type: application/json" \
  -d '{"text":"{\"address\":\"4z...\",\"chain\":\"solana\"}", "metadata":{"source":"kartelkoin"}}'
```

> **On-chain vs stored**: The app always fetches native balances and known stablecoin tokens directly from-chain. The `nativeBalance` / `tokens` fields in Mem0 are used as **supplements** — for example, token addresses that aren't in the built-in list. User-added custom tokens (via Settings) are persisted in Mem0 under `metadata.source=custom_tokens`.

## Custom tokens (Settings)

In the Settings panel you can type comma-separated token symbols (e.g. `USDT,USDC,USDG`) and add them per chain. They are:
- Shown in each wallet's token list with a ⚠ marker if only stored in Mem0 (no on-chain balance yet).
- Persisted to Mem0 under the `custom_tokens` memory so they survive page reloads.

## Features

- **Live on-chain balances** — SOL / ETH native balance fetched from RPC on every refresh
- **Stablecoin token detection** — built-in list of USDC, USDT, USDE ERC20 contracts and SPL mints; balances read on-chain
- **Portfolio totals** — grouped by Solana and Ethereum, with native + token USD values
- **Live prices** — CoinGecko (free, no key) used for SOL/ETH USD conversion in portfolio total
- **Theme switcher** — KartelKoin dark (default), Glassmorphism, Neon — persisted to localStorage
- **Manual refresh** — button in header
- **Auto-refresh** — toggle in Settings, configurable interval (15 / 30 / 60 min)
- **Copy address** — click any truncated address to copy the full address to clipboard
- **Explorer links** — "View" button opens Solscan (Solana) or Etherscan (Ethereum)
- **Error & empty states** — graceful handling when Mem0 returns nothing or RPC fails

## Architecture

```
src/app/
  page.tsx              # Client component — UI, state, theme, copy, settings
  page.module.css       # KartelKoin base styles (CSS Module, pure selectors)
  globals.css           # Glassmorphism + Neon theme overrides (global selectors OK)
  layout.tsx            # Root layout, metadata, fonts
  api/wallets/route.ts  # GET — fetch Mem0 + on-chain balances + CoinGecko prices
  api/custom-tokens/route.ts  # POST — persist user-added token symbols to Mem0
```

- The **API route** does all the heavy lifting: Mem0 fetch (filtered by source), Solana JSON‑RPC for balance + SPL token accounts, Ethereum JSON‑RPC for balance + ERC20 `balanceOf` calls, and a CoinGecko price fetch.
- The **page** is a client component because it needs React state for theme, settings, copy feedback, and auto-refresh intervals.

## Environment notes

- Public RPC endpoints (Helius mainnet-beta, Ankr) are used by default. For higher rate limits / stability, swap in your own RPC provider URL via env vars.
- CoinGecko's free tier has rate limits (~10‑30 calls/min). If you hit 429s, the price is silently dropped and the USD total falls back to on-chain values only.
- Mem0 must be reachable from the Vercel runtime (not localhost-only) — if Mem0 sits behind Tailscale, expose it or use a tunnel.
