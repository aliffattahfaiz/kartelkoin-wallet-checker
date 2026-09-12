import { NextRequest, NextResponse } from 'next/server';

// ── Config ──────────────────────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'aliffattahfaiz/kartelkoin-wallets';
const BASE_API   = `https://api.github.com/repos/${GITHUB_REPO}`;
const BASE_RAW   = `https://raw.githubusercontent.com/${GITHUB_REPO}/main`;

const SOLANA_RPC  = process.env.SOLANA_RPC_URL  || 'https://api.mainnet-beta.solana.com';
const ETH_RPC     = process.env.ETH_RPC_URL     || 'https://rpc.ankr.com/eth';
const COINGECKO   = 'https://api.coingecko.com/api/v3/simple/price';

// ── Known token lists ───────────────────────────────────────────────────
const SOL_STABLECOINS: Record<string, { symbol: string; decimals: number }> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGKvZEMcoW': { symbol: 'USDC', decimals: 6 },
};

const ETH_STABLECOINS: Record<string, { symbol: string; decimals: number }> = {
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': { symbol: 'USDT', decimals: 6 },
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': { symbol: 'USDC', decimals: 6 },
  '0x0AD208Gd544F4dB1c020995063A3060Ca826C0aB': { symbol: 'USDE', decimals: 6 },
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

async function getFile(path: string, specifySha = false): Promise<{ content: any; sha?: string }> {
  const url = `${BASE_API}/contents${path}?ref=main`;
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json' },
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub contents GET ${path}: ${res.status} ${t}`);
  }
  return res.json();
}

async function putFile(path: string, content: string, sha: string): Promise<void> {
  const res = await fetch(`${BASE_API}/contents${path}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message: `chore: update ${path}`, content: btoa(content), sha, branch: 'main' }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`GitHub contents PUT ${path}: ${res.status} ${t}`);
  }
}

async function getRaw(path: string): Promise<string> {
  const res = await fetch(`${BASE_RAW}${path}`);
  if (!res.ok) throw new Error(`raw.githubusercontent GET ${path}: ${res.status}`);
  return res.text();
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
    return (result as any[]).map((acc: any) => ({
      mint: acc.account.data.parsed.info.mint,
      amount: BigInt(acc.account.data.parsed.info.tokenAmount.amount),
      decimals: acc.account.data.parsed.info.tokenAmount.decimals,
    }));
  } catch { return []; }
}

// ── Ethereum on-chain ───────────────────────────────────────────────────
async function getEthBalance(addr: string): Promise<number> {
  const hex = await jsonRpc('eth_getBalance', [addr, 'latest'], ETH_RPC);
  return Number(BigInt(hex)) / 1e18;
}

async function getErc20Balance(addr: string, contract: string, decimals: number): Promise<number> {
  const padded = addr.replace('0x', '').toLowerCase().padStart(40, '0');
  const data = '0x70a08231' + padded;
  const hex = await jsonRpc('eth_call', [{ to: contract, data }, 'latest'], ETH_RPC);
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
      sol:       data.solana?.usd        ?? 0,
      eth:       data.ethereum?.usd      ?? 0,
      solChange: data.solana?.usd_24h_change  ?? 0,
      ethChange: data.ethereum?.usd_24h_change ?? 0,
    };
  } catch { return { sol: 0, eth: 0, solChange: 0, ethChange: 0 }; }
}

function explorerUrl(addr: string, chain: 'solana' | 'ethereum'): string {
  return chain === 'solana'
    ? `https://solscan.io/account/${addr}`
    : `https://etherscan.io/address/${addr}`;
}

// ── Main handler ────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  try {
    // 1. Read wallets from GitHub
    let wallets: Array<{ address: string; chain: 'solana' | 'ethereum'; tokens?: any[] }> = [];

    try {
      const contents = await getFile('/wallets.json');
      const raw = atob(contents.content);
      const parsed = JSON.parse(raw);
      wallets = Array.isArray(parsed) ? parsed : [];
    } catch (e: any) {
      // File may not exist yet - empty list is fine
      if (e.message?.includes('404')) {
        wallets = [];
      } else {
        throw e;
      }
    }

    // Filter to entries with address + chain
    const walletData = wallets
      .filter((w: any) => w?.address && (w.chain === 'solana' || w.chain === 'ethereum'))
      .map((w: any) => ({
        address: w.address,
        chain: w.chain as 'solana' | 'ethereum',
        category: w.category || 'uncategorized',
        tokens: (w.tokens || []) as any[],
      }));

    if (walletData.length === 0) {
      // Still fetch prices so the UI has them for display
      const prices = await getPrices();
      return NextResponse.json({ wallets: [], prices });
    }

    // 2. Prices
    const prices = await getPrices();

    // 3. On-chain fetch per chain
    const solWallets = walletData.filter(w => w.chain === 'solana');
    const ethWallets = walletData.filter(w => w.chain === 'ethereum');

    const solResults = await Promise.allSettled(
      solWallets.map(async (w) => {
        const [nativeBal, tokenAccs] = await Promise.all([
          getSolBalance(w.address).catch(() => 0),
          getSolTokenAccounts(w.address).catch(() => []),
        ]);

        const knownTokens: Record<string, { symbol: string; decimals: number; balance: number; valueUsd: number }> = {};
        for (const [mint, info] of Object.entries(SOL_STABLECOINS)) {
          const acc = tokenAccs.find(t => t.mint === mint);
          if (acc) {
            const balance = Number(acc.amount) / Number(10 ** info.decimals);
            knownTokens[mint] = { symbol: info.symbol, decimals: info.decimals, balance, valueUsd: balance };
          }
        }

        const memTokens = (w.tokens || [])
          .filter((t: any) => !knownTokens[t.symbol.toLowerCase()]?.symbol)
          .map((t: any) => ({
            symbol: t.symbol || t.symbol?.toUpperCase(),
            name: t.name || t.symbol,
            balance: t.balance || 0,
            decimals: t.decimals || 6,
            valueUsd: t.valueUsd || 0,
          }));

        return {
          address: w.address,
          chain: 'solana' as const,
          category: w.category,
          nativeBalance: nativeBal,
          nativeBalanceUsd: nativeBal * prices.sol,
          tokens: [...Object.values(knownTokens), ...memTokens],
          explorerUrl: explorerUrl(w.address, 'solana'),
        };
      })
    );

    const ethResults = await Promise.allSettled(
      ethWallets.map(async (w) => {
        const [nativeBal, ...ercCalls] = await Promise.all([
          getEthBalance(w.address).catch(() => 0),
          ...Object.entries(ETH_STABLECOINS).map(([contract, info]) =>
            getErc20Balance(w.address, contract, info.decimals).catch(() => 0)
          ),
        ]);

        const onchainTokens = Object.entries(ETH_STABLECOINS)
          .map(([contract, info], i) => {
            const balance = ercCalls[i] as number;
            if (balance === 0) return null;
            return { symbol: info.symbol, name: info.symbol, balance, decimals: info.decimals, valueUsd: balance };
          })
          .filter(Boolean) as Array<{ symbol: string; name: string; balance: number; decimals: number; valueUsd: number }>;

        const memTokens = (w.tokens || [])
          .filter((t: any) => !onchainTokens.find(o => o.symbol.toLowerCase() === t.symbol.toLowerCase()))
          .map((t: any) => ({
            symbol: t.symbol || t.symbol?.toUpperCase(),
            name: t.name || t.symbol,
            balance: t.balance || 0,
            decimals: t.decimals || 6,
            valueUsd: t.valueUsd || 0,
          }));

        return {
          address: w.address,
          chain: 'ethereum' as const,
          category: w.category,
          nativeBalance: nativeBal,
          nativeBalanceUsd: nativeBal * prices.eth,
          tokens: [...onchainTokens, ...memTokens],
          explorerUrl: explorerUrl(w.address, 'ethereum'),
        };
      })
    );

    const finalWallets: any[] = [
      ...solResults.flatMap(r => r.status === 'fulfilled' ? [r.value] : []),
      ...ethResults.flatMap(r => r.status === 'fulfilled' ? [r.value] : []),
    ];

    return NextResponse.json({ wallets: finalWallets, prices });
  } catch (err: any) {
    console.error('Wallet fetch error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
