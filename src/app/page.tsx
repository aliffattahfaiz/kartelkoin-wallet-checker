'use client';

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'motion/react';
import {
  Wallet,
  Copy,
  Check,
  Eye,
  RefreshCw,
  Settings,
  X,
  AlertCircle,
  Coins,
  ChevronDown,
  Plus,
  Globe,
  Pencil,
  Sparkles,
} from 'lucide-react';
import styles from './page.module.css';

// ── Types ───────────────────────────────────────────────────────────────
interface TokenHolding {
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  valueUsd: number;
  coingeckoId?: string;
  source?: 'onchain' | 'mem0' | 'user';
}

interface Wallet {
  address: string;
  chain: 'solana' | 'ethereum';
  nativeBalance: number;
  nativeBalanceUsd: number;
  nativeUsd24hAgo?: number;
  tokens: TokenHolding[];
  nftCount?: number;
  explorerUrl: string;
  category?: string;
}

// Multi-currency prices: { solana: {usd,eur,idr,...}, ethereum: {...}, tether: {...}, ... }
type PriceMap = Record<string, Record<string, number>>;
type Currency = 'usd' | 'eur' | 'idr' | 'jpy' | 'gbp';

interface ApiResponse {
  wallets: Wallet[];
  prices: PriceMap;
  sparklines: Record<string, number[]>;
}

// ── Theme & Currency ────────────────────────────────────────────────────
type Theme = 'dark' | 'anvil' | 'glass';
const THEMES: Theme[] = ['dark', 'anvil', 'glass'];

const CURRENCIES: { key: Currency; label: string; symbol: string; icon: any }[] = [
  { key: 'usd', label: 'USD', symbol: '$', icon: Globe },
  { key: 'eur', label: 'EUR', symbol: '€', icon: Globe },
  { key: 'idr', label: 'IDR', symbol: 'Rp', icon: Globe },
  { key: 'jpy', label: 'JPY', symbol: '¥', icon: Globe },
  { key: 'gbp', label: 'GBP', symbol: '£', icon: Globe },
];

const usePersistedTheme = (): [Theme, (t: Theme) => void] => {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = localStorage.getItem('kc-theme') as Theme | null;
    return stored && THEMES.includes(stored) ? stored : 'dark';
  });
  const setPersisted = useCallback((t: Theme) => {
    setTheme(t);
    localStorage.setItem('kc-theme', t);
    document.documentElement.setAttribute('data-theme', t);
  }, []);
  // Apply saved theme on mount
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);
  return [theme, setPersisted];
};

const usePersistedCurrency = (): [Currency, (c: Currency) => void] => {
  const [currency, setCurrency] = useState<Currency>(() => {
    if (typeof window === 'undefined') return 'usd';
    const stored = localStorage.getItem('kc-currency') as Currency | null;
    return stored && CURRENCIES.some(c => c.key === stored) ? stored : 'usd';
  });
  const setPersisted = useCallback((c: Currency) => {
    setCurrency(c);
    localStorage.setItem('kc-currency', c);
  }, []);
  return [currency, setPersisted];
};

const usePersistedNicknames = (): Record<string, string> => {
  const [nicknames, setNicknames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = localStorage.getItem('kc-nicknames');
    if (stored) {
      try { setNicknames(JSON.parse(stored)); } catch {}
    }
  }, []);
  const save = useCallback((map: Record<string, string>) => {
    setNicknames(map);
    localStorage.setItem('kc-nicknames', JSON.stringify(map));
  }, []);
  // expose save for the component to use
  (usePersistedNicknames as any).save = save;
  return nicknames;
};

const formatNickname = (addr: string, nicknames: Record<string, string>): { label: string; isNick: boolean } => {
  const nick = nicknames[addr.toLowerCase()];
  if (nick) return { label: nick, isNick: true };
  return { label: formatAddr(addr), isNick: false };
};

// ── Allocation donut (SVG pie chart) ──────────────────────────────
function AllocationDonut({ allocations, totalValue }: {
  allocations: Array<{ label: string; value: number; color: string }>;
  totalValue: number;
}) {
  const total = allocations.reduce((s, a) => s + a.value, 0);
  if (total === 0) {
    return <span style={{ fontSize: '0.625rem', color: 'var(--text-3)' }}>No allocation data</span>;
  }

  let offset = 0;
  const radius = 16;
  const strokeWidth = 6;
  const circumference = 2 * Math.PI * radius;

  const segments = allocations.map(a => {
    const fraction = a.value / total;
    const dashOffset = offset * circumference;
    offset += fraction;
    return { ...a, fraction, dashOffset, dashArray: fraction * circumference };
  });

  return (
    <div className={styles.allocationDonut}>
      <svg width="80" height="44" viewBox="0 0 90 50">
        <defs>
          <filter id="soft" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="0.5" />
          </filter>
        </defs>
        {segments.map((s, i) => (
          <circle
            key={i}
            cx="30" cy="25"
            r={radius}
            fill="none"
            stroke={s.color}
            strokeWidth={strokeWidth}
            strokeDasharray={s.dashArray}
            strokeDashoffset={circumference - s.dashOffset}
            style={{ filter: 'url(#soft)', transition: 'stroke-dashoffset 0.3s' }}
            transform="rotate(-90 30 25)"
          />
        ))}
      </svg>
      <div className={styles.allocationLegend}>
        {allocations.filter(a => a.value > 0).map((a, i) => (
          <span key={i} className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: a.color }} />
            <span>{a.label} {(a.value / total * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Format helpers ──────────────────────────────────────────────────────
const formatAddr = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);

const fmt = (n: number, d = 4) =>
  n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtCompact = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return fmt(n, 2);
};

const fmtCurrency = (n: number, currency: Currency, prices: PriceMap | null) => {
  // n is in USD; convert to target currency using ETH as FX anchor
  const usdPerEth = prices?.['ethereum']?.usd ?? 1;
  const targetPerEth = prices?.['ethereum']?.[currency] ?? (currency === 'usd' ? 1 : 0);
  const fx = targetPerEth / usdPerEth;
  const converted = n * fx;
  const localeMap: Record<Currency, string> = {
    usd: 'en-US', eur: 'de-DE', idr: 'id-ID', jpy: 'ja-JP', gbp: 'en-GB'
  };
  const digits = currency === 'jpy' || currency === 'idr' ? 0 : 2;
  return new Intl.NumberFormat(localeMap[currency] ?? 'en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(converted);
};

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  return new Promise((res, rej) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); res(); }
    catch (e) { rej(e); }
    document.body.removeChild(ta);
  });
}

// ── Sparkline SVG (from price array) ──────────────────────────────────
function SparklineSVG({ data, height = 24, width = 100 }: {
  data: number[] | undefined;
  height?: number;
  width?: number;
}) {
  if (!data || data.length < 2) {
    return <span style={{ fontSize: '0.625rem', color: 'var(--text-3)' }}>—</span>;
  }
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);
  const points = data.map((v, i) => {
    const x = i * step;
    const y = height * (1 - (v - min) / range);
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{ overflow: 'visible' }}>
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        style={{ filter: 'url(#soft)' }}
      />
    </svg>
  );
}

// ── 24h % change from sparkline data ──────────────────────────────────
function SparklineChange({ data }: { data: number[] | undefined }) {
  if (!data || data.length < 2) return null;
  const first = data[0];
  const last = data[data.length - 1];
  const change = ((last - first) / first) * 100;
  const isPositive = change >= 0;
  const color = isPositive ? '#4ade80' : '#f87171';
  const sign = isPositive ? '+' : '';
  return (
    <span className={styles.priceChartChange} style={{ color }}>
      {sign}{change.toFixed(2)}%
    </span>
  );
}

// ── Token icon helpers ──────────────────────────────────────────────────
const TOKEN_COLORS: Record<string, string> = {
  USDC: '#2775ca',
  USDT: '#2384e0',
  USDE: '#008cff',
  USDG: '#8b5cf6',
};

function tokenIconClass(symbol: string): string {
  const upper = symbol.toUpperCase();
  if (TOKEN_COLORS[upper]) return upper.toLowerCase();
  return 'spls';
}

// ── Category labels ─────────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
  main:    'Main Player',
  multi:   'Multi Chain',
  side:    'Side Player',
  ledger:  'Ledger',
  ethereum: 'Ethereum',
};

// ── Component ───────────────────────────────────────────────────────────
export default function WalletChecker() {
  const [wallets, setWallets]          = useState<Wallet[]>([]);
  const [loading, setLoading]          = useState(true);
  const [error, setError]              = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [settingsOpen, setSettingsOpen]   = useState(false);
  const [theme, setTheme]              = usePersistedTheme();
  const [currency, setCurrency]        = usePersistedCurrency();
  const [autoRefresh, setAutoRefresh]  = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [customTokenInput, setCustomTokenInput] = useState('');
  const [copiedAddr, setCopiedAddr]    = useState<string | null>(null);
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const [prices, setPrices]            = useState<PriceMap | null>(null);
  const [sparklines, setSparklines]     = useState<Record<string, number[]> | null>(null);
  const nicknames = usePersistedNicknames();
  const [editingNickname, setEditingNickname] = useState<string | null>(null);
  const [nicknameDraft, setNicknameDraft] = useState('');
  const reduceMotion = useReducedMotion();

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/wallets');
      if (!res.ok) throw new Error('Failed to fetch wallets');
      const data: ApiResponse = await res.json();
      setWallets(data.wallets);
      setPrices(data.prices);
      setSparklines(data.sparklines);
      setLastRefreshed(new Date());
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWallets();
    if (autoRefresh) {
      const id = setInterval(fetchWallets, refreshInterval * 60 * 1000);
      return () => clearInterval(id);
    }
  }, [autoRefresh, refreshInterval, fetchWallets]);

  // Pre-load custom tokens (loaded once on mount; stored in GitHub)
  useEffect(() => {
    fetch('/api/custom-tokens')
      .then(r => r.json())
      .then((data: { solana: string[]; ethereum: string[] } | null) => {
        if (!data) return;
        setWallets(prev =>
          prev.map(w => {
            const list = w.chain === 'solana' ? data.solana : data.ethereum;
            if (!list.length) return w;
            const existingSymbols = new Set(w.tokens.map(t => t.symbol.toLowerCase()));
            const newTokens = list
              .filter(s => !existingSymbols.has(s.toLowerCase()))
              .map(symbol => ({
                symbol,
                name: symbol,
                balance: 0,
                decimals: 6,
                valueUsd: 0,
                source: 'user' as const,
              }));
            return { ...w, tokens: [...w.tokens, ...newTokens] };
          })
        );
      })
      .catch(() => {});
  }, []);

  const addCustomToken = async (chain: 'solana' | 'ethereum') => {
    const tokens = customTokenInput
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(Boolean);
    if (tokens.length === 0) return;

    setWallets(prev =>
      prev.map(w => {
        if (w.chain !== chain) return w;
        const existing = new Set(w.tokens.map(t => t.symbol));
        const newTokens = tokens
          .filter(s => !existing.has(s))
          .map(symbol => ({
            symbol,
            name: symbol,
            balance: 0,
            decimals: 6,
            valueUsd: 0,
            source: 'user' as const,
          }));
        return { ...w, tokens: [...w.tokens, ...newTokens] };
      })
    );
    setCustomTokenInput('');
    try {
      await fetch('/api/custom-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain, tokens }),
      });
    } catch {}
  };

  const handleCopy = async (addr: string) => {
    await copyText(addr);
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(null), 1800);
  };

  const toggleCategory = (cat: string) => {
    setOpenCategories(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  // ── Derived ───────────────────────────────────────────────────────────
  const solanaWallets   = wallets.filter(w => w.chain === 'solana');
  const ethereumWallets = wallets.filter(w => w.chain === 'ethereum');

  // Use the selected currency for all value displays
  const formatValue = (usdValue: number) => fmtCurrency(usdValue, currency, prices);

  const totalValue  = wallets.reduce((s, w) => s + w.nativeBalanceUsd + w.tokens.reduce((t, x) => t + x.valueUsd, 0), 0);
  const totalSol  = solanaWallets.reduce((s, w) => s + w.nativeBalance, 0);
  const totalEth  = ethereumWallets.reduce((s, w) => s + w.nativeBalance, 0);
  const totalSolValue = solanaWallets.reduce((s, w) => s + w.nativeBalanceUsd, 0);
  const totalEthValue = ethereumWallets.reduce((s, w) => s + w.nativeBalanceUsd, 0);
  // Stablecoin totals (all chains)
  const totalStableValue = wallets.reduce((s, w) => s + w.tokens.filter(t => /USDC|USDT|USDE|USDG|BUSD|USDP|FRAX/i.test(t.symbol)).reduce((t, x) => t + x.valueUsd, 0), 0);
  const solStableValue = solanaWallets.reduce((s, w) => s + w.tokens.filter(t => /USDC|USDT|USDE|USDG|BUSD|USDP|FRAX/i.test(t.symbol)).reduce((t, x) => t + x.valueUsd, 0), 0);
  const ethStableValue = ethereumWallets.reduce((s, w) => s + w.tokens.filter(t => /USDC|USDT|USDE|USDG|BUSD|USDP|FRAX/i.test(t.symbol)).reduce((t, x) => t + x.valueUsd, 0), 0);
  const totalTokenValue = wallets.reduce((s, w) => s + w.tokens.filter(t => !/USDC|USDT|USDE|USDG|BUSD|USDP|FRAX/i.test(t.symbol)).reduce((t, x) => t + x.valueUsd, 0), 0);

  // Allocation breakdown for donut
  const allocationData = [
    { label: 'SOL', value: totalSolValue, color: '#9945ff' },
    { label: 'ETH', value: totalEthValue, color: '#627eeb' },
    { label: 'Stablecoins', value: totalStableValue, color: '#4ade80' },
    { label: 'Tokens', value: totalTokenValue, color: 'var(--accent)' },
  ];

  // Group by category
  const groupedWallets = (chain: 'solana' | 'ethereum') => {
    const list = chain === 'solana' ? solanaWallets : ethereumWallets;
    const groups: Record<string, Wallet[]> = {};
    for (const w of list) {
      const cat = w.category || 'uncategorized';
      (groups[cat] ||= []).push(w);
    }
    return groups;
  };

  const solGroups   = groupedWallets('solana');
  const ethGroups   = groupedWallets('ethereum');

  const themeClass = '';

  // ── Wallet card (slim) ────────────────────────────────────
  function SlimWalletCard({ w, chain, idx }: { w: Wallet; chain: 'solana' | 'ethereum'; idx: number }) {
    const hasTokens = w.tokens.length > 0;
    const nativeSymbol = chain === 'solana' ? 'SOL' : 'ETH';
    const nativeDecimals = chain === 'solana' ? 4 : 6;
    const nickData = formatNickname(w.address, nicknames);
    const pnl24h = w.nativeUsd24hAgo != null
      ? w.nativeBalanceUsd - w.nativeUsd24hAgo
      : null;
    const pnlPercent = w.nativeUsd24hAgo && w.nativeUsd24hAgo > 0
      ? ((w.nativeBalanceUsd - w.nativeUsd24hAgo) / w.nativeUsd24hAgo) * 100
      : null;
    const isPositive = pnl24h != null && pnl24h >= 0;

    const saveNickname = (addr: string, nick: string) => {
      const map = { ...nicknames, [addr.toLowerCase()]: nick };
      (usePersistedNicknames as any).save(map);
    };

    const startEditNickname = (addr: string) => {
      setEditingNickname(addr);
      setNicknameDraft(nicknames[addr.toLowerCase()] || '');
    };

    const confirmNickname = () => {
      if (editingNickname && nicknameDraft.trim()) {
        saveNickname(editingNickname, nicknameDraft.trim());
      }
      setEditingNickname(null);
      setNicknameDraft('');
    };

    return (
      <motion.div
        data-slot="wallet-card"
        className={styles.walletCard}
        initial={reduceMotion ? undefined : { opacity: 0, y: 6 }}
        whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
        viewport={{ once: true, amount: 0.2 }}
        transition={{ duration: 0.3, delay: idx * 0.025, ease: [0.32, 0.72, 0, 1] }}
      >
        <div className={styles.walletAddress}>
          <div className={styles.walletAddressInner}>
            {editingNickname === w.address ? (
              <input
                data-slot="nickname-input"
                className={styles.nicknameInput}
                value={nicknameDraft}
                onChange={e => setNicknameDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmNickname(); if (e.key === 'Escape') { setEditingNickname(null); setNicknameDraft(''); } }}
                onBlur={confirmNickname}
                placeholder="Wallet name..."
                autoFocus
                aria-label="Edit wallet nickname"
              />
            ) : (
              <button
                data-slot="address-text"
                className={styles.addressText}
                onClick={() => handleCopy(w.address)}
                aria-label={`Copy ${w.address}`}
                title="Click to copy address"
              >
                {nickData.isNick ? nickData.label : formatAddr(w.address)}
              </button>
            )}
            {nickData.isNick && editingNickname !== w.address && (
              <button
                data-slot="edit-nickname"
                className={styles.editNicknameBtn}
                onClick={() => startEditNickname(w.address)}
                title="Edit nickname"
                aria-label="Edit nickname"
              >
                <Pencil size={9} />
              </button>
            )}
            <span className={`${styles.copyBadge} ${copiedAddr === w.address ? styles.show : ''}`}>
              <Check size={9} /> Copied
            </span>
          </div>
        </div>

        <a
          data-slot="explorer-button"
          href={w.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.explorerBtn}
          title={`Open in ${chain === 'solana' ? 'Solscan' : 'Etherscan'}`}
        >
          <Eye size={10} /> View
        </a>

        <div className={styles.walletBalance}>
          <div className={styles.balanceLabel}>
            {chain === 'solana' ? 'Native (SOL)' : 'Native (ETH)'}
          </div>
          <div className={styles.balanceValue}>
            {w.nativeBalance != null ? fmt(w.nativeBalance, nativeDecimals) : '—'}
            <span style={{ fontSize: '0.625rem', fontWeight: 400, color: 'var(--text-3)', marginLeft: 2 }}>
              {nativeSymbol}
            </span>
          </div>
          <div className={styles.balanceRight}>
            <span className={`${styles.usdValue} ${w.nativeBalanceUsd > 0 ? styles.positive : ''}`}>
              {w.nativeBalanceUsd != null ? formatValue(w.nativeBalanceUsd) : '—'}
            </span>
            {pnlPercent != null && (
              <span className={`${styles.pnlBadge} ${isPositive ? styles.pnlPositive : styles.pnlNegative}`}>
                {isPositive ? '+' : ''}{pnlPercent.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        {w.nftCount != null && w.nftCount > 0 && (
          <div className={styles.nftBadge}>
            <span className={styles.nftBadgeDot} />
            {w.nftCount} NFT{w.nftCount !== 1 ? 's' : ''}
          </div>
        )}

        {hasTokens && (
          <div className={styles.tokensInline}>
            {w.tokens.map((t, j) => (
              <span key={j} className={styles.tokenChip}>
                <span className={`${styles.tokenIcon} ${styles[tokenIconClass(t.symbol)]}`}>
                  {t.symbol.slice(0, 2)}
                </span>
                <span className={styles.tokenChipSymbol}>{t.symbol}</span>
                <span className={styles.tokenChipBalance}>
                  {fmt(t.balance, t.decimals)}
                </span>
                <span className={styles.tokenChipUsd}>
                  {t.valueUsd > 0 ? formatValue(t.valueUsd) : ''}
                </span>
                {t.source === 'user' && (
                  <span className={styles.tokenChipCustom}>custom</span>
                )}
              </span>
            ))}
          </div>
        )}
      </motion.div>
    );
  }

  // ── Category group ───────────────────────────────────────────
  function CategoryGroup({
    cat,
    wallets: catWallets,
    chain,
    idx,
  }: {
    cat: string;
    wallets: Wallet[];
    chain: 'solana' | 'ethereum';
    idx: number;
  }) {
    const label = CATEGORY_LABELS[cat] || cat;
    const open = openCategories.has(cat);
    const totalChainBal = catWallets.reduce((s, w) => s + (w.nativeBalanceUsd || 0), 0);

    return (
      <div data-slot="category-group" className={styles.categoryGroup}>
        <div
          data-slot="category-header"
          className={styles.categoryHeader}
          onClick={() => toggleCategory(cat)}
          role="button"
          aria-expanded={open}
        >
          <div className={styles.categoryTitle}>
            <span
              data-slot="chain-dot"
              className={`${styles.chainDot} ${chain === 'solana' ? styles.sol : styles.eth}`}
            />
            <span className={styles.categoryName}>{label}</span>
            <span className={styles.categoryCount}>{catWallets.length}</span>
            {totalChainBal > 0 && (
              <span className={styles.usdValue} style={{ fontSize: '0.625rem', marginLeft: 4 }}>
                {formatValue(totalChainBal)}
              </span>
            )}
          </div>
          <ChevronDown
            data-slot="category-chevron"
            size={12}
            className={`${styles.categoryChevron} ${open ? styles.open : ''}`}
          />
        </div>

        <AnimatePresence mode="wait">
          {open && (
            <motion.div
              data-slot="category-body"
              className={styles.categoryBody}
              initial={reduceMotion ? false : { opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25, ease: [0.32, 0.72, 0, 1] }}
            >
              <div className={styles.walletList}>
                {catWallets.map((w, i) => (
                  <SlimWalletCard key={w.address} w={w} chain={chain} idx={i} />
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div data-slot="page-container" className={`${styles.container} ${themeClass}`}>
      {/* Header */}
      <header data-slot="header" className={styles.header}>
        <div className={styles.headerBrand}>
          <div className={styles.headerIcon}>
            <Wallet size={16} />
          </div>
          <div className={styles.headerTitle}>
            <h1>KartelKoin Wallet Checker</h1>
            <span>Live on-chain balances</span>
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            data-slot="refresh-button"
            onClick={fetchWallets}
            className={`${styles.btn} ${styles.btnSecondary}`}
            disabled={loading}
            title="Refresh"
          >
            <RefreshCw
              size={13}
              style={{ animation: loading && !reduceMotion ? 'spin 0.8s linear infinite' : 'none' }}
            />
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
          <button
            data-slot="settings-button"
            onClick={() => setSettingsOpen(v => !v)}
            className={`${styles.btn} ${styles.btnSecondary}`}
            title="Settings"
            aria-label="Open settings"
          >
            <Settings size={13} />
          </button>
        </div>
      </header>

      {/* Error */}
      <AnimatePresence>
        {error && (
          <motion.div
            data-slot="error-state"
            className={styles.emptyState}
            initial={{ opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
          >
            <AlertCircle size={20} className={styles.emptyIcon} />
            <div className={styles.emptyTitle}>{error}</div>
            <div className={styles.emptyBody}>
              Could not load wallet data. Check your connection and try again.
            </div>
            <div className={styles.emptyAction}>
              <button
                data-slot="retry-button"
                onClick={fetchWallets}
                className={`${styles.btn} ${styles.btnSecondary}`}
              >
                <RefreshCw size={12} /> Try again
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading skeleton */}
      {loading && !error && (
        <div data-slot="market-overview-skeleton" className={styles.marketOverview}>
          <div data-slot="price-charts-skeleton" className={styles.priceCharts}>
            <div className={styles.priceChartRow}>
              <div className={styles.priceChartItem}>
                <div className={styles.skeleton} style={{ height: 10, width: 24, marginBottom: 6 }} />
                <div className={styles.skeleton} style={{ height: 20, width: 90 }} />
              </div>
              <div className={styles.priceChartItem}>
                <div className={styles.skeleton} style={{ height: 10, width: 24, marginBottom: 6 }} />
                <div className={styles.skeleton} style={{ height: 20, width: 90 }} />
              </div>
              <div className={styles.priceChartItem}>
                <div className={styles.skeleton} style={{ height: 10, width: 24, marginBottom: 6 }} />
                <div className={styles.skeleton} style={{ height: 20, width: 90 }} />
              </div>
              <div className={styles.priceChartItem}>
                <div className={styles.skeleton} style={{ height: 10, width: 36, marginBottom: 6 }} />
                <div className={styles.skeleton} style={{ height: 20, width: 90 }} />
              </div>
            </div>
          </div>
          <div className={styles.portfolioBento}>
            <div className={styles.bentoCell} style={{ gridColumn: '1 / -1' }}>
              <div className={styles.bentoLabel}>Total Portfolio</div>
              <div className={styles.skeleton} style={{ height: 32, width: '40%', marginTop: 6 }} />
            </div>
            <div className={`${styles.bentoCell} ${styles['chain-sol-anvil']}`}>
              <div className={styles.skeleton} style={{ height: 32, width: '50%' }} />
            </div>
            <div className={`${styles.bentoCell} ${styles['chain-eth-anvil']}`}>
              <div className={styles.skeleton} style={{ height: 32, width: '50%' }} />
            </div>
            <div className={`${styles.bentoCell} ${styles['chain-stable-anvil']}`}>
              <div className={styles.skeleton} style={{ height: 32, width: '50%' }} />
            </div>
          </div>
        </div>
      )}

      {/* Content */}
      {!loading && !error && (
        <>
          {/* Empty state */}
          {wallets.length === 0 && (
            <div data-slot="empty-state" className={styles.emptyState}>
              <Wallet size={32} className={styles.emptyIcon} />
              <div className={styles.emptyTitle}>No wallets yet</div>
              <div className={styles.emptyBody}>
                Add wallet addresses to the{' '}
                <code style={{ fontSize: '0.6875rem' }}>wallets.json</code> file in the{' '}
                <code style={{ fontSize: '0.6875rem' }}>kartelkoin-wallets</code> repo, or import from Mem0.
              </div>
            </div>
          )}

          {/* Price charts + Portfolio bento — unified market overview */}
          {wallets.length > 0 && (
            <div data-slot="market-overview" className={styles.marketOverview}>
              {/* Price charts — 24h sparklines */}
              <div data-slot="price-charts" className={styles.priceCharts}>
                <div className={styles.priceChartRow}>
                  <div className={styles.priceChartItem}>
                    <span className={styles.priceChartLabel}>
                      <span className={styles.chartDot} style={{ background: '#f59e0b' }} />BTC
                    </span>
                    <div className={styles.chartWrapper}>
                      <SparklineSVG data={sparklines?.bitcoin} height={20} width={95} />
                    </div>
                    <div className={styles.priceChartBottom}>
                      <span className={styles.priceChartValue}>
                        {prices?.bitcoin?.usd ? formatValue(prices.bitcoin.usd) : '—'}
                      </span>
                      <SparklineChange data={sparklines?.bitcoin} />
                    </div>
                  </div>
                  <div className={styles.priceChartItem}>
                    <span className={styles.priceChartLabel}>
                      <span className={styles.chartDot} style={{ background: '#9945ff' }} />SOL
                    </span>
                    <div className={styles.chartWrapper}>
                      <SparklineSVG data={sparklines?.solana} height={20} width={95} />
                    </div>
                    <div className={styles.priceChartBottom}>
                      <span className={styles.priceChartValue}>
                        {prices?.solana?.usd ? formatValue(prices.solana.usd) : '—'}
                      </span>
                      <SparklineChange data={sparklines?.solana} />
                    </div>
                  </div>
                  <div className={styles.priceChartItem}>
                    <span className={styles.priceChartLabel}>
                      <span className={styles.chartDot} style={{ background: '#627eeb' }} />ETH
                    </span>
                    <div className={styles.chartWrapper}>
                      <SparklineSVG data={sparklines?.ethereum} height={20} width={95} />
                    </div>
                    <div className={styles.priceChartBottom}>
                      <span className={styles.priceChartValue}>
                        {prices?.ethereum?.usd ? formatValue(prices.ethereum.usd) : '—'}
                      </span>
                      <SparklineChange data={sparklines?.ethereum} />
                    </div>
                  </div>
                  <div className={styles.priceChartItem}>
                    <span className={styles.priceChartLabel}>
                      <span className={styles.chartDot} style={{ background: '#4ade80' }} />USD/IDR
                    </span>
                    <div className={styles.chartWrapper}>
                      <SparklineSVG data={sparklines?.ethereum} height={20} width={95} />
                    </div>
                    <div className={styles.priceChartBottom}>
                      <span className={styles.priceChartValue}>
                        {prices?.ethereum?.usd && prices?.ethereum?.idr
                          ? new Intl.NumberFormat('id-ID', {
                              style: 'currency',
                              currency: 'IDR',
                              minimumFractionDigits: 0,
                              maximumFractionDigits: 0,
                            }).format(prices.ethereum.idr / prices.ethereum.usd)
                          : '—'}
                      </span>
                      <SparklineChange data={sparklines?.ethereum} />
                    </div>
                  </div>
                </div>
              </div>

              {/* Portfolio bento (symmetric: 1fr 1fr 1fr 1fr) */}
              <div className={styles.portfolioBento}>
              {/* Total — full width, accent bar */}
              <div className={`${styles.bentoCell} ${styles.total}`}>
                <div className={styles.bentoLabel}>Total Portfolio</div>
                <div className={styles.bentoValue}>
                  {formatValue(totalValue)}
                </div>
                {totalValue > 0 && (
                  <div className={styles.bentoChainRow}>
                    <Coins size={11} />
                    <span className={styles.bentoSub}>
                      {fmtCompact(totalSol)} SOL + {fmtCompact(totalEth)} ETH
                    </span>
                  </div>
                )}
                {totalValue > 0 && (
                  <AllocationDonut allocations={allocationData} totalValue={totalValue} />
                )}
              </div>

              {/* Solana cell — purple tint */}
              <div className={`${styles.bentoCell} ${styles['chain-sol-anvil']}`}>
                <div className={styles.bentoLabel}>Solana</div>
                <div className={styles.bentoValue} style={{ fontSize: '1.35rem' }}>
                  {fmtCompact(totalSol)}
                  <span style={{ fontSize: '0.625rem', fontWeight: 400, color: 'var(--text-3)', marginLeft: 3 }}>
                    SOL
                  </span>
                </div>
                <div className={styles.bentoChainRow}>
                  <span className={`${styles.chainDot} ${styles.sol}`} />
                  <span className={styles.chainCount}>
                    {solanaWallets.length} wallet{solanaWallets.length !== 1 ? 's' : ''}
                  </span>
                  {totalSolValue > 0 && (
                    <span className={styles.usdValue} style={{ marginLeft: 4 }}>
                      {formatValue(totalSolValue)}
                    </span>
                  )}
                </div>
              </div>

              {/* Ethereum cell — blue tint */}
              <div className={`${styles.bentoCell} ${styles['chain-eth-anvil']}`}>
                <div className={styles.bentoLabel}>Ethereum</div>
                <div className={styles.bentoValue} style={{ fontSize: '1.35rem' }}>
                  {fmtCompact(totalEth)}
                  <span style={{ fontSize: '0.625rem', fontWeight: 400, color: 'var(--text-3)', marginLeft: 3 }}>
                    ETH
                  </span>
                </div>
                <div className={styles.bentoChainRow}>
                  <span className={`${styles.chainDot} ${styles.eth}`} />
                  <span className={styles.chainCount}>
                    {ethereumWallets.length} wallet{ethereumWallets.length !== 1 ? 's' : ''}
                  </span>
                  {totalEthValue > 0 && (
                    <span className={styles.usdValue} style={{ marginLeft: 4 }}>
                      {formatValue(totalEthValue)}
                    </span>
                  )}
                </div>
              </div>

              {/* Stablecoins cell — green tint */}
              <div className={`${styles.bentoCell} ${styles['chain-stable-anvil']}`}>
                <div className={styles.bentoLabel}>Stablecoins</div>
                <div className={styles.bentoValue} style={{ fontSize: '1.35rem' }}>
                  {formatValue(totalStableValue)}
                </div>
                <div className={styles.bentoChainRow}>
                  <span className={styles.chainDot} style={{ background: '#4ade80' }} />
                  <span className={styles.chainCount}>
                    SOL: {formatValue(solStableValue)} | ETH: {formatValue(ethStableValue)}
                  </span>
                </div>
              </div>
            </div>
          </div>
          )}


          {/* Solana section */}
          {solanaWallets.length > 0 && (
            <section data-slot="solana-section" className={`${styles.section} ${styles.walletSectionCard}`}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>
                  <span className={`${styles.chainPill} ${styles.sol}`}>
                    <Coins size={9} /> Solana
                  </span>
                  <h2>Wallets</h2>
                  <span className={styles.sectionMeta}>{solanaWallets.length}</span>
                </div>
              </div>
              {Object.entries(solGroups).map(([cat, catWallets], idx) => (
                <CategoryGroup
                  key={cat}
                  cat={cat}
                  wallets={catWallets}
                  chain="solana"
                  idx={idx}
                />
              ))}
            </section>
          )}

          {/* Ethereum section */}
          {ethereumWallets.length > 0 && (
            <section data-slot="ethereum-section" className={`${styles.section} ${styles.walletSectionCard}`}>
              <div className={styles.sectionHeader}>
                <div className={styles.sectionTitle}>
                  <span className={`${styles.chainPill} ${styles.eth}`}>
                    <Coins size={9} /> Ethereum
                  </span>
                  <h2>Wallets</h2>
                  <span className={styles.sectionMeta}>{ethereumWallets.length}</span>
                </div>
              </div>
              {Object.entries(ethGroups).map(([cat, catWallets], idx) => (
                <CategoryGroup
                  key={cat}
                  cat={cat}
                  wallets={catWallets}
                  chain="ethereum"
                  idx={idx}
                />
              ))}
            </section>
          )}

          {/* Status bar */}
          {wallets.length > 0 && (
            <div data-slot="status-bar" className={styles.statusBar}>
              <span>
                {lastRefreshed
                  ? `Updated ${lastRefreshed.toLocaleTimeString()}`
                  : 'No data yet'}
              </span>
              <div className={styles.statusRight}>
                <span className={styles.statusDot} />
                <span>Live</span>
              </div>
            </div>
          )}
        </>
      )}

      {/* Settings overlay */}
      <AnimatePresence>
        {settingsOpen && (
          <motion.div
            data-slot="settings-overlay"
            className={styles.settingsOverlay}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSettingsOpen(false)}
          >
            <motion.div
              data-slot="settings-panel"
              className={styles.settingsPanel}
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.98 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0, 1] }}
              onClick={e => e.stopPropagation()}
            >
              <div className={styles.settingsPanelHeader}>
                <h3>Settings</h3>
                <button
                  data-slot="close-settings"
                  onClick={() => setSettingsOpen(false)}
                  className={styles.settingsClose}
                  aria-label="Close settings"
                >
                  <X size={14} />
                </button>
              </div>

              <div className={styles.settingSection}>
                <span className={styles.settingLabel}>Theme</span>
                <div className={styles.themeGrid}>
                  {([
                    { key: 'dark', label: 'Obsidian', icon: Wallet },
                    { key: 'anvil',  label: 'Anvil',     icon: Eye },
                    { key: 'glass',  label: 'Glass',     icon: Sparkles },
                  ] as const).map(({ key, label, icon: Icon }) => (
                    <button
                      key={key}
                      className={`${styles.themeOption} ${theme === key ? styles.active : ''}`}
                      onClick={() => setTheme(key)}
                      data-slot="theme-option"
                    >
                      <Icon size={14} className={styles.themeOptionIcon} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.settingSection}>
                <span className={styles.settingLabel}>Currency</span>
                <div className={styles.themeGrid}>
                  {CURRENCIES.map(({ key, label, symbol, icon: Icon }) => (
                    <button
                      key={key}
                      className={`${styles.themeOption} ${currency === key ? styles.active : ''}`}
                      onClick={() => setCurrency(key)}
                      data-slot="currency-option"
                    >
                      <Icon size={14} className={styles.themeOptionIcon} />
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.settingSection}>
                <span className={styles.settingLabel}>Auto-refresh</span>
                <div className={styles.settingRow}>
                  <span style={{ fontSize: '0.6875rem', color: 'var(--text-2)' }}>
                    Refresh data automatically
                  </span>
                  <button
                    data-slot="auto-refresh-toggle"
                    className={`${styles.toggleTrack} ${autoRefresh ? styles.active : ''}`}
                    onClick={() => setAutoRefresh(v => !v)}
                    role="switch"
                    aria-checked={autoRefresh}
                    aria-label="Toggle auto-refresh"
                  >
                    <span className={styles.toggleThumb} />
                  </button>
                </div>
              </div>

              {autoRefresh && (
                <div className={styles.settingSection}>
                  <span className={styles.settingLabel}>Refresh interval</span>
                  <select
                    data-slot="refresh-interval"
                    value={refreshInterval}
                    onChange={e => setRefreshInterval(Number(e.target.value))}
                    className={styles.select}
                    aria-label="Refresh interval in minutes"
                  >
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>60 minutes</option>
                  </select>
                </div>
              )}

              <div className={styles.settingSection}>
                <span className={styles.settingLabel}>
                  Custom tokens
                  <span style={{ fontSize: '0.5rem', color: 'var(--text-3)', marginLeft: 5, fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
                    (stored in GitHub)
                  </span>
                </span>
                <p className={styles.settingHint}>
                  Add token symbols to track per chain. Tokens are saved to the repo and shown in each wallet token list.
                </p>
                <div className={styles.customTokenRow}>
                  <input
                    data-slot="custom-token-input"
                    type="text"
                    value={customTokenInput}
                    onChange={e => setCustomTokenInput(e.target.value)}
                    placeholder="USDT, USDC, USDG"
                    className={styles.select}
                    aria-label="Token symbols, comma-separated"
                  />
                  <div className={styles.customTokenBtns}>
                    <button
                      data-slot="add-solana-token"
                      onClick={() => addCustomToken('solana')}
                      className={styles.addTokenBtn}
                      disabled={!customTokenInput.trim()}
                    >
                      Add to Solana
                    </button>
                    <button
                      data-slot="add-ethereum-token"
                      onClick={() => addCustomToken('ethereum')}
                      className={styles.addTokenBtn}
                      disabled={!customTokenInput.trim()}
                    >
                      Add to Ethereum
                    </button>
                  </div>
                </div>
              </div>

              <button
                data-slot="close-settings-btn"
                onClick={() => setSettingsOpen(false)}
                className={`${styles.btn} ${styles.btnPrimary}`}
                style={{ width: '100%', padding: '8px', marginTop: '4px' }}
              >
                Close
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
