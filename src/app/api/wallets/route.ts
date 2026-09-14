import { NextRequest, NextResponse } from 'next/server';

// ── Config ──────────────────────────────────────────────────────────────
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO  = process.env.GITHUB_REPO || 'aliffattahfaiz/kartelkoin-wallets';
const BASE_API   = `https://api.github.com/repos/${GITHUB_REPO}`;
const BASE_RAW   = `https://raw.githubusercontent.com/${GITHUB_REPO}/main`;

const SOLANA_RPC  = process.env.SOLANA_RPC_URL  || 'https://api.mainnet-beta.solana.com';
const ETH_RPC     = process.env.ETH_RPC_URL     || 'https://ethereum-rpc.publicnode.com';
const COINGECKO   = 'https://api.coingecko.com/api/v3/simple/price';
const COINGECKO_MARKET_CHART = 'https://api.coingecko.com/api/v3/coins';

// ── Known token lists ───────────────────────────────────────────────────
const SOL_STABLECOINS: Record<string, { symbol: string; decimals: number; coingeckoId: string }> = {
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGKvZEMcoW': { symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
};

const ETH_STABLECOINS: Record<string, { symbol: string; decimals: number; coingeckoId: string }> = {
  '0xdAC17F958D2ee523a2206206994597C13D831ec7': { symbol: 'USDT', decimals: 6, coingeckoId: 'tether' },
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48': { symbol: 'USDC', decimals: 6, coingeckoId: 'usd-coin' },
  '0x0AD208Gd544F4dB1c020995063A3060Ca826C0aB': { symbol: 'USDE', decimals: 6, coingeckoId: 'usd-e' },
};

// Coins we fetch prices for
const COIN_IDS = ['solana', 'ethereum', 'bitcoin', 'tether', 'usd-coin', 'usd-e'];
const VS_CURRENCIES = ['usd', 'eur', 'idr', 'jpy', 'gbp'];
const SPARKLINE_COINS = ['bitcoin', 'ethereum', 'solana'];

// ── Helpers ─────────────────────────────────────────────────────────────

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

async function getFile(path: string): Promise<{ content: any; sha?: string }> {
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

// ── On-chain fetchers (batched) ───────────────────────────────────────

async function getSolBalancesBatch(addrs: string[]): Promise<Record<string, number>> {
  if (addrs.length === 0) return {};
  const out: Record<string, number> = {};

  // Chunk addresses to avoid RPC limits (max ~50 per call)
  const CHUNK = 40;
  for (let i = 0; i < addrs.length; i += CHUNK) {
    const chunkAddrs = addrs.slice(i, i + CHUNK);
    let retries = 0;
    while (retries < 3) {
      try {
        const result = await jsonRpc('getMultipleAccounts', [
          chunkAddrs,
          { encoding: 'jsonParsed' }
        ], SOLANA_RPC);
        const values = result.value || result;
        for (let j = 0; j < chunkAddrs.length; j++) {
          const acc = values[j];
          if (!acc || acc === null) {
            out[chunkAddrs[j]] = 0;
          } else {
            const lamports = acc.lamports || (acc.data?.parsed?.info?.lamports?.amount ? Number(acc.data.parsed.info.lamports.amount) : null);
            out[chunkAddrs[j]] = lamports != null ? lamports / 1e9 : 0;
          }
        }
        break; // success, move to next chunk
      } catch {
        retries++;
        if (retries >= 3) {
          // Fall back to individual balance fetch
          await Promise.all(chunkAddrs.map(async (addr) => {
            try { out[addr] = await getSolBalance(addr); }
            catch { out[addr] = 0; }
          }));
        } else {
          await new Promise(r => setTimeout(r, 200 * retries));
        }
      }
    }
  }
  return out;
}

async function getSolBalance(addr: string): Promise<number> {
  try {
    const lamports = await jsonRpc('getBalance', [addr], SOLANA_RPC);
    return Number(lamports.value?.lamports ?? lamports) / 1e9;
  } catch { return 0; }
}

async function getSolTokenAccountsBatch(addrs: string[]): Promise<Record<string, Array<{ mint: string; amount: bigint; decimals: number }>>> {
  if (addrs.length === 0) return {};
  const CHUNK = 20;
  const out: Record<string, Array<{ mint: string; amount: bigint; decimals: number }>> = {};

  for (let ci = 0; ci < addrs.length; ci += CHUNK) {
    const chunk = addrs.slice(ci, ci + CHUNK);
    const filters = chunk.map((addr) => ({ memcmp: { offset: 32, bytes: addr } }));

    try {
      const result = await jsonRpc('getProgramAccounts', [
        'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQUd',
        { encoding: 'jsonParsed', filters }
      ], SOLANA_RPC);

      for (const acc of (result || [])) {
        const owner = acc.account?.data?.parsed?.info?.owner;
        const mint = acc.account?.data?.parsed?.info?.mint;
        const amount = acc.account?.data?.parsed?.info?.tokenAmount?.amount;
        const decimals = acc.account?.data?.parsed?.info?.tokenAmount?.decimals;
        if (owner && (out[owner] ||= []).length >= 0) {
          out[owner].push({
            mint: mint,
            amount: BigInt(amount || '0'),
            decimals: decimals || 6,
          });
        }
      }
    } catch {
      await Promise.all(chunk.map(async (addr) => {
        try { out[addr] = await getSolTokenAccounts(addr); }
        catch { out[addr] = []; }
      }));
    }
  }
  return out;
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

// ── Ethereum on-chain (batched) ─────────────────────────────────

async function getEthBalancesBatch(addrs: string[]): Promise<Record<string, number>> {
  if (addrs.length === 0) return {};
  try {
    const batch = addrs.map(addr => ({
      method: 'eth_getBalance',
      params: [addr, 'latest'],
    }));
    const results = await jsonRpcBatch(batch, ETH_RPC);
    const out: Record<string, number> = {};
    for (let i = 0; i < addrs.length; i++) {
      try { out[addrs[i]] = Number(BigInt(results[i])) / 1e18; }
      catch { out[addrs[i]] = 0; }
    }
    return out;
  } catch {
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

async function getErc20BalancesBatch(addrs: string[], contracts: Record<string, { symbol: string; decimals: number; coingeckoId: string }>): Promise<Record<string, Record<string, number>>> {
  if (addrs.length === 0) return {};
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
      try { out[e.addr][e.contract] = Number(BigInt(results[i])) / Number(10 ** e.decimals); }
      catch { out[e.addr][e.contract] = 0; }
    }
    return out;
  } catch {
    const out: Record<string, Record<string, number>> = {};
    addrs.forEach(addr => { out[addr] = {}; });
    await Promise.all(addrs.map(async (addr) => {
      const padded = addr.replace('0x', '').toLowerCase().padStart(40, '0');
      for (const [contract, info] of Object.entries(contracts)) {
        try { out[addr][contract] = await getErc20Balance(addr, contract, info.decimals); }
        catch { out[addr][contract] = 0; }
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
async function getCoinGeckoPrices(): Promise<Record<string, Record<string, number>>> {
  try {
    const ids = COIN_IDS.join(',');
    const vs = VS_CURRENCIES.join(',');
    const res = await fetch(
      `${COINGECKO}?ids=${ids}&vs_currencies=${vs}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    return data;
  } catch { return {}; }
}

// Fetch 24h price history (sparkline) for a list of coins
async function getSparklineData(coins: string[]): Promise<Record<string, number[]> | null> {
  try {
    const results = await Promise.all(
      coins.map(async (id) => {
        const res = await fetch(
          `${COINGECKO_MARKET_CHART}/${id}/market_chart?vs_currency=usd&days=1`,
          { signal: AbortSignal.timeout(8000) }
        );
        const data = await res.json();
        return { id, prices: data.prices?.map((p: [number, number]) => p[1]) || [] };
      })
    );
    return Object.fromEntries(results.map(r => [r.id, r.prices]));
  } catch { return null; }
}

// ── Explorer URLs ───────────────────────────────────────────────────────
function explorerUrl(addr: string, chain: 'solana' | 'ethereum'): string {
  return chain === 'solana'
    ? `https://solscan.io/account/${addr}`
    : `https://etherscan.io/address/${addr}`;
}

// ── Transaction types ────────────────────────────────────────────────────
type Transaction = {
  signature: string;
  chain: 'solana' | 'ethereum';
  address: string;  // wallet address (for nickname lookup)
  timestamp: number; // unix timestamp
  direction: 'in' | 'out';
  amount: number;    // SOL / ETH
  symbol: string;    // 'SOL' | 'ETH'
  counterpart: string | null; // from (for out) or to (for in) address
  isFee: boolean;    // whether this was a fee payment
};

// ── Solana transactions ───────────────────────────────────────────────────
async function getSolTransactionsBatch(addrs: string[], limit = 3): Promise<Transaction[]> {
  if (addrs.length === 0) return [];

  // Limit to first 15 addresses to stay within Vercel's 10s timeout
  const priorityAddrs = addrs.slice(0, 15);

  // Collect signatures for all addresses — process in small sequential chunks
  // to avoid rate-limiting on the public Solana RPC.
  const sigsPerAddr: Array<{ signature: string; blockTime: number | null; addr: string }> = [];
  const CHUNK = 15;  // Process all 15 addresses in parallel
  for (let i = 0; i < priorityAddrs.length; i += CHUNK) {
    const chunk = priorityAddrs.slice(i, i + CHUNK);
    const batch = await Promise.all(
      chunk.map(async (addr): Promise<Array<{ signature: string; blockTime: number | null; addr: string }>> => {
        let retries = 0;
        while (retries < 2) {
          try {
            const result = await jsonRpc('getSignaturesForAddress', [addr, { limit: limit * 3 }], SOLANA_RPC);
            const seen = new Set<string>();
            const out: Array<{ signature: string; blockTime: number | null; addr: string }> = [];
            for (const s of (result || [])) {
              if (s.signature && !seen.has(s.signature)) {
                seen.add(s.signature);
                out.push({ signature: s.signature, blockTime: s.blockTime, addr });
                if (out.length >= limit) break;
              }
            }
            return out;
          } catch (err) {
            retries++;
            if (retries >= 2) return [];
            await new Promise(r => setTimeout(r, 100 * retries));
          }
        }
        return [];
      })
    );
    sigsPerAddr.push(...batch.flat());
  }

  // Flatten all signatures
  if (sigsPerAddr.length === 0) return [];

  // Fetch transaction details — chunked to avoid overwhelming RPC
  const CHUNK_SIZE = 10;
  const txResults: Array<{ s: typeof sigsPerAddr[0]; tx: any | null }> = [];
  for (let i = 0; i < sigsPerAddr.length; i += CHUNK_SIZE) {
    const chunk = sigsPerAddr.slice(i, i + CHUNK_SIZE);
    const batch = await Promise.all(
      chunk.map(async (s) => {
        let retries = 0;
        while (retries < 3) {
          try {
            const tx = await jsonRpc('getTransaction', [s.signature, { maxSupportedTransactionHistory: 0, encoding: 'jsonParsed' }], SOLANA_RPC);
            return { s, tx };
          } catch (err) {
            retries++;
            if (retries >= 3) return { s, tx: null };
            await new Promise(r => setTimeout(r, 200 * retries));
          }
        }
        return { s, tx: null };
      })
    );
    txResults.push(...batch);
  }

  const out: Transaction[] = [];
  for (const { s, tx } of txResults) {
    if (!tx || !tx.meta) continue;
    const blockTime = s.blockTime ?? tx.blockTime ?? 0;
    const walletAddr = s.addr;

    // Parse SOL transfers from transfer instructions
    for (const instr of (tx.transaction?.message?.instructions || [])) {
      const parsed = instr.parsed;
      if (!parsed || parsed.type !== 'transfer') continue;
      const info = parsed.info || {};
      const from = info.source as string | undefined;
      const to = info.destination as string | undefined;
      const lamports = info.lamports as string | number | undefined;

      const isFrom = from === walletAddr;
      const isTo = to === walletAddr;
      if (!isFrom && !isTo) continue;

      const amount = Number(lamports) / 1e9;
      if (amount <= 0) continue;

      out.push({
        signature: s.signature,
        chain: 'solana',
        address: walletAddr,
        timestamp: blockTime * 1000,
        direction: isTo && !isFrom ? 'in' : 'out',
        amount,
        symbol: 'SOL',
        counterpart: (isTo && !isFrom ? from : to) ?? null,
        isFee: false,
      });
    }

    // Detect fee payments
    try {
      const fee = Number(tx.meta.fee) / 1e9;
      if (fee > 0) {
        out.push({
          signature: s.signature,
          chain: 'solana',
          address: walletAddr,
          timestamp: blockTime * 1000,
          direction: 'out',
          amount: fee,
          symbol: 'SOL',
          counterpart: 'network_fee',
          isFee: true,
        });
      }
    } catch {}
  }

  return out.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit * addrs.length);
}

// ── Ethereum transactions (scan recent blocks) ──────────────────────────
async function getEthTransactionsBatch(addrs: string[], limit = 20): Promise<Transaction[]> {
  if (addrs.length === 0) return [];

  const addrSet = new Set(addrs.map(a => a.toLowerCase()));
  const txs: Transaction[] = [];

  try {
    const block = await jsonRpc('eth_getBlockByNumber', ['latest', true], ETH_RPC);

    // Scan last ~20 blocks (parallelized to avoid timeout)
    const scanDepth = 20;
    const startBlock = parseInt(block.number || '0x0', 16);

    const blockNums: number[] = [];
    for (let i = 0; i < scanDepth; i++) {
      const blkNum = startBlock - i;
      if (blkNum < 0) break;
      blockNums.push(blkNum);
    }

    // Process blocks in parallel chunks
    const CHUNK = 10;
    for (let i = 0; i < blockNums.length; i += CHUNK) {
      const chunk = blockNums.slice(i, i + CHUNK);
      await Promise.all(chunk.map(async (blkNum) => {
        const blk = await jsonRpc('eth_getBlockByNumber', ['0x' + blkNum.toString(16), true], ETH_RPC);
        if (!blk || !blk.transactions) return;
        const blkTs = Number(blk.timestamp || '0');

        for (const tx of blk.transactions) {
          const from = (tx.from || '').toLowerCase();
          const to = (tx.to || '').toLowerCase();
          const isFrom = addrSet.has(from);
          const isTo = addrSet.has(to);
          const isContractCreation = !to;
          if (!isFrom && !isTo) continue;

          let amount = 0;
          try { amount = Number(BigInt(tx.value || '0x0')) / 1e18; } catch { amount = 0; }
          if (amount <= 0) continue;

          const walletAddr = isFrom ? tx.from : addrs.find(a => a.toLowerCase() === to) || '';
          txs.push({
            signature: tx.hash,
            chain: 'ethereum',
            address: walletAddr || tx.from,
            timestamp: blkTs * 1000,
            direction: isTo && !isFrom && !isContractCreation ? 'in' : 'out',
            amount,
            symbol: 'ETH',
            counterpart: (isTo && !isFrom ? tx.from : to) || null,
            isFee: false,
          });
        }
      }));
    }
  } catch {
    // If block scanning fails, return empty
  }

  return txs.sort((a, b) => b.timestamp - a.timestamp).slice(0, limit * addrs.length);
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
      if (e.message?.includes('404')) { wallets = []; }
      else { throw e; }
    }

    const walletData = wallets
      .filter((w: any) => w?.address && (w.chain === 'solana' || w.chain === 'ethereum'))
      .map((w: any) => ({
        address: w.address,
        chain: w.chain as 'solana' | 'ethereum',
        category: w.category || 'uncategorized',
        tokens: (w.tokens || []) as any[],
      }));

    if (walletData.length === 0) {
      const prices = await getCoinGeckoPrices();
      const sparklines = await getSparklineData(SPARKLINE_COINS);
      return NextResponse.json({ wallets: [], prices, sparklines });
    }

    // 2. Fetch all prices (multi-currency) concurrently with on-chain fetches
    const pricesP = getCoinGeckoPrices();
    const sparklinesP = getSparklineData(SPARKLINE_COINS);

    const solWallets = walletData.filter(w => w.chain === 'solana');
    const ethWallets = walletData.filter(w => w.chain === 'ethereum');

    const solAddrs = solWallets.map(w => w.address);
    const ethAddrs = ethWallets.map(w => w.address);

    // 3. Batch on-chain fetches (balances + transactions)
    const [solBalancesP, solTokenAccountsP, ethBalancesP, ethTokenBalancesP, prices, sparklines, solTxsP, ethTxsP] = await Promise.all([
      getSolBalancesBatch(solAddrs),
      getSolTokenAccountsBatch(solAddrs),
      getEthBalancesBatch(ethAddrs),
      getErc20BalancesBatch(ethAddrs, ETH_STABLECOINS),
      pricesP,
      sparklinesP,
      getSolTransactionsBatch(solAddrs),
      getEthTransactionsBatch(ethAddrs),
    ]);

    // 4. Build Solana wallet results
    const solResults = solWallets.map((w) => {
      const nativeBal = solBalancesP[w.address] ?? 0;
      const tokenAccs = solTokenAccountsP[w.address] ?? [];

      const knownTokens: Record<string, { symbol: string; decimals: number; balance: number; valueUsd: number; coingeckoId: string }> = {};
      for (const [mint, info] of Object.entries(SOL_STABLECOINS)) {
        const acc = tokenAccs.find(t => t.mint === mint);
        if (acc) {
          const balance = Number(acc.amount) / Number(10 ** info.decimals);
          const priceUsd = prices[info.coingeckoId]?.usd ?? 1;
          knownTokens[mint] = { symbol: info.symbol, decimals: info.decimals, balance, valueUsd: balance * priceUsd, coingeckoId: info.coingeckoId };
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
          source: 'user' as const,
        }));

      // Count NFTs from token accounts (amount=1, decimals=0, not a known stablecoin)
      const nftCount = tokenAccs.filter(t => {
        const balance = Number(t.amount);
        const isStablecoin = Object.keys(SOL_STABLECOINS).includes(t.mint);
        return balance === 1 && (t.decimals === 0) && !isStablecoin;
      }).length;

      const nativeUsd = nativeBal * (prices.solana?.usd ?? 0);
      const solChange = sparklines?.solana ? (sparklines.solana[sparklines.solana.length - 1] - sparklines.solana[0]) / sparklines.solana[0] : 0;

      return {
        address: w.address,
        chain: 'solana' as const,
        category: w.category,
        nativeBalance: nativeBal,
        nativeBalanceUsd: nativeUsd,
        nativeUsd24hAgo: nativeBal * (prices.solana?.usd ?? 0) / (1 + solChange || 1),
        tokens: [...Object.values(knownTokens), ...memTokens],
        nftCount,
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
          const priceUsd = prices[info.coingeckoId]?.usd ?? 1;
          return {
            symbol: info.symbol,
            name: info.symbol,
            balance,
            decimals: info.decimals,
            valueUsd: balance * priceUsd,
            coingeckoId: info.coingeckoId,
            source: 'onchain' as const,
          };
        })
        .filter(Boolean) as Array<{ symbol: string; name: string; balance: number; decimals: number; valueUsd: number; coingeckoId: string; source: string; }>;

      const memTokens = (w.tokens || [])
        .filter((t: any) => !onchainTokens.find(o => o.symbol?.toLowerCase() === t.symbol?.toLowerCase()))
        .map((t: any) => ({
          symbol: t.symbol || t.symbol?.toUpperCase(),
          name: t.name || t.symbol,
          balance: t.balance || 0,
          decimals: t.decimals || 6,
          valueUsd: t.valueUsd || 0,
          source: 'user' as const,
        }));

      const nativeUsd = nativeBal * (prices.ethereum?.usd ?? 0);
      const ethChange = sparklines?.ethereum ? (sparklines.ethereum[sparklines.ethereum.length - 1] - sparklines.ethereum[0]) / sparklines.ethereum[0] : 0;

      return {
        address: w.address,
        chain: 'ethereum' as const,
        category: w.category,
        nativeBalance: nativeBal,
        nativeBalanceUsd: nativeUsd,
        nativeUsd24hAgo: nativeBal * (prices.ethereum?.usd ?? 0) / (1 + ethChange || 1),
        tokens: [...onchainTokens, ...memTokens],
        nftCount: 0, // ETH NFT count requires Alchemy/Moralis API — placeholder
        explorerUrl: explorerUrl(w.address, 'ethereum'),
      };
    });

    const finalWallets = [...solResults, ...ethResults];
    return NextResponse.json({ wallets: finalWallets, prices, sparklines });
  } catch (err: any) {
    console.error('Wallet fetch error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
