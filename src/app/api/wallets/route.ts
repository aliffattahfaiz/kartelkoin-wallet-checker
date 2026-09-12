import { NextRequest, NextResponse } from 'next/server';

// ── Config ──────────────────────────────────────────────────────────────
const MEM0_API_URL = process.env.MEM0_API_URL || 'http://100.68.105.98:8889';
const MEM0_API_KEY = process.env.MEM0_API_KEY || 'm0sk_b8Swg7LkdBHBPH-UG5h6_-zB0xkxSrfEqDzYDIZdzD8';
const SOLANA_RPC  = process.env.SOLANA_RPC_URL  || 'https://api.mainnet-beta.solana.com';
const ETH_RPC     = process.env.ETH_RPC_URL     || 'https://rpc.ankr.com/eth';
const COINGECKO   = 'https://api.coingecko.com/api/v3/simple/price';

// ── Known stablecoin mints / contracts ──────────────────────────────────
const SOL_STABLECOINS: Record<string, { symbol: string; decimals: number }> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGKvZEMcoW': { symbol: 'USDC', decimals: 6 },
  // USDT on Solana (Tether): add if needed
  // 'Es9vMFrGZr5uPsEqZJTnX7Ab1LE8g3QGDy2xAKFS4d9': { symbol: 'USDT', decimals: 6 },
};

const ETH_STABLECOINS: Record<string, { symbol: string; decimals: number }> = {
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': { symbol: 'USDT', decimals: 6 },
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': { symbol: 'USDC', decimals: 6 },
  '0x0AD208Gd544F4dB1c020995063A3060Ca826C0aB': { symbol: 'USDE', decimals: 6 }, // Ethena USDE (mainnet)
};

// ── Helpers ─────────────────────────────────────────────────────────────
function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

async function jsonRpc(method: string, params: unknown[], url: string): Promise<any> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) throw new Error(`RPC error [${method}]: ${data.error.message}`);
  return data.result;
}

// ── Solana on-chain ─────────────────────────────────────────────────────
async function getSolBalance(addr: string): Promise<number> {
  const lamports = await jsonRpc('getBalance', [addr], SOLANA_RPC);
  return Number(lamports) / 1e9;
}

async function getSolTokenAccounts(addr: string): Promise<
  Array<{ mint: string; amount: bigint; decimals: number }>
> {
  try {
    const result = await jsonRpc('getTokenAccountsByOwner', [
      addr,
      { programId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQUd' },
      { encoding: 'jsonParsed' },
    ], SOLANA_RPC);

    return (result as any[]).map((acc: any) => {
      const mint = acc.account.data.parsed.info.mint;
      const amount = BigInt(acc.account.data.parsed.info.tokenAmount.amount);
      const decimals = acc.account.data.parsed.info.tokenAmount.decimals;
      return { mint, amount, decimals };
    });
  } catch {
    // Some public RPCs don't support jsonParsed — fall back to raw
    return [];
  }
}

// ── Ethereum on-chain ───────────────────────────────────────────────────
async function getEthBalance(addr: string): Promise<number> {
  const hex = await jsonRpc('eth_getBalance', [addr, 'latest'], ETH_RPC);
  return Number(BigInt(hex)) / 1e18;
}

async function getErc20Balance(addr: string, contract: string, decimals: number): Promise<number> {
  const data = '0x70a08231' + addr.replace('0x', '').toLowerCase().padStart(64, '0');
  const hex = await jsonRpc('eth_call', [
    { to: contract, data },
    'latest',
  ], ETH_RPC);
  return Number(BigInt(hex)) / Number(10 ** decimals);
}

// ── Prices ──────────────────────────────────────────────────────────────
async function getPrices(): Promise<{ sol: number; eth: number; solChange: number; ethChange: number }> {
  try {
    const res = await fetch(
      `${COINGECKO}?ids=solana,ethereum&vs_currencies=usd&include_24hr_change=true`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    return {
      sol:      data.solana?.usd      ?? 0,
      eth:      data.ethereum?.usd    ?? 0,
      solChange: data.solana?.usd_24h_change ?? 0,
      ethChange: data.ethereum?.usd_24h_change ?? 0,
    };
  } catch {
    return { sol: 0, eth: 0, solChange: 0, ethChange: 0 };
  }
}

// ── Explorer URLs ───────────────────────────────────────────────────────
function explorerUrl(addr: string, chain: 'solana' | 'ethereum'): string {
  return chain === 'solana'
    ? `https://solscan.io/token/${addr}`
    : `https://etherscan.io/address/${addr}`;
}

// ── Main handler ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    // 1. Fetch wallets from Mem0, filtered by metadata.source
    const url = new URL(req.url);
    const filterSource = url.searchParams.get('source') || 'kartelkoin';

    const memRes = await fetch(`${MEM0_API_URL}/memories`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${MEM0_API_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!memRes.ok) {
      const errText = await memRes.text();
      console.error('Mem0 API error:', memRes.status, errText);
      return NextResponse.json(
        { error: 'Failed to fetch from Mem0', details: errText },
        { status: memRes.status }
      );
    }

    const memData = await memRes.json();
    const memories = memData.memories || [];

    // Filter: only memories whose metadata.source matches (or all if no filter)
    const filtered = filterSource
      ? memories.filter((m: any) =>
          m.metadata?.source === filterSource ||
          m.metadata?.source === 'kartelkoin_wallets' ||
          !m.metadata?.source
        )
      : memories;

    // Parse wallet addresses
    const walletData = filtered
      .map((m: any) => { try { return JSON.parse(m.text); } catch { return null; } })
      .filter((w: any) => w?.address && w?.chain) as Array<{
        address: string;
        chain: 'solana' | 'ethereum';
        nativeBalance?: number;
        tokens?: Array<{ symbol: string; name: string; balance: number; decimals: number; valueUsd: number }>;
      }>;

    if (walletData.length === 0) {
      return NextResponse.json({ wallets: [], prices: null });
    }

    // 2. Get prices
    const prices = await getPrices();

    // 3. Fetch on-chain balances in parallel per chain
    const solWallets = walletData.filter(w => w.chain === 'solana');
    const ethWallets = walletData.filter(w => w.chain === 'ethereum');

    // Solana: native + SPL tokens
    const solResults = await Promise.allSettled(
      solWallets.map(async (w) => {
        const [nativeBal, tokenAccs] = await Promise.all([
          getSolBalance(w.address).catch(() => 0),
          getSolTokenAccounts(w.address).catch(() => []),
        ]);

        // Match against known stablecoins + any tokens already in Mem0 data
        const knownTokens: Record<string, { symbol: string; decimals: number; valueUsd: number }> = {};

        // From known list
        for (const [mint, info] of Object.entries(SOL_STABLECOINS)) {
          const acc = tokenAccs.find(t => t.mint === mint);
          if (acc) {
            const balance = Number(acc.amount) / Number(10 ** info.decimals);
            const valueUsd = balance * prices.sol; // placeholder — stablecoins ≈ $1
            knownTokens[mint] = { symbol: info.symbol, decimals: info.decimals, valueUsd: balance * 1.0 };
          }
        }

        // From Mem0 data (user-stored tokens)
        const memTokens: Record<string, any> = {};
        (w.tokens || []).forEach((t: any) => { memTokens[t.symbol] = t; });

        // Merge: on-chain known + Mem0 stored
        const allTokens = [
          ...Object.entries(knownTokens).map(([mint, t]) => ({
            symbol: t.symbol,
            name: t.symbol,
            balance: t.valueUsd, // approx (stablecoin ≈ $1)
            decimals: t.decimals,
            valueUsd: t.valueUsd,
            source: 'onchain' as const,
          })),
          ...Object.values(memTokens).map((t: any) => ({
            symbol: t.symbol,
            name: t.name || t.symbol,
            balance: t.balance || 0,
            decimals: t.decimals || 6,
            valueUsd: t.valueUsd || 0,
            source: 'mem0' as const,
          })),
        ];

        return {
          address: w.address,
          chain: 'solana' as const,
          nativeBalance: nativeBal,
          nativeBalanceUsd: nativeBal * prices.sol,
          tokens: allTokens,
          explorerUrl: explorerUrl(w.address, 'solana'),
        };
      })
    );

    // Ethereum: native + ERC20 tokens
    const ethResults = await Promise.allSettled(
      ethWallets.map(async (w) => {
        const [nativeBal, ...ercCalls] = await Promise.all([
          getEthBalance(w.address).catch(() => 0),
          ...Object.entries(ETH_STABLECOINS).map(([contract, info]) =>
            getErc20Balance(w.address, contract, info.decimals).catch(() => 0)
          ),
        ]);

        const tokens = Object.entries(ETH_STABLECOINS)
          .map(([contract, info], i) => {
            const balance = ercCalls[i] as number;
            if (balance === 0) return null;
            return {
              symbol: info.symbol,
              name: info.symbol,
              balance,
              decimals: info.decimals,
              valueUsd: balance * 1.0, // stablecoin ≈ $1
              source: 'onchain' as const,
            };
          })
          .filter(Boolean);

        // Merge with Mem0 stored tokens
        const memTokens = (w.tokens || []).map((t: any) => ({
          symbol: t.symbol,
          name: t.name || t.symbol,
          balance: t.balance || 0,
          decimals: t.decimals || 6,
          valueUsd: t.valueUsd || 0,
          source: 'mem0' as const,
        }));

        return {
          address: w.address,
          chain: 'ethereum' as const,
          nativeBalance: nativeBal,
          nativeBalanceUsd: nativeBal * prices.eth,
          tokens: [...tokens, ...memTokens],
          explorerUrl: explorerUrl(w.address, 'ethereum'),
        };
      })
    );

    // 4. Build response
    const wallets = [
      ...solResults.flatMap(r => r.status === 'fulfilled' ? [r.value] : []),
      ...ethResults.flatMap(r => r.status === 'fulfilled' ? [r.value] : []),
    ];

    return NextResponse.json({ wallets, prices });
  } catch (err: any) {
    console.error('Wallet fetch error:', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
