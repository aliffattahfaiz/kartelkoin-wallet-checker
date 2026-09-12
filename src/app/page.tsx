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
} from 'lucide-react';
import styles from './page.module.css';

// ── Types ───────────────────────────────────────────────────────────────
interface TokenHolding {
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  valueUsd: number;
  source?: 'onchain' | 'mem0' | 'user';
}

interface Wallet {
  address: string;
  chain: 'solana' | 'ethereum';
  nativeBalance: number;
  nativeBalanceUsd: number;
  tokens: TokenHolding[];
  explorerUrl: string;
  category?: string;
}

interface ApiResponse {
  wallets: Wallet[];
  prices: { sol: number; eth: number; solChange: number; ethChange: number } | null;
}

// ── Theme ───────────────────────────────────────────────────────────────
type Theme = 'dark' | 'dim';
const THEMES: Theme[] = ['dark', 'dim'];

const usePersistedTheme = (): [Theme, (t: Theme) => void] => {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'dark';
    const stored = localStorage.getItem('kc-theme') as Theme | null;
    return stored && THEMES.includes(stored) ? stored : 'dark';
  });
  const setPersisted = useCallback((t: Theme) => {
    setTheme(t);
    localStorage.setItem('kc-theme', t);
  }, []);
  return [theme, setPersisted];
};

// ── Format helpers ──────────────────────────────────────────────────────
const formatAddr = (a: string) => a.slice(0, 6) + '…' + a.slice(-4);

const fmt = (n: number, d = 4) =>
  n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

const fmtCompact = (n: number) => {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K';
  return fmt(n, 2);
};

const fmtUsd = (n: number) =>
  n.toLocaleString(undefined, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
  const [autoRefresh, setAutoRefresh]  = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [customTokenInput, setCustomTokenInput] = useState('');
  const [copiedAddr, setCopiedAddr]    = useState<string | null>(null);
  const [openCategories, setOpenCategories] = useState<Set<string>>(new Set());
  const reduceMotion = useReducedMotion();

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/wallets');
      if (!res.ok) throw new Error('Failed to fetch wallets');
      const data: ApiResponse = await res.json();
      setWallets(data.wallets);
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

  const totalUsd  = wallets.reduce((s, w) => s + w.nativeBalanceUsd + w.tokens.reduce((t, x) => t + x.valueUsd, 0), 0);
  const totalSol  = solanaWallets.reduce((s, w) => s + w.nativeBalance, 0);
  const totalEth  = ethereumWallets.reduce((s, w) => s + w.nativeBalance, 0);
  const totalSolUsd = solanaWallets.reduce((s, w) => s + w.nativeBalanceUsd, 0);
  const totalEthUsd = ethereumWallets.reduce((s, w) => s + w.nativeBalanceUsd, 0);

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

  const themeClass = theme === 'dim' ? 'dim' : '';

  // ── Wallet card (slim) ────────────────────────────────────
  function SlimWalletCard({ w, chain, idx }: { w: Wallet; chain: 'solana' | 'ethereum'; idx: number }) {
    const hasTokens = w.tokens.length > 0;

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
            <button
              data-slot="address-text"
              className={styles.addressText}
              onClick={() => handleCopy(w.address)}
              aria-label={`Copy ${w.address}`}
              title="Click to copy address"
            >
              {formatAddr(w.address)}
            </button>
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
            {w.nativeBalance != null ? fmt(w.nativeBalance, chain === 'solana' ? 4 : 6) : '—'}
            <span style={{ fontSize: '0.625rem', fontWeight: 400, color: 'var(--text-3)', marginLeft: 2 }}>
              {chain === 'solana' ? 'SOL' : 'ETH'}
            </span>
          </div>
          <div className={styles.balanceRight}>
            <span className={`${styles.usdValue} ${w.nativeBalanceUsd > 0 ? styles.positive : ''}`}>
              {w.nativeBalanceUsd != null ? fmtUsd(w.nativeBalanceUsd) : '—'}
            </span>
          </div>
        </div>

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
                  {fmtUsd(t.valueUsd)}
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
                {fmtUsd(totalChainBal)}
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
        <div className={styles.portfolioBento}>
          <div className={styles.bentoCell} style={{ gridColumn: '1 / -1' }}>
            <div className={styles.bentoLabel}>Total Portfolio</div>
            <div className={styles.skeleton} style={{ height: 32, width: '40%', marginTop: 6 }} />
            <div className={styles.skeleton} style={{ height: 14, width: '25%', marginTop: 8 }} />
          </div>
          <div className={`${styles.bentoCell} ${styles['chain-sol-anvil']}`}>
            <div className={styles.skeleton} style={{ height: 14, width: '50%', marginBottom: 6 }} />
            <div className={styles.skeleton} style={{ height: 24, width: 80, marginBottom: 4 }} />
          </div>
          <div className={`${styles.bentoCell} ${styles['chain-eth-anvil']}`}>
            <div className={styles.skeleton} style={{ height: 14, width: '50%', marginBottom: 6 }} />
            <div className={styles.skeleton} style={{ height: 24, width: 80, marginBottom: 4 }} />
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

          {/* Portfolio bento (asymmetric: 1.6fr 1fr 1fr, varied cells) */}
          {wallets.length > 0 && (
            <div className={styles.portfolioBento}>
              {/* Total — full width, accent bar */}
              <div className={`${styles.bentoCell} ${styles.total}`}>
                <div className={styles.bentoLabel}>Total Portfolio</div>
                <div className={styles.bentoValue}>
                  {fmtUsd(totalUsd)}
                </div>
                {totalUsd > 0 && (
                  <div className={styles.bentoChainRow}>
                    <Coins size={11} />
                    <span className={styles.bentoSub}>
                      {fmtCompact(totalSol)} SOL + {fmtCompact(totalEth)} ETH
                    </span>
                  </div>
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
                  {totalSolUsd > 0 && (
                    <span className={styles.usdValue} style={{ marginLeft: 4 }}>
                      {fmtUsd(totalSolUsd)}
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
                  {totalEthUsd > 0 && (
                    <span className={styles.usdValue} style={{ marginLeft: 4 }}>
                      {fmtUsd(totalEthUsd)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Solana section */}
          {solanaWallets.length > 0 && (
            <section data-slot="solana-section" className={styles.section}>
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
            <section data-slot="ethereum-section" className={styles.section}>
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
                    { key: 'dim',  label: 'Dim',     icon: Eye },
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
