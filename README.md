# KartelKoin Wallet Checker

A Vercel-ready Next.js app that reads wallet addresses from a **GitHub repo file** and displays live Solana + Ethereum balances with stablecoin token holdings — fetched on-chain in real time.

## Setup

### Environment Variables

Create a `.env.local` file in the project root (or set these in the Vercel dashboard):

```env
GITHUB_TOKEN=ghp_YOUR_TOKEN_HERE
GITHUB_REPO=aliffattahfaiz/kartelkoin-wallets
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
ETH_RPC_URL=https://rpc.ankr.com/eth
```

| Variable | Purpose | Default |
|---|---|---|
| `GITHUB_TOKEN` | GitHub PAT with **repo** scope (read/write Contents) | — (required) |
| `GITHUB_REPO` | Owner/repo holding `wallets.json` + `custom-tokens.json` on `main` | `aliffattahfaiz/kartelkoin-wallets` |
| `SOLANA_RPC_URL` | Solana RPC — balance + SPL token accounts | Helius mainnet-beta |
| `ETH_RPC_URL` | Ethereum JSON‑RPC — balance + ERC20 `balanceOf` | Ankr mainnet |

### Create the wallets repo

The checker reads two files from the repo's `main` branch:

**`wallets.json`** — plain array of wallet objects:
```json
[
  { "address": "4z...", "chain": "solana" },
  { "address": "0x...", "chain": "ethereum" }
]
```

Each entry needs only `address` and `chain` — native balances and known stablecoin tokens are fetched on-chain automatically. You can optionally include `tokens` for extra (non-built-in) token holdings:

```json
[
  {
    "address": "4z...",
    "chain": "solana",
    "tokens": [
      { "symbol": "USDG", "name": "USDG", "balance": 1000, "decimals": 6, "valueUsd": 1000 }
    ]
  }
]
```

**`custom-tokens.json`** — created automatically by the Settings panel when you add custom tokens:
```json
{
  "solana": ["USDT", "USDG"],
  "ethereum": ["USDT", "USDE"]
}
```

Manually create the repo and push `wallets.json` first, then add the `GITHUB_TOKEN` and `GITHUB_REPO` env vars.

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

Set all four env vars in the Vercel project dashboard (or via `vercel env add`) before deploying.

## Adding wallets

Edit `wallets.json` in the repo and push. The checker re-reads it on every refresh (raw.githubusercontent.com caches ~5 min, so there's a short delay between push and the change appearing).

Example manual commit:

```bash
git clone https://github.com/aliffattahfaiz/kartelkoin-wallets
cd kartelkoin-wallets
echo '[{"address":"4z...","chain":"solana"}]' > wallets.json
git add wallets.json && git commit -m "add wallet" && git push
```

## Custom tokens (Settings)

In the Settings panel you can type comma-separated token symbols (e.g. `USDT,USDC,USDG`) and add them per chain. They are:
- Shown in each wallet's token list with a ⚠ marker if only stored in `custom-tokens.json` (no on-chain balance yet).
- Persisted to `custom-tokens.json` in the repo via the GitHub Contents API so they survive page reloads.

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
- **Error & empty states** — graceful handling when the GitHub repo is empty or RPC fails

## Architecture

```
src/app/
  page.tsx                       # Client component — UI, state, theme, copy, settings
  page.module.css                # KartelKoin base styles (CSS Module, pure selectors)
  globals.css                    # Glassmorphism + Neon theme overrides
  layout.tsx                     # Root layout, metadata, fonts
  api/wallets/route.ts           # GET — read wallets.json from GitHub + on-chain balances + CoinGecko
  api/custom-tokens/route.ts     # GET/POST — read/write custom-tokens.json via GitHub Contents
```

- The **wallets API** reads the repo file, then fetches native balances and known stablecoin tokens from-chain (Solana JSON‑RPC for balance + SPL token accounts, Ethereum JSON‑RPC for balance + ERC20 `balanceOf`). CoinGecko provides SOL/ETH prices.
- The **custom-tokens API** reads/writes `custom-tokens.json` in the same repo via the GitHub Contents API (requires a PAT with `repo` scope).

## Environment notes

- The GitHub PAT needs **repo** scope (read + write Contents). Create one at https://github.com/settings/tokens.
- `GITHUB_REPO` must exist and have a `main` branch before the first deploy (or the wallets API returns an empty list).
- Public RPC endpoints (Helius mainnet-beta, Ankr) are used by default. For higher rate limits / stability, swap in your own RPC provider URL via env vars.
- CoinGecko's free tier has rate limits (~10‑30 calls/min). If you hit 429s, the price is silently dropped and the USD total falls back to on-chain values only.
- Raw GitHub content (`raw.githubusercontent.com`) is cached by CDNs for a few minutes — wallet list changes aren't instant.
