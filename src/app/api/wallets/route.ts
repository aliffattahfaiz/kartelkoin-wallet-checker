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

async function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

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

// Batch JSON-RPC: sends multiple calls in one HTTP reques...
async function jsonRpcBatch(calls: Array<{ method: string; params: unknown[] }>, url: string): Promise<any[]> {
  const payload = calls.map((c, i) => ({
    jsonrpc: '2.0', id: i, method: c.method, params: c.params
  }));
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json() as Array<{ id: number; result?: any; error?: any }>;
  return data.map(r => {
    if (r.error) throw new Error(`RPC error [${r.id}]: ${r.error.message}`);
    return r.result;
  });
}

// Solana batch: get balances for multiple addresses in ONE call
async function getSolBalancesBatch(addrs: string[]): Promise<Record<string, number>> {
  if (addrs.length === 0) return {};
  try {
    // getMultipleAccounts2022 with 64-bit lamport encoding
    // Use getMultipleAccounts in base64+zstd encoding, or simpler: use the
    // legacy getMultipleAccounts with encoding=jsonParsed
    const result = await jsonRpc('getMultipleAccounts', [
      addrs,
      { encoding: 'jsonParsed' }  // returns { context, value: [{ data: { parsed: { ... } } }] }
    ], SOLANA_RPC);
    const values = result.value || result;
    const out: Record<string, number> = {};
    for (let i = 0; i < addrs.length; i++) {
      const acc = values[i];
      if (!acc || acc === null) {
        out[addrs[i]] = 0;  // account not found — treat as 0 SOL
      } else {
        // Try jsonParsed first
        const lamports = acc.lamports || (acc.data?.parsed?.info?.lamports?.amount ? Number(acc.data.parsed.info.lamports.amount) : null);
        out[addrs[i]] = lamports != null ? lamports / 1e9 : 0;
      }
    }
    return out;
  } catch (e) {
    // Fallback: fetch individually
    const out: Record<string, number> = {};
    await Promise.all(addrs.map(async (addr) => {
      try {
        out[addr] = await getSolBalance(addr);
      } catch {
        out[addr] = 0;
      }
    }));
    return out;
  }
}

// Single-account fallback
async function getSolBalance(addr: string): Promise<number> {
  try {
    const lamports = await jsonRpc('getBalance', [addr], SOLANA_RPC);
    return Number(lamports.value?.lamports ?? lamports) / 1e9;
  } catch { return 0; }
}

// Solana batch: getTokenAccountsByOwner for ALL addresses in one call
// Solana doesn't have a native "getTokenAccountsByOwners" — but we can use
// getProgramAccounts with filters (owner = our addresses) in one call
async function getSolTokenAccountsBatch(addrs: string[]): Promise<Record<string, Array<{ mint: string; amount: bigint; decimals: number }>>> {
  if (addrs.length === 0) return {};
  try {
    // Use getProgramAccounts with filters: memcmp on owner for each address
    // We need to batch this because getProgramAccounts with 61 memcmp filters
    // may hit the filter limit. Split into chunks of 20.
    const CHUNK = 20;
    const out: Record<string, Array<{ mint: string; amount: bigint; decimals: number }>> = {};

    for (let ci = 0; ci < addrs.length; ci += CHUNK) {
      const chunk = addrs.slice(ci, ci + CHUNK);
      const filters = chunk.map((addr, i) => ({
        memcmp: { offset: 32, bytes: addr }
      }));
      filters.unshift({
        memcmp: { offset: 0, bytes: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQUd' }  // program ID filter
      });

      try {
        const result = await jsonRpc('getProgramAccounts', [
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQUd',
          { encoding: 'jsonParsed', filters: filters.slice(1) }  // skip the programID filter, it's redundant
        ], SOLANA_RPC);

        // Process results
        for (const acc of (result || [])) {
          // The owner is at offset 32 in the account data (owner pubkey, 32 bytes)
          // With jsonParsed, we get parsed.info.owner
          const owner = acc.account?.data?.parsed?.info?.owner;
          const mint = acc.account?.data?.parsed?.info?.mint;
          const amount = acc.account?.data?.parsed?.info?.tokenAmount?.amount;
          const decimals = acc.account?.data?.parsed?.info?.tokenAmount?.decimals;
          if (owner && out.hasOwnProperty(owner)) {
            out[owner].push({
              mint: mint,
              amount: BigInt(amount || '0'),
              decimals: decimals || 6,
            });
          }
        }
      } catch {
        // This chunk failed — fall back to per-address for this chunk
        await Promise.all(chunk.map(async (addr) => {
          try {
            out[addr] = await getSolTokenAccounts(addr);
          } catch {
            out[addr] = [];
          }
        }));
      }
    }
    return out;
  } catch (e) {
    // Full fallback
    const out: Record<string, Array<{ mint: string; amount: bigint; decimals: number }>> = {};
    await Promise.all(addrs.map(async (addr) => {
      try {
        out[addr] = await getSolTokenAccounts(addr);
      } catch {
        out[addr] = [];
      }
    }));
    return out;
  }
}

// Single-account token accounts fallback
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

// ── Ethereum on-chain (batched) ───────────────────────────────────────────────────
async function getEthBalancesBatch(addrs: string[]): Promise<Record<string, number>> {
  if (addrs.length === 0) return {};
  try {
    // Batch eth_getBalance calls
    const batch = addrs.map(addr => ({
      method: 'eth_getBalance',
      params: [addr, 'latest'],
    }));
    const results = await jsonRpcBatch(batch, ETH_RPC);
    const out: Record<string, number> = {};
    for (let i = 0; i < addrs.length; i++) {
      try {
        out[addrs[i]] = Number(BigInt(results[i])) / 1e18;
      } catch {
        out[addrs[i]] = 0;
      }
    }
    return out;
  } catch {
    // Fallback: individual
    const out: Record<string, number> = {};
    await Promise.all(addrs.map(async (addr) => {
      try { out[addr] = await getEthBalance(addr); }
      catch { out[addr] = 0; }
    }));
    return out;
  }
}

async function getEthBalance(addr: string): Promise<number> {
  const hex = await jsonRpc('eth_getBalance', [addr, 'latest'], ETH_RPC);
  return Number(BigInt(hex)) / 1e18;
}

// Batch ERC20 balance checks: for each (address, contract) pair, one eth_call
async function getErc20BalancesBatch(addrs: string[], contracts: Record<string, { symbol: string; decimals: number }>): Promise<Record<string, Record<string, number>>> {
  if (addrs.length === 0) return {};
  // Build batch: 50 addresses × 3 contracts = 150 eth_calls in ONE HTTP request
  const entries: Array<{ addr: string; contract: string; decimals: number; symbol: string; method: string; params: unknown[] }> = [];
  for (const addr of addrs) {
    const padded = addr.replace('0x', '').toLowerCase().padStart(40, '0');
    for (const [contract, info] of Object.entries(contracts)) {
      entries.push({
        addr, contract, decimals: info.decimals, symbol: info.symbol,
        method: 'eth_call',
        params: [{ to: contract, data: '0x70a08231' + padded }, 'latest'],
      });
    }
  }

  try {
    const batch = entries.map(e => ({ method: e.method, params: e.params }));
    const results = await jsonRpcBatch(batch, ETH_RPC);
    const out: Record<string, Record<string, number>> = {};
    addrs.forEach(addr => { out[addr] = {}; });
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      try {
        out[e.addr][e.contract] = Number(BigInt(results[i])) / Number(10 ** e.decimals);
      } catch {
        out[e.addr][e.contract] = 0;
      }
    }
    return out;
  } catch {
    // Fallback: individual
    const out: Record<string, Record<string, number>> = {};
    addrs.forEach(addr => { out[addr] = {}; });
    await Promise.all(addrs.map(async (addr) => {
      const padded = addr.replace('0x', '').toLowerCase().padStart(40, '0');
      for (const [contract, info] of Object.entries(contracts)) {
        try {
          out[addr][contract] = await getErc20Balance(addr, contract, info.decimals);
        } catch {
          out[addr][contract] = 0;
        }
      }
    }));
    return out;
  }
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
    let wallets: Array<{ address: string; chain: 'solana' | 'ethereum'; tokens?: any[]; category?: string }> = [];

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

    // 2. Prices (concurrent with on-chain fetches)
    const pricesP = getPrices();

    // 3. Batch on-chain fetches (1 RPC call per chain instead of N)
    const solWallets = walletData.filter(w => w.chain === 'solana');
    const ethWallets = walletData.filter(w => w.chain === 'ethereum');

    const solAddrs = solWallets.map(w => w.address);
    const ethAddrs = ethWallets.map(w => w.address);

    // Fire all batched RPCs in parallel
    const [solBalancesP, solTokenAccountsP, ethBalancesP, ethTokenBalancesP, prices] = await Promise.all([
      getSolBalancesBatch(solAddrs),
      getSolTokenAccountsBatch(solAddrs),
      getEthBalancesBatch(ethAddrs),
      getErc20BalancesBatch(ethAddrs, ETH_STABLECOINS),
      pricesP,
    ]);

    // 4. Build Solana wallet results
    const solResults = solWallets.map((w) => {
      const nativeBal = solBalancesP[w.address] ?? 0;
      const tokenAccs = solTokenAccountsP[w.address] ?? [];

      const knownTokens: Record<string, { symbol: string; decimals: number; balance: number; valueUsd: number }> = {};
      for (const [mint, info] of Object.entries(SOL_STABLECOINS)) {
        const acc = tokenAccs.find(t => t.mint === mint);
        if (acc) {
          const balance = Number(acc.amount) / Number(10 ** info.decimals);
          knownTokens[mint] = { symbol: info.symbol, decimals: info.decimals, balance, valueUsd: balance };
        }
      }

      const memTokens = (w.tokens || [])
        .filter((t: any) => !knownTokens[t.symbol?.toLowerCase()]?.symbol)
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
    });

    // 5. Build Ethereum wallet results
    const ethResults = ethWallets.map((w) => {
      const nativeBal = ethBalancesP[w.address] ?? 0;
      const ethTokenBalances = ethTokenBalancesP[w.address] ?? {};

      const onchainTokens = Object.entries(ETH_STABLECOINS)
        .map(([contract, info]) => {
          const balance = ethTokenBalances[contract] ?? 0;
          if (balance === 0) return null;
          return { symbol: info.symbol, name: info.symbol, balance, decimals: info.decimals, valueUsd: balance };
        })
        .filter(Boolean) as Array<{ symbol: string; name: string; balance: number; decimals: number; valueUsd: number }>;

      const memTokens = (w.tokens || [])
        .filter((t: any) => !onchainTokens.find(o => o.symbol?.toLowerCase() === t.symbol?.toLowerCase()))
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
    });

    const finalWallets = [...solResults, ...ethResults];

    return NextResponse.json({ wallets: finalWallets, prices });
  } catch (err: any) {
    console.error('Wallet fetch error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
