'use client';

import { useState, useEffect, useCallback } from 'react';
import styles from './page.module.css';

// ── Types ───────────────────────────────────────────────────────────────
interface TokenHolding {
  symbol: string;
  name: string;
  balance: number;
  decimals: number;
  valueUsd: number;
  source?: 'onchain' | 'mem0';
}

interface Wallet {
  address: string;
  chain: 'solana' | 'ethereum';
  nativeBalance: number;
  nativeBalanceUsd: number;
  tokens: TokenHolding[];
  explorerUrl: string;
}

interface ApiResponse {
  wallets: Wallet[];
  prices: { sol: number; eth: number; solChange: number; ethChange: number } | null;
}

// ── Theme persistence ──────────────────────────────────────────────────
type Theme = 'kartelkoin' | 'glass' | 'neon';

function usePersistedTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === 'undefined') return 'kartelkoin';
    const stored = localStorage.getItem('kc-theme') as Theme | null;
    return stored && ['kartelkoin', 'glass', 'neon'].includes(stored) ? stored : 'kartelkoin';
  });

  const setPersisted = useCallback((t: Theme) => {
    setTheme(t);
    localStorage.setItem('kc-theme', t);
  }, []);

  return [theme, setPersisted];
}

// ── Format helpers ─────────────────────────────────────────────────────
const formatAddr = (a: string) => a.slice(0, 4) + '…' + a.slice(-4);
const fmt = (n: number, d = 4) =>
  n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d });

function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text);
  }
  // Fallback for localhost / older browsers
  return new Promise((res, rej) => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); res(); }
    catch (e) { rej(e); }
    document.body.removeChild(ta);
  });
}

// ── Component ──────────────────────────────────────────────────────────
export default function WalletChecker() {
  const [wallets, setWallets]     = useState<Wallet[]>([]);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [settingsOpen, setSettingsOpen]  = useState(false);
  const [theme, setTheme]         = usePersistedTheme();
  const [autoRefresh, setAutoRefresh]   = useState(false);
  const [refreshInterval, setRefreshInterval] = useState(30);
  const [customTokenInput, setCustomTokenInput] = useState('');
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const fetchWallets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/wallets?source=kartelkoin');
      if (!res.ok) throw new Error('Failed to fetch wallets from Mem0');
      const data: ApiResponse = await res.json();
      setWallets(data.wallets);
      setLastRefreshed(new Date());
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load + auto-refresh
  useEffect(() => {
    fetchWallets();
    if (autoRefresh) {
      const id = setInterval(fetchWallets, refreshInterval * 60 * 1000);
      return () => clearInterval(id);
    }
  }, [autoRefresh, refreshInterval, fetchWallets]);

  // ── Derived ──────────────────────────────────────────────────────────
  const solanaWallets = wallets.filter(w => w.chain === 'solana');
  const ethereumWallets = wallets.filter(w => w.chain === 'ethereum');

  const totalUsd = wallets.reduce((sum, w) => {
    return sum + w.nativeBalanceUsd + w.tokens.reduce((s, t) => s + t.valueUsd, 0);
  }, 0);

  const totalSol = solanaWallets.reduce((s, w) => s + w.nativeBalance, 0);
  const totalEth = ethereumWallets.reduce((s, w) => s + w.nativeBalance, 0);

  const prices = wallets.length > 0
    ? wallets[0]?.nativeBalanceUsd  // cheap proxy: we have prices if we have wallets
      ? undefined // we'll get prices from API response
      : undefined
    : undefined;

  // ── Custom token add (stores in Mem0 via a new API endpoint) ─────────
  const addCustomToken = async (chain: 'solana' | 'ethereum') => {
    const tokens = customTokenInput
      .split(',')
      .map(t => t.trim().toUpperCase())
      .filter(Boolean);
    if (tokens.length === 0) return;

    // Optimistically add to local UI
    setWallets(prev =>
      prev.map(w => {
        if (w.chain !== chain) return w;
        const existingSymbols = new Set(w.tokens.map(t => t.symbol));
        const newTokens = tokens
          .filter(s => !existingSymbols.has(s))
          .map(symbol => ({
            symbol,
            name: symbol,
            balance: 0,
            decimals: 6,
            valueUsd: 0,
            source: 'mem0' as const,
          }));
        return { ...w, tokens: [...w.tokens, ...newTokens] };
      })
    );
    setCustomTokenInput('');

    // Persist to Mem0 as a "custom tokens" memory so it survives refresh
    try {
      await fetch('/api/custom-tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chain, tokens }),
      });
    } catch {
      // silently ignore — UI already updated
    }
  };

  // ── Copy address ─────────────────────────────────────────────────────
  const handleCopy = async (addr: string) => {
    await copyText(addr);
    setCopiedAddr(addr);
    setTimeout(() => setCopiedAddr(null), 2000);
  };

  const themeClass = theme === 'glass' ? 'glass' : theme === 'neon' ? 'neon' : '';

  return (
    <div className={`${styles.container} ${themeClass}`}>
      {/* Header */}
      <header className={styles.header}>
        <h1>KartelKoin Wallet Checker</h1>
        <div className={styles.headerActions}>
          <button
            onClick={fetchWallets}
            className={styles.refreshBtn}
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            onClick={() => setSettingsOpen(v => !v)}
            className={styles.settingsBtn}
          >
            Settings
          </button>
        </div>
      </header>

      {/* Error */}
      {error && <div className={styles.error}>{error}</div>}

      {/* Last refreshed */}
      {lastRefreshed && (
        <div className={styles.lastRefreshed}>
          Last refreshed: {lastRefreshed.toLocaleTimeString()}
          {autoRefresh && ' (auto)'}
        </div>
      )}

      {/* Summary cards */}
      <div className={styles.summary}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Total Portfolio</span>
          <span className={styles.summaryValue}>
            ${fmt(totalUsd, 2)}
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Solana</span>
          <span className={styles.summaryValue}>
            {fmt(totalSol)} SOL
          </span>
          <span className={styles.summarySub}>
            ${fmt(solanaWallets.reduce((s, w) => s + w.nativeBalanceUsd, 0), 2)}
          </span>
        </div>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>Ethereum</span>
          <span className={styles.summaryValue}>
            {fmt(totalEth)} ETH
          </span>
          <span className={styles.summarySub}>
            ${fmt(ethereumWallets.reduce((s, w) => s + w.nativeBalanceUsd, 0), 2)}
          </span>
        </div>
      </div>

      {/* Solana wallets */}
      {solanaWallets.length > 0 && (
        <section className={styles.section}>
          <h2>Solana Portfolios ({solanaWallets.length})</h2>
          {solanaWallets.map(w => (
            <WalletCard
              key={w.address}
              wallet={w}
              copiedAddr={copiedAddr}
              onCopy={handleCopy}
              theme={theme}
            />
          ))}
        </section>
      )}

      {/* Ethereum wallets */}
      {ethereumWallets.length > 0 && (
        <section className={styles.section}>
          <h2>Ethereum Portfolios ({ethereumWallets.length})</h2>
          {ethereumWallets.map(w => (
            <WalletCard
              key={w.address}
              wallet={w}
              copiedAddr={copiedAddr}
              onCopy={handleCopy}
              theme={theme}
            />
          ))}
        </section>
      )}

      {/* Empty state */}
      {wallets.length === 0 && !loading && (
        <div className={styles.empty}>
          No wallets found. Add wallet addresses to Mem0 first.
        </div>
      )}

      {/* Settings overlay */}
      {settingsOpen && (
        <div className={styles.settingsOverlay} onClick={() => setSettingsOpen(false)}>
          <div className={styles.settingsPanel} onClick={e => e.stopPropagation()}>
            <h3>Settings</h3>

            <div className={styles.settingGroup}>
              <label>Theme</label>
              <div className={styles.themeOptions}>
                {(['kartelkoin', 'glass', 'neon'] as Theme[]).map(t => (
                  <button
                    key={t}
                    className={theme === t ? styles.activeTheme : ''}
                    onClick={() => setTheme(t)}
                  >
                    {t === 'kartelkoin' ? 'KartelKoin' : t === 'glass' ? 'Glassmorphism' : 'Neon'}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.settingGroup}>
              <label>Auto-refresh</label>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  checked={autoRefresh}
                  onChange={e => setAutoRefresh(e.target.checked)}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>

            {autoRefresh && (
              <div className={styles.settingGroup}>
                <label>Refresh interval (minutes)</label>
                <select
                  value={refreshInterval}
                  onChange={e => setRefreshInterval(Number(e.target.value))}
                  className={styles.select}
                >
                  <option value={15}>15</option>
                  <option value={30}>30</option>
                  <option value={60}>60</option>
                </select>
              </div>
            )}

            <div className={styles.settingGroup}>
              <label>
                Custom tokens <span className={styles.settingHint}>(stored in Mem0)</span>
              </label>
              <p className={styles.settingHintDetail}>
                Comma-separated token symbols (e.g. USDT, USDC, USDG). Added to Mem0 and
                displayed in each wallet's token list. On-chain balances are fetched from
                RPC where available.
              </p>
              <div className={styles.customTokenRow}>
                <input
                  type="text"
                  value={customTokenInput}
                  onChange={e => setCustomTokenInput(e.target.value)}
                  placeholder="USDT, USDC, USDG"
                  className={styles.textInput}
                />
                <div className={styles.addTokenBtns}>
                  <button
                    onClick={() => addCustomToken('solana')}
                    className={styles.addTokenBtn}
                  >
                    Add to Solana
                  </button>
                  <button
                    onClick={() => addCustomToken('ethereum')}
                    className={styles.addTokenBtn}
                  >
                    Add to Ethereum
                  </button>
                </div>
              </div>
            </div>

            <button
              onClick={() => setSettingsOpen(false)}
              className={styles.closeSettingsBtn}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── WalletCard sub-component ───────────────────────────────────────────
function WalletCard({
  wallet,
  copiedAddr,
  onCopy,
  theme,
}: {
  wallet: Wallet;
  copiedAddr: string | null;
  onCopy: (addr: string) => void;
  theme: Theme;
}) {
  const isSol = wallet.chain === 'solana';

  return (
    <div className={styles.walletCard}>
      <div className={styles.walletHeader}>
        <span className={`${styles.chainBadge} ${isSol ? '' : styles.eth}`}>
          {isSol ? 'SOL' : 'ETH'}
        </span>
        <span className={styles.address}>
          <button
            className={styles.addressCopyBtn}
            onClick={() => onCopy(wallet.address)}
            title="Copy address"
          >
            {formatAddr(wallet.address)}
            {copiedAddr === wallet.address && (
              <span className={styles.copyConfirm}>copied</span>
            )}
          </button>
        </span>
        <a
          href={wallet.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={styles.explorerLink}
          title="Open in explorer"
        >
          View
        </a>
      </div>

      <div className={styles.balanceRow}>
        <span className={styles.balanceLabel}>
          Native ({isSol ? 'SOL' : 'ETH'})
        </span>
        <span className={styles.balanceValue}>
          {fmt(wallet.nativeBalance, isSol ? 4 : 6)} {isSol ? 'SOL' : 'ETH'}
        </span>
      </div>

      {wallet.tokens.length > 0 && (
        <div className={styles.tokensContainer}>
          {wallet.tokens.map((t, i) => (
            <div key={i} className={styles.tokenRow}>
              <span className={styles.tokenSymbol}>{t.symbol}</span>
              <span className={styles.tokenBalance}>
                {fmt(t.balance, t.decimals)}
              </span>
              <span className={styles.tokenValue}>
                ${fmt(t.valueUsd, 2)}
              </span>
              {t.source === 'mem0' && (
                <span className={styles.tokenSource} title="User-added token">⚠</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
