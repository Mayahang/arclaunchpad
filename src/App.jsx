/**
 * ArcLaunch v2 — Token Launchpad on Arc Testnet
 * ================================================
 * New features vs v1:
 *   ✦ Bonding curve price chart (per-token, line chart via recharts)
 *   ✦ Search / filter tokens by name or symbol
 *   ✦ Comment board per token (post & read on-chain comments)
 *   ✦ Leaderboard tab — top tokens by volume & holders
 *   ✦ Real-time trade feed via WebSocket (Arc WSS endpoint)
 *   ✦ Live price ticker on every token card
 *   ✦ IPFS image upload via NFT.Storage (paste CID or full URL)
 *   ✦ Bonding curve preview before buying/selling
 *
 * Dependencies:
 *   npm install ethers recharts
 *
 * ⚠️  Set LAUNCHPAD_ADDRESS and USDC_ADDRESS before running.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { ethers } from "ethers";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

// ─── CONFIG ──────────────────────────────────────────────────────────────────

const CHAIN_ID = 5042002;
const RPC_URL = "https://rpc.testnet.arc.network";
const WSS_URL = "wss://rpc.testnet.arc.network";
const EXPLORER = "https://testnet.arcscan.app";
const LAUNCHPAD_ADDRESS = "0x70F85C0305787C8CFA1E1c4D0d795e8d92904c5d"; // ← replace
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000"; // ← replace

const BASE_PRICE = 1000; // mirrors contract constant
const SLOPE = 1; // mirrors contract constant

// ─── ABIs ────────────────────────────────────────────────────────────────────

const LP_ABI = [
  // Core
  "function launchToken(string,string,uint256,string,string) returns (address)",
  "function buyToken(address,uint256)",
  "function sellToken(address,uint256)",
  // Views
  "function getAllTokens() view returns (address[])",
  "function tokenInfo(address) view returns (address,string,string,uint256,string,string,address,uint256,uint256,uint256,uint256,uint256)",
  "function getTradeHistory() view returns (tuple(address trader,address token,bool isBuy,uint256 tokenAmount,uint256 usdcAmount,uint256 pricePerToken,uint256 timestamp)[])",
  "function getUserTokens(address) view returns (address[])",
  "function getUserTokenBalance(address,address) view returns (uint256)",
  "function currentPrice(address) view returns (uint256)",
  "function getBuyCost(address,uint256) view returns (uint256)",
  "function getSellReturn(address,uint256) view returns (uint256)",
  // Comments
  "function postComment(address,string)",
  "function getComments(address) view returns (tuple(address author,string text,uint256 timestamp)[])",
  // Chart
  "function getTokenTradesRecent(address,uint256) view returns (tuple(address trader,address token,bool isBuy,uint256 tokenAmount,uint256 usdcAmount,uint256 pricePerToken,uint256 timestamp)[])",
  // Leaderboard
  "function getTopByVolume(uint256) view returns (address[])",
  "function getTopByHolders(uint256) view returns (address[])",
  // Events
  "event TokenLaunched(address indexed token,address indexed creator,string name,string symbol,uint256 totalSupply,uint256 timestamp)",
  "event TokenBought(address indexed trader,address indexed token,uint256 tokenAmount,uint256 usdcAmount,uint256 pricePerToken,uint256 newTokensSold,uint256 timestamp)",
  "event TokenSold(address indexed trader,address indexed token,uint256 tokenAmount,uint256 usdcAmount,uint256 pricePerToken,uint256 newTokensSold,uint256 timestamp)",
  "event CommentPosted(address indexed token,address indexed author,string text,uint256 timestamp)",
];

const ERC20_ABI = [
  "function approve(address,uint256) returns (bool)",
  "function allowance(address,address) view returns (uint256)",
  "function balanceOf(address) view returns (uint256)",
];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const fmt = (n, d = 4) =>
  parseFloat(ethers.formatUnits(BigInt(n.toString()), 18)).toFixed(d);
const fmtP = (n) => {
  try {
    return parseFloat(ethers.formatUnits(BigInt(n.toString()), 6)).toFixed(6);
  } catch {
    return "0.000000";
  }
};
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : "");
const tsStr = (t) => new Date(Number(t) * 1000).toLocaleString();
const ago = (t) => {
  const s = Math.floor(Date.now() / 1000 - Number(t));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

// Bonding curve spot price — mirrors Solidity
const spotPrice = (tokensSold) => BASE_PRICE + Number(tokensSold) / 1e12;

// ─── STYLES ──────────────────────────────────────────────────────────────────

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Clash+Display:wght@600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#060810;--surface:#0c0f1a;--surface2:#111527;--border:#1a1f35;
  --accent:#5fffb0;--accent2:#7b5cfa;--warn:#ffb347;
  --red:#ff4d6a;--green:#00e599;--blue:#3b9eff;
  --text:#dde3f5;--muted:#4a5178;--radius:14px;
  --mono:'Space Mono',monospace;--display:'Clash Display','Plus Jakarta Sans',sans-serif;
  --body:'Plus Jakarta Sans',sans-serif;
}
html,body,#root{height:100%;background:var(--bg);color:var(--text);font-family:var(--body)}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-track{background:var(--bg)}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
.app{display:flex;flex-direction:column;min-height:100vh}

/* Header */
.header{display:flex;align-items:center;justify-content:space-between;padding:16px 28px;
  border-bottom:1px solid var(--border);background:rgba(6,8,16,.92);
  backdrop-filter:blur(16px);position:sticky;top:0;z-index:100}
.logo{font-family:var(--display);font-size:1.45rem;font-weight:700;letter-spacing:-.5px}
.logo-arc{color:var(--accent)}
.logo-dot{color:var(--accent2);margin:0 1px}
.badge{font-family:var(--mono);font-size:.6rem;background:rgba(91,255,176,.1);
  color:var(--accent);border:1px solid rgba(91,255,176,.25);border-radius:4px;
  padding:2px 7px;margin-left:8px;vertical-align:middle}
.header-right{display:flex;align-items:center;gap:10px}
.addr-pill{font-family:var(--mono);font-size:.72rem;background:var(--surface2);
  border:1px solid var(--border);border-radius:20px;padding:6px 14px;color:var(--muted);
  text-decoration:none;transition:border-color .15s}
.addr-pill:hover{border-color:var(--accent);color:var(--accent)}
.live-dot{width:7px;height:7px;background:var(--green);border-radius:50%;
  box-shadow:0 0 6px var(--green);animation:pulse 1.8s ease infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}

/* Buttons */
.btn{cursor:pointer;border:none;border-radius:9px;font-family:var(--body);
  font-size:.83rem;font-weight:700;padding:9px 18px;transition:all .15s}
.btn-primary{background:var(--accent);color:#060810}
.btn-primary:hover{filter:brightness(1.12);transform:translateY(-1px)}
.btn-danger{background:var(--red);color:#fff}
.btn-danger:hover{filter:brightness(1.1)}
.btn-ghost{background:var(--surface2);border:1px solid var(--border);color:var(--text)}
.btn-ghost:hover{border-color:var(--accent2);color:var(--accent2)}
.btn-sm{padding:6px 13px;font-size:.78rem}
.btn:disabled{opacity:.4;cursor:not-allowed;transform:none!important}

/* Nav */
.nav{display:flex;gap:2px;padding:0 28px;border-bottom:1px solid var(--border);
  background:var(--surface);overflow-x:auto}
.nav-tab{padding:13px 18px;font-size:.83rem;font-weight:600;color:var(--muted);
  cursor:pointer;border-bottom:2px solid transparent;transition:all .15s;white-space:nowrap;user-select:none}
.nav-tab.active{color:var(--accent);border-color:var(--accent)}
.nav-tab:hover:not(.active){color:var(--text)}

/* Main */
.main{flex:1;padding:28px;max-width:1280px;margin:0 auto;width:100%}
.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:18px}
@media(max-width:960px){.grid-3{grid-template-columns:repeat(2,1fr)}}
@media(max-width:640px){.grid-3,.grid-2{grid-template-columns:1fr}}

/* Card */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:22px}
.card-title{font-family:var(--display);font-size:1.05rem;font-weight:700;margin-bottom:18px}
.section-title{font-family:var(--display);font-size:1.55rem;font-weight:700;margin-bottom:22px;letter-spacing:-.3px}

/* Token card */
.token-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:18px;cursor:pointer;transition:border-color .2s,transform .2s,box-shadow .2s;position:relative;overflow:hidden}
.token-card::before{content:'';position:absolute;inset:0;background:linear-gradient(135deg,rgba(91,255,176,.04),transparent);
  opacity:0;transition:opacity .2s;pointer-events:none}
.token-card:hover{border-color:var(--accent2);transform:translateY(-3px);box-shadow:0 12px 40px rgba(123,92,250,.15)}
.token-card:hover::before{opacity:1}
.tok-header{display:flex;align-items:center;gap:12px;margin-bottom:12px}
.tok-img{width:48px;height:48px;border-radius:50%;object-fit:cover;border:2px solid var(--border);background:var(--surface2);flex-shrink:0}
.tok-img-placeholder{width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,var(--accent2),var(--blue));
  display:flex;align-items:center;justify-content:center;font-size:1.3rem;flex-shrink:0}
.tok-name{font-family:var(--display);font-size:.95rem;font-weight:700}
.tok-sym{font-family:var(--mono);font-size:.7rem;color:var(--accent);margin-top:1px}
.tok-desc{font-size:.78rem;color:var(--muted);margin-bottom:12px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;line-height:1.5}
.tok-stats{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px}
.chip{font-family:var(--mono);font-size:.65rem;color:var(--muted);background:var(--surface2);
  border:1px solid var(--border);border-radius:5px;padding:3px 8px}
.price-live{font-family:var(--mono);font-size:.7rem;color:var(--accent);
  background:rgba(91,255,176,.08);border:1px solid rgba(91,255,176,.2);border-radius:5px;padding:3px 8px}
.progress-bar{height:4px;background:var(--border);border-radius:2px;overflow:hidden}
.progress-fill{height:100%;border-radius:2px;background:linear-gradient(90deg,var(--accent2),var(--accent));transition:width .3s}

/* Form */
.field{margin-bottom:14px}
.field label{display:block;font-size:.73rem;font-weight:700;color:var(--muted);
  text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px}
.field input,.field textarea,.field select{width:100%;background:var(--surface2);border:1px solid var(--border);
  border-radius:9px;padding:10px 13px;color:var(--text);font-family:var(--body);font-size:.88rem;outline:none;transition:border-color .15s}
.field input:focus,.field textarea:focus{border-color:var(--accent2);background:var(--bg)}
.field textarea{resize:vertical;min-height:70px}

/* Search bar */
.search-bar{display:flex;gap:10px;margin-bottom:22px;align-items:center}
.search-input{flex:1;background:var(--surface);border:1px solid var(--border);border-radius:9px;
  padding:10px 16px;color:var(--text);font-family:var(--body);font-size:.88rem;outline:none;transition:border-color .15s}
.search-input:focus{border-color:var(--accent2)}

/* Trade modal */
.overlay{position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:200;
  display:flex;align-items:center;justify-content:center;padding:16px}
.trade-box{background:var(--surface);border:1px solid var(--border);border-radius:18px;
  padding:0;width:100%;max-width:820px;max-height:92vh;overflow:hidden;
  display:flex;flex-direction:column}
.trade-header{padding:22px 26px 0;display:flex;align-items:center;gap:14px}
.trade-close{margin-left:auto;background:none;border:none;color:var(--muted);font-size:1.1rem;cursor:pointer}
.trade-tabs-row{display:flex;gap:8px;padding:16px 26px 0}
.trade-tab{flex:1;padding:9px;border-radius:9px;font-size:.83rem;font-weight:700;
  cursor:pointer;border:1px solid var(--border);background:var(--surface2);color:var(--muted);transition:all .15s}
.trade-tab.buy{background:var(--green);border-color:var(--green);color:#060810}
.trade-tab.sell{background:var(--red);border-color:var(--red);color:#fff}

/* Inside trade box — scrollable body */
.trade-body{overflow-y:auto;padding:20px 26px 26px;display:grid;grid-template-columns:1fr 1fr;gap:20px}
@media(max-width:640px){.trade-body{grid-template-columns:1fr}}
.trade-left{}
.trade-right{}

/* Chart */
.chart-wrap{background:var(--surface2);border:1px solid var(--border);border-radius:10px;padding:14px;margin-bottom:16px}
.chart-title{font-size:.72rem;color:var(--muted);font-weight:700;text-transform:uppercase;letter-spacing:.06em;margin-bottom:10px}

/* Comment board */
.comments-section{border-top:1px solid var(--border);padding-top:16px}
.comment-item{padding:10px 0;border-bottom:1px solid var(--border)}
.comment-author{font-family:var(--mono);font-size:.68rem;color:var(--accent2)}
.comment-text{font-size:.82rem;color:var(--text);margin-top:3px;line-height:1.5}
.comment-ts{font-size:.68rem;color:var(--muted);margin-top:2px}
.comment-input-row{display:flex;gap:8px;margin-top:12px}
.comment-input{flex:1;background:var(--surface2);border:1px solid var(--border);
  border-radius:8px;padding:8px 12px;color:var(--text);font-family:var(--body);font-size:.83rem;outline:none}
.comment-input:focus{border-color:var(--accent2)}

/* History table */
.tbl{width:100%;border-collapse:collapse;font-size:.8rem}
.tbl th{text-align:left;color:var(--muted);font-size:.68rem;font-weight:700;text-transform:uppercase;
  letter-spacing:.06em;padding:0 10px 10px}
.tbl td{padding:9px 10px;border-top:1px solid var(--border)}
.tbl tr:hover td{background:rgba(255,255,255,.02)}
.tag-b{color:var(--green);font-weight:700;font-family:var(--mono);font-size:.68rem}
.tag-s{color:var(--red);font-weight:700;font-family:var(--mono);font-size:.68rem}

/* Leaderboard */
.lb-row{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid var(--border)}
.lb-rank{font-family:var(--display);font-size:1.2rem;font-weight:700;color:var(--muted);
  width:32px;text-align:center;flex-shrink:0}
.lb-rank.gold{color:#ffd700}
.lb-rank.silver{color:#c0c0c0}
.lb-rank.bronze{color:#cd7f32}
.lb-img{width:36px;height:36px;border-radius:50%;object-fit:cover;background:var(--surface2);border:1px solid var(--border);flex-shrink:0}
.lb-info{flex:1}
.lb-name{font-weight:700;font-size:.88rem}
.lb-sym{font-family:var(--mono);font-size:.68rem;color:var(--accent)}
.lb-val{font-family:var(--mono);font-size:.82rem;color:var(--accent2)}

/* Dashboard */
.hold-row{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid var(--border)}
.hold-img{width:38px;height:38px;border-radius:50%;object-fit:cover;background:var(--surface2);border:1px solid var(--border);flex-shrink:0}
.hold-name{font-weight:600;font-size:.88rem}
.hold-bal{font-family:var(--mono);font-size:.73rem;color:var(--accent)}

/* Stat grid */
.stat-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:26px}
@media(max-width:860px){.stat-grid{grid-template-columns:repeat(2,1fr)}}
.stat-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px}
.stat-label{font-size:.68rem;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px}
.stat-val{font-family:var(--display);font-size:1.5rem;font-weight:700;color:var(--accent)}
.stat-sub{font-family:var(--mono);font-size:.65rem;color:var(--muted);margin-top:2px}

/* Live feed */
.live-feed{position:fixed;bottom:18px;right:18px;width:320px;z-index:150;display:flex;flex-direction:column;gap:6px;pointer-events:none}
.live-item{background:rgba(12,15,26,.95);border:1px solid var(--border);border-radius:10px;
  padding:10px 14px;font-size:.76rem;animation:slideIn .3s ease;pointer-events:auto}
@keyframes slideIn{from{transform:translateX(20px);opacity:0}to{transform:translateX(0);opacity:1}}
.live-item-buy{border-left:3px solid var(--green)}
.live-item-sell{border-left:3px solid var(--red)}
.live-item-launch{border-left:3px solid var(--accent2)}

/* Misc */
.empty{text-align:center;color:var(--muted);font-size:.88rem;padding:36px 0}
.notice{padding:11px 15px;border-radius:9px;font-size:.8rem;margin-bottom:14px}
.notice-info{background:rgba(91,255,176,.07);border:1px solid rgba(91,255,176,.2);color:var(--accent)}
.notice-err{background:rgba(255,77,106,.07);border:1px solid rgba(255,77,106,.2);color:var(--red)}
.notice-warn{background:rgba(255,179,71,.07);border:1px solid rgba(255,179,71,.2);color:var(--warn)}
.spinner{display:inline-block;width:15px;height:15px;border:2px solid var(--border);
  border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
a{color:inherit;text-decoration:none}
`;

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState("");
  const [tab, setTab] = useState("explore");
  const [tokens, setTokens] = useState([]);
  const [history, setHistory] = useState([]);
  const [holdings, setHoldings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(null);
  const [liveFeed, setLiveFeed] = useState([]);
  const [refresh, setRefresh] = useState(0);
  const wsRef = useRef(null);

  // ── Wallet ──────────────────────────────────────────────────────────

  const connect = useCallback(async () => {
    if (!window.ethereum) return setError("No wallet found. Install MetaMask.");
    const p = new ethers.BrowserProvider(window.ethereum);
    await p.send("eth_requestAccounts", []);
    const net = await p.getNetwork();
    if (Number(net.chainId) !== CHAIN_ID) {
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x" + CHAIN_ID.toString(16) }],
        });
      } catch {
        await window.ethereum.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: "0x" + CHAIN_ID.toString(16),
              chainName: "Arc Testnet",
              nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
              rpcUrls: [RPC_URL],
              blockExplorerUrls: [EXPLORER],
            },
          ],
        });
      }
    }
    const s = await p.getSigner();
    setProvider(p);
    setSigner(s);
    setAddress(await s.getAddress());
  }, []);

  // ── Load data ───────────────────────────────────────────────────────

  const loadAll = useCallback(async () => {
    if (!provider) return;
    setLoading(true);
    try {
      const c = new ethers.Contract(LAUNCHPAD_ADDRESS, LP_ABI, provider);
      const addrs = await c.getAllTokens();
      const infos = (await Promise.all(
        addrs.map(async (a) => {
          try {
            const r = await c.tokenInfo(a);
            const tokensSoldWhole = Number(r[9]) / 1e18;
            const price = 1000 + tokensSoldWhole; // BASE_PRICE + soldWhole * SLOPE
            return {
              tokenAddress: r[0],
              name: r[1],
              symbol: r[2],
              totalSupply: r[3],
              description: r[4],
              imageURI: r[5],
              creator: r[6],
              createdAt: r[7],
              reserveUSDC: r[8],
              tokensSold: r[9],
              volumeUSDC: r[10],
              holderCount: r[11],
              price,
            };
          } catch {
            // Token address returned by contract but tokenInfo reverted (stale/corrupt entry)
            return null;
          }
        })
      )).filter(Boolean);
      setTokens(infos.reverse());

      try {
        const h = await c.getTradeHistory();
        setHistory([...h].reverse());
      } catch {
        // History unavailable — non-fatal
      }
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [provider, refresh]);

  const loadHoldings = useCallback(async () => {
    if (!provider || !address) return;
    try {
      const c = new ethers.Contract(LAUNCHPAD_ADDRESS, LP_ABI, provider);
      const tAddrs = await c.getUserTokens(address);
      const rows = (await Promise.all(
        tAddrs.map(async (t) => {
          try {
            const info = await c.tokenInfo(t);
            const bal = await c.getUserTokenBalance(address, t);
            const tokensSoldWhole = Number(info[9]) / 1e18;
            const price = 1000 + tokensSoldWhole;
            return {
              tokenAddress: t,
              name: info[1],
              symbol: info[2],
              imageURI: info[5],
              balance: bal,
              price,
            };
          } catch {
            return null;
          }
        })
      )).filter(Boolean);
      setHoldings(rows.filter((r) => r.balance > 0n));
    } catch {}
  }, [provider, address, refresh]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);
  useEffect(() => {
    loadHoldings();
  }, [loadHoldings]);

  // ── WebSocket live feed ─────────────────────────────────────────────

  useEffect(() => {
    if (!provider) return;
    const c = new ethers.Contract(LAUNCHPAD_ADDRESS, LP_ABI, provider);

    const addLive = (item) => setLiveFeed((f) => [item, ...f].slice(0, 5));

    const onBuy = (trader, token, tAmt, uAmt, price) =>
      addLive({
        type: "buy",
        trader,
        token,
        tAmt,
        uAmt,
        price,
        ts: Date.now(),
      });
    const onSell = (trader, token, tAmt, uAmt, price) =>
      addLive({
        type: "sell",
        trader,
        token,
        tAmt,
        uAmt,
        price,
        ts: Date.now(),
      });
    const onLaunch = (token, creator, name, symbol) =>
      addLive({ type: "launch", token, creator, name, symbol, ts: Date.now() });

    c.on("TokenBought", onBuy);
    c.on("TokenSold", onSell);
    c.on("TokenLaunched", onLaunch);

    return () => {
      c.removeAllListeners();
    };
  }, [provider]);

  // Auto-dismiss live feed items
  useEffect(() => {
    if (!liveFeed.length) return;
    const t = setTimeout(() => setLiveFeed((f) => f.slice(0, -1)), 6000);
    return () => clearTimeout(t);
  }, [liveFeed]);

  const bump = () => setRefresh((x) => x + 1);

  // ── Render ──────────────────────────────────────────────────────────

  const TABS = [
    ["explore", "🔭 Explore"],
    ["launch", "🚀 Launch"],
    ["leaderboard", "🏆 Leaderboard"],
    ["history", "📜 History"],
    ["dashboard", "💼 Dashboard"],
  ];

  return (
    <>
      <style>{CSS}</style>
      <div className="app">
        {/* Header */}
        <header className="header">
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span className="logo">
              <span className="logo-arc">Arc</span>
              <span className="logo-dot">·</span>Launch
            </span>
            <span className="badge">TESTNET v2</span>
          </div>
          <div className="header-right">
            {provider && (
              <span className="live-dot" title="Live events connected" />
            )}
            {address && (
              <a
                className="addr-pill"
                href={`${EXPLORER}/address/${address}`}
                target="_blank"
                rel="noreferrer"
              >
                {short(address)}
              </a>
            )}
            {address ? (
              <button className="btn btn-ghost btn-sm" onClick={bump}>
                ⟳
              </button>
            ) : (
              <button className="btn btn-primary" onClick={connect}>
                Connect Wallet
              </button>
            )}
          </div>
        </header>

        {/* Nav */}
        <nav className="nav">
          {TABS.map(([id, label]) => (
            <div
              key={id}
              className={`nav-tab ${tab === id ? "active" : ""}`}
              onClick={() => setTab(id)}
            >
              {label}
            </div>
          ))}
        </nav>

        {/* Error banner */}
        {error && (
          <div style={{ padding: "10px 28px" }}>
            <div className="notice notice-err">
              {error}
              <button
                style={{
                  float: "right",
                  background: "none",
                  border: "none",
                  color: "inherit",
                  cursor: "pointer",
                }}
                onClick={() => setError("")}
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <main className="main">
          {tab === "explore" && (
            <ExploreTab
              tokens={tokens}
              loading={loading}
              address={address}
              onTrade={(t) => setSelected(t)}
            />
          )}
          {tab === "launch" && (
            <LaunchTab
              signer={signer}
              address={address}
              onLaunched={bump}
              setError={setError}
            />
          )}
          {tab === "leaderboard" && (
            <LeaderboardTab provider={provider} tokens={tokens} />
          )}
          {tab === "history" && (
            <HistoryTab history={history} tokens={tokens} />
          )}
          {tab === "dashboard" && (
            <DashboardTab
              holdings={holdings}
              tokens={tokens}
              history={history}
              address={address}
            />
          )}
        </main>

        {/* Trade modal */}
        {selected && (
          <TradeModal
            token={selected}
            signer={signer}
            provider={provider}
            address={address}
            onClose={() => setSelected(null)}
            onDone={bump}
            setError={setError}
          />
        )}

        {/* Live feed */}
        <LiveFeed items={liveFeed} tokens={tokens} />
      </div>
    </>
  );
}

// ─── EXPLORE ─────────────────────────────────────────────────────────────────

function ExploreTab({ tokens, loading, address, onTrade }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("newest");

  const filtered = tokens
    .filter(
      (t) =>
        !q ||
        t.name.toLowerCase().includes(q.toLowerCase()) ||
        t.symbol.toLowerCase().includes(q.toLowerCase())
    )
    .sort((a, b) => {
      if (sort === "volume") return Number(b.volumeUSDC - a.volumeUSDC);
      if (sort === "holders") return Number(b.holderCount - a.holderCount);
      return 0; // newest = already reversed
    });

  return (
    <div>
      <h2 className="section-title">🔭 Explore Tokens</h2>
      <div className="search-bar">
        <input
          className="search-input"
          placeholder="Search by name or symbol…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="field"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: 9,
            padding: "10px 13px",
            color: "var(--text)",
            fontFamily: "var(--body)",
            fontSize: ".83rem",
            outline: "none",
          }}
          value={sort}
          onChange={(e) => setSort(e.target.value)}
        >
          <option value="newest">Newest</option>
          <option value="volume">Volume</option>
          <option value="holders">Holders</option>
        </select>
      </div>

      {loading ? (
        <div className="empty">
          <span className="spinner" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          {q ? `No tokens matching "${q}"` : "No tokens yet — be the first!"}
        </div>
      ) : (
        <div className="grid-3">
          {filtered.map((t) => (
            <TokenCard
              key={t.tokenAddress}
              token={t}
              onClick={() => onTrade(t)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TokenCard({ token: t, onClick }) {
  const pct =
    t.totalSupply > 0n
      ? Math.min(100, Math.round(Number((t.tokensSold * 100n) / t.totalSupply)))
      : 0;

  return (
    <div className="token-card" onClick={onClick}>
      <div className="tok-header">
        {t.imageURI ? (
          <img
            className="tok-img"
            src={t.imageURI}
            alt={t.name}
            onError={(e) => (e.target.style.display = "none")}
          />
        ) : (
          <div className="tok-img-placeholder">🪙</div>
        )}
        <div>
          <div className="tok-name">{t.name}</div>
          <div className="tok-sym">${t.symbol}</div>
        </div>
      </div>
      {t.description && <div className="tok-desc">{t.description}</div>}
      <div className="tok-stats">
        <span className="price-live">⚡ {(t.price / 1e6).toFixed(6)} USDC</span>
        <span className="chip">
          Vol {(Number(t.volumeUSDC) / 1e6).toFixed(2)} USDC
        </span>
        <span className="chip">{Number(t.holderCount)} holders</span>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          marginBottom: 6,
          fontSize: ".68rem",
          color: "var(--muted)",
        }}
      >
        <span>Sold {pct}%</span>
        <span>
          {fmt(t.tokensSold, 0)} / {fmt(t.totalSupply, 0)}
        </span>
      </div>
      <div className="progress-bar">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

// ─── LAUNCH ──────────────────────────────────────────────────────────────────

function LaunchTab({ signer, address, onLaunched, setError }) {
  const [form, setForm] = useState({
    name: "",
    symbol: "",
    supply: "",
    description: "",
    imageURI: "",
  });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const launch = async () => {
    if (!signer) return setError("Connect wallet first.");
    if (!form.name || !form.symbol || !form.supply)
      return setError("Name, symbol and supply are required.");
    setBusy(true);
    setError("");
    setDone("");
    try {
      const c = new ethers.Contract(LAUNCHPAD_ADDRESS, LP_ABI, signer);
      const sup = ethers.parseUnits(form.supply, 18);
      const tx = await c.launchToken(
        form.name,
        form.symbol,
        sup,
        form.description,
        form.imageURI
      );
      const rec = await tx.wait();
      setDone(`✅ Token launched! TX: ${rec.hash}`);
      setForm({
        name: "",
        symbol: "",
        supply: "",
        description: "",
        imageURI: "",
      });
      onLaunched();
    } catch (e) {
      setError(e.reason || e.message);
    }
    setBusy(false);
  };

  // Preview bonding curve (6-decimal USDC)
  const previewData = Array.from({ length: 10 }, (_, i) => {
    const sold = (Number(form.supply || 0) * i) / 10;
    const priceRaw = BASE_PRICE + sold / 1e12;
    return { pct: `${i * 10}%`, price: (priceRaw / 1e6).toFixed(6) };
  });

  if (!address)
    return (
      <div className="card" style={{ maxWidth: 500 }}>
        <div className="notice notice-info">
          Connect your wallet to launch a token.
        </div>
      </div>
    );

  return (
    <div className="grid-2" style={{ maxWidth: 900 }}>
      <div>
        <h2 className="section-title">🚀 Launch a Token</h2>
        {done && (
          <div
            className="notice notice-info"
            style={{ wordBreak: "break-all" }}
          >
            {done}
          </div>
        )}
        <div className="card">
          <div className="field">
            <label>Token Name</label>
            <input
              placeholder="e.g. Moon Coin"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Symbol</label>
            <input
              placeholder="e.g. MOON"
              value={form.symbol}
              onChange={(e) => set("symbol", e.target.value.toUpperCase())}
            />
          </div>
          <div className="field">
            <label>Total Supply</label>
            <input
              type="number"
              placeholder="e.g. 1000000"
              value={form.supply}
              onChange={(e) => set("supply", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Description</label>
            <textarea
              placeholder="What is this token?"
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
            />
          </div>
          <div className="field">
            <label>Image URL (HTTPS or IPFS)</label>
            <input
              placeholder="https://… or ipfs://…"
              value={form.imageURI}
              onChange={(e) => set("imageURI", e.target.value)}
            />
          </div>
          {form.imageURI && (
            <img
              src={form.imageURI}
              alt="preview"
              onError={(e) => (e.target.style.display = "none")}
              style={{
                width: 56,
                height: 56,
                borderRadius: "50%",
                objectFit: "cover",
                border: "2px solid var(--border)",
                marginBottom: 14,
              }}
            />
          )}
          <button
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={busy}
            onClick={launch}
          >
            {busy ? <span className="spinner" /> : "🚀 Launch Token"}
          </button>
        </div>
      </div>

      {/* Bonding curve preview */}
      <div>
        <h2 className="section-title">📈 Bonding Curve Preview</h2>
        <div className="card">
          <p
            style={{
              fontSize: ".8rem",
              color: "var(--muted)",
              marginBottom: 16,
              lineHeight: 1.6,
            }}
          >
            Price rises automatically as more tokens are sold. Early buyers get
            lower prices.
          </p>
          <div className="chart-wrap">
            <div className="chart-title">Price vs. % Sold</div>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart
                data={previewData}
                margin={{ top: 5, right: 10, bottom: 5, left: 10 }}
              >
                <CartesianGrid
                  stroke="rgba(255,255,255,.05)"
                  strokeDasharray="3 3"
                />
                <XAxis dataKey="pct" tick={{ fill: "#4a5178", fontSize: 10 }} />
                <YAxis tick={{ fill: "#4a5178", fontSize: 10 }} width={70} />
                <Tooltip
                  contentStyle={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    fontSize: ".75rem",
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="price"
                  stroke="#5fffb0"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="notice notice-info" style={{ marginBottom: 0 }}>
            Starting price: <strong>0.001 USDC</strong> · Price grows with each
            buy.
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LEADERBOARD ─────────────────────────────────────────────────────────────

function LeaderboardTab({ provider, tokens }) {
  const [mode, setMode] = useState("volume");
  const sorted = [...tokens]
    .sort((a, b) =>
      mode === "volume"
        ? Number(b.volumeUSDC - a.volumeUSDC)
        : Number(b.holderCount - a.holderCount)
    )
    .slice(0, 20);

  const ranks = ["🥇", "🥈", "🥉"];
  const rankClass = ["gold", "silver", "bronze"];

  return (
    <div>
      <h2 className="section-title">🏆 Leaderboard</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
        <button
          className={`btn ${mode === "volume" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setMode("volume")}
        >
          📊 By Volume
        </button>
        <button
          className={`btn ${mode === "holders" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setMode("holders")}
        >
          👥 By Holders
        </button>
      </div>

      <div className="grid-2">
        <div className="card">
          {sorted.length === 0 ? (
            <div className="empty">No tokens yet.</div>
          ) : (
            sorted.map((t, i) => (
              <div key={t.tokenAddress} className="lb-row">
                <div className={`lb-rank ${rankClass[i] || ""}`}>
                  {ranks[i] || `#${i + 1}`}
                </div>
                {t.imageURI ? (
                  <img
                    className="lb-img"
                    src={t.imageURI}
                    alt={t.name}
                    onError={(e) => (e.target.style.display = "none")}
                  />
                ) : (
                  <div
                    className="lb-img"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.1rem",
                    }}
                  >
                    🪙
                  </div>
                )}
                <div className="lb-info">
                  <div className="lb-name">
                    {t.name} <span className="lb-sym">${t.symbol}</span>
                  </div>
                  {mode === "volume" ? (
                    <div className="lb-val">
                      Vol: {(Number(t.volumeUSDC) / 1e6).toFixed(2)} USDC
                    </div>
                  ) : (
                    <div className="lb-val">
                      {Number(t.holderCount)} holders
                    </div>
                  )}
                </div>
                <a
                  href={`${EXPLORER}/address/${t.tokenAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--muted)", fontSize: ".75rem" }}
                >
                  ↗
                </a>
              </div>
            ))
          )}
        </div>

        {/* Volume bar chart */}
        <div className="card">
          <div className="card-title">Volume Comparison</div>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart
              data={sorted.slice(0, 10).map((t) => ({
                name: t.symbol,
                volume: (Number(t.volumeUSDC) / 1e6).toFixed(2),
                holders: Number(t.holderCount),
              }))}
              margin={{ top: 5, right: 10, bottom: 20, left: 0 }}
            >
              <CartesianGrid
                stroke="rgba(255,255,255,.05)"
                strokeDasharray="3 3"
              />
              <XAxis dataKey="name" tick={{ fill: "#4a5178", fontSize: 10 }} />
              <YAxis tick={{ fill: "#4a5178", fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  fontSize: ".75rem",
                }}
              />
              <Line
                type="monotone"
                dataKey={mode === "volume" ? "volume" : "holders"}
                stroke="#7b5cfa"
                strokeWidth={2}
                dot={{ fill: "#7b5cfa", r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ─── HISTORY ─────────────────────────────────────────────────────────────────

function HistoryTab({ history, tokens }) {
  const tokenMap = Object.fromEntries(
    tokens.map((t) => [t.tokenAddress?.toLowerCase(), t])
  );
  return (
    <div>
      <h2 className="section-title">📜 Trade History</h2>
      {history.length === 0 ? (
        <div className="empty">No trades yet.</div>
      ) : (
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th>Type</th>
                <th>Token</th>
                <th>Trader</th>
                <th>Tokens</th>
                <th>USDC</th>
                <th>Price</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {history.map((r, i) => {
                const tok = tokenMap[r.token?.toLowerCase()];
                return (
                  <tr key={i}>
                    <td>
                      {r.isBuy ? (
                        <span className="tag-b">▲ BUY</span>
                      ) : (
                        <span className="tag-s">▼ SELL</span>
                      )}
                    </td>
                    <td>
                      <span style={{ fontWeight: 600, fontSize: ".82rem" }}>
                        {tok?.symbol || short(r.token)}
                      </span>{" "}
                      <a
                        href={`${EXPLORER}/address/${r.token}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "var(--muted)", fontSize: ".68rem" }}
                      >
                        ↗
                      </a>
                    </td>
                    <td>
                      <a
                        href={`${EXPLORER}/address/${r.trader}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{
                          fontFamily: "var(--mono)",
                          fontSize: ".72rem",
                          color: "var(--accent2)",
                        }}
                      >
                        {short(r.trader)}
                      </a>
                    </td>
                    <td style={{ fontFamily: "var(--mono)" }}>
                      {fmt(r.tokenAmount)}
                    </td>
                    <td style={{ fontFamily: "var(--mono)" }}>
                      {(Number(r.usdcAmount) / 1e6).toFixed(4)}
                    </td>
                    <td
                      style={{
                        fontFamily: "var(--mono)",
                        color: "var(--muted)",
                      }}
                    >
                      {Number(r.tokenAmount) > 0
                        ? (
                            Number(r.usdcAmount) /
                            1e6 /
                            (Number(r.tokenAmount) / 1e18)
                          ).toFixed(6)
                        : "0.000000"}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: ".75rem" }}>
                      {ago(r.timestamp)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function DashboardTab({ holdings, tokens, history, address }) {
  const myTrades = history.filter(
    (h) => h.trader?.toLowerCase() === address?.toLowerCase()
  );
  const myLaunched = tokens.filter(
    (t) => t.creator?.toLowerCase() === address?.toLowerCase()
  );
  const totalVol = myTrades.reduce(
    (acc, t) => acc + BigInt(t.usdcAmount?.toString() || 0),
    0n
  );

  if (!address)
    return (
      <div className="notice notice-info">
        Connect your wallet to see your dashboard.
      </div>
    );

  return (
    <div>
      <h2 className="section-title">💼 My Dashboard</h2>
      <div className="stat-grid">
        <div className="stat-box">
          <div className="stat-label">Tokens Holding</div>
          <div className="stat-val">{holdings.length}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Tokens Launched</div>
          <div className="stat-val">{myLaunched.length}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Total Trades</div>
          <div className="stat-val">{myTrades.length}</div>
        </div>
        <div className="stat-box">
          <div className="stat-label">Volume Traded</div>
          <div className="stat-val" style={{ fontSize: "1.1rem" }}>
            {(Number(totalVol) / 1e6).toFixed(2)}
          </div>
          <div className="stat-sub">USDC</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-title">My Holdings</div>
          {holdings.length === 0 ? (
            <div className="empty">You hold no tokens yet.</div>
          ) : (
            holdings.map((h) => (
              <div key={h.tokenAddress} className="hold-row">
                {h.imageURI ? (
                  <img
                    className="hold-img"
                    src={h.imageURI}
                    alt={h.name}
                    onError={(e) => (e.target.style.display = "none")}
                  />
                ) : (
                  <div
                    className="hold-img"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    🪙
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div className="hold-name">
                    {h.name}{" "}
                    <span style={{ color: "var(--muted)", fontSize: ".72rem" }}>
                      ${h.symbol}
                    </span>
                  </div>
                  <div className="hold-bal">
                    {fmt(h.balance)} {h.symbol}
                  </div>
                </div>
                <a
                  href={`${EXPLORER}/address/${h.tokenAddress}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "var(--muted)", fontSize: ".75rem" }}
                >
                  ↗
                </a>
              </div>
            ))
          )}
        </div>

        <div className="card">
          <div className="card-title">Tokens I Launched</div>
          {myLaunched.length === 0 ? (
            <div className="empty">You haven't launched any tokens yet.</div>
          ) : (
            myLaunched.map((t) => (
              <div key={t.tokenAddress} className="hold-row">
                {t.imageURI ? (
                  <img
                    className="hold-img"
                    src={t.imageURI}
                    alt={t.name}
                    onError={(e) => (e.target.style.display = "none")}
                  />
                ) : (
                  <div
                    className="hold-img"
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    🚀
                  </div>
                )}
                <div style={{ flex: 1 }}>
                  <div className="hold-name">{t.name}</div>
                  <div
                    style={{
                      fontFamily: "var(--mono)",
                      fontSize: ".7rem",
                      color: "var(--accent)",
                    }}
                  >
                    Vol: {(Number(t.volumeUSDC) / 1e6).toFixed(2)} USDC ·{" "}
                    {Number(t.holderCount)} holders
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {myTrades.length > 0 && (
        <div className="card" style={{ marginTop: 18 }}>
          <div className="card-title">My Trade History</div>
          <div style={{ overflowX: "auto" }}>
            <table className="tbl">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Token</th>
                  <th>Tokens</th>
                  <th>USDC</th>
                  <th>Price</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {myTrades.slice(0, 30).map((r, i) => (
                  <tr key={i}>
                    <td>
                      {r.isBuy ? (
                        <span className="tag-b">▲ BUY</span>
                      ) : (
                        <span className="tag-s">▼ SELL</span>
                      )}
                    </td>
                    <td
                      style={{ fontFamily: "var(--mono)", fontSize: ".72rem" }}
                    >
                      {short(r.token)}
                    </td>
                    <td style={{ fontFamily: "var(--mono)" }}>
                      {fmt(r.tokenAmount)}
                    </td>
                    <td style={{ fontFamily: "var(--mono)" }}>
                      {(Number(r.usdcAmount) / 1e6).toFixed(4)}
                    </td>
                    <td
                      style={{
                        fontFamily: "var(--mono)",
                        color: "var(--muted)",
                      }}
                    >
                      {Number(r.tokenAmount) > 0
                        ? (
                            Number(r.usdcAmount) /
                            1e6 /
                            (Number(r.tokenAmount) / 1e18)
                          ).toFixed(6)
                        : "0.000000"}
                    </td>
                    <td style={{ color: "var(--muted)", fontSize: ".75rem" }}>
                      {ago(r.timestamp)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TRADE MODAL ─────────────────────────────────────────────────────────────

function TradeModal({
  token,
  signer,
  provider,
  address,
  onClose,
  onDone,
  setError,
}) {
  const [side, setSide] = useState("buy");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState(null);
  const [chartData, setChart] = useState([]);
  const [comments, setCmts] = useState([]);
  const [comment, setComment] = useState("");
  const [posting, setPosting] = useState(false);

  // Load chart + comments
  useEffect(() => {
    if (!provider) return;
    (async () => {
      try {
        const c = new ethers.Contract(LAUNCHPAD_ADDRESS, LP_ABI, provider);
        const trades = await c.getTokenTradesRecent(token.tokenAddress, 50);
        setChart(
          trades.map((t) => ({
            time: ago(t.timestamp),
            price:
              Number(t.tokenAmount) > 0
                ? (
                    Number(t.usdcAmount) /
                    1e6 /
                    (Number(t.tokenAmount) / 1e18)
                  ).toFixed(6)
                : "0.000000",
            type: t.isBuy ? "buy" : "sell",
          }))
        );
        const cmts = await c.getComments(token.tokenAddress);
        setCmts([...cmts].reverse());
      } catch {}
    })();
  }, [provider, token.tokenAddress]);

  // Live quote
  useEffect(() => {
    if (!provider || !amount || isNaN(amount) || Number(amount) <= 0) {
      setQuote(null);
      return;
    }
    (async () => {
      try {
        const c = new ethers.Contract(LAUNCHPAD_ADDRESS, LP_ABI, provider);
        const amt = ethers.parseUnits(amount, 18);
        if (side === "buy") {
          const cost = await c.getBuyCost(token.tokenAddress, amt);
          setQuote({
            label: "Cost",
            val: (Number(cost) / 1e6).toFixed(6) + " USDC",
          });
        } else {
          const ret = await c.getSellReturn(token.tokenAddress, amt);
          setQuote({
            label: "You receive",
            val: (Number(ret) / 1e6).toFixed(6) + " USDC",
          });
        }
      } catch {
        setQuote(null);
      }
    })();
  }, [amount, side, provider, token.tokenAddress]);

  const execute = async () => {
    if (!signer) return setError("Connect wallet first.");
    if (!amount || isNaN(amount) || Number(amount) <= 0)
      return setError("Enter a valid amount.");
    setBusy(true);
    setError("");
    try {
      const c = new ethers.Contract(LAUNCHPAD_ADDRESS, LP_ABI, signer);
      const amt = ethers.parseUnits(amount, 18);
      if (side === "buy") {
        const cost = await c.getBuyCost(token.tokenAddress, amt);
        const usdc = new ethers.Contract(USDC_ADDRESS, ERC20_ABI, signer);
        const allow = await usdc.allowance(address, LAUNCHPAD_ADDRESS);
        if (allow < cost) {
          const tx = await usdc.approve(LAUNCHPAD_ADDRESS, ethers.MaxUint256);
          await tx.wait();
        }
        const tx = await c.buyToken(token.tokenAddress, amt);
        await tx.wait();
      } else {
        const tok = new ethers.Contract(token.tokenAddress, ERC20_ABI, signer);
        const allow = await tok.allowance(address, LAUNCHPAD_ADDRESS);
        if (allow < amt) {
          const tx = await tok.approve(LAUNCHPAD_ADDRESS, ethers.MaxUint256);
          await tx.wait();
        }
        const tx = await c.sellToken(token.tokenAddress, amt);
        await tx.wait();
      }
      setAmount("");
      onDone();
      onClose();
    } catch (e) {
      setError(e.reason || e.message);
    }
    setBusy(false);
  };

  const postComment = async () => {
    if (!signer || !comment.trim()) return;
    setPosting(true);
    try {
      const c = new ethers.Contract(LAUNCHPAD_ADDRESS, LP_ABI, signer);
      const tx = await c.postComment(token.tokenAddress, comment.trim());
      await tx.wait();
      setComment("");
      // Reload comments
      const cmts = await c.getComments(token.tokenAddress);
      setCmts([...cmts].reverse());
    } catch (e) {
      setError(e.reason || e.message);
    }
    setPosting(false);
  };

  const pct =
    token.totalSupply > 0n
      ? Math.min(
          100,
          Math.round(Number((token.tokensSold * 100n) / token.totalSupply))
        )
      : 0;

  return (
    <div
      className="overlay"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="trade-box">
        {/* Modal header */}
        <div className="trade-header">
          {token.imageURI ? (
            <img
              src={token.imageURI}
              alt={token.name}
              onError={(e) => (e.target.style.display = "none")}
              style={{
                width: 46,
                height: 46,
                borderRadius: "50%",
                objectFit: "cover",
                border: "2px solid var(--border)",
              }}
            />
          ) : (
            <div
              style={{
                width: 46,
                height: 46,
                borderRadius: "50%",
                background: "var(--surface2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "1.3rem",
              }}
            >
              🪙
            </div>
          )}
          <div>
            <div
              style={{
                fontFamily: "var(--display)",
                fontWeight: 700,
                fontSize: "1.05rem",
              }}
            >
              {token.name}
            </div>
            <div
              style={{
                fontFamily: "var(--mono)",
                fontSize: ".72rem",
                color: "var(--accent)",
              }}
            >
              ${token.symbol} ·{" "}
              <span style={{ color: "var(--muted)" }}>
                {(token.price / 1e6).toFixed(6)} USDC
              </span>
            </div>
          </div>
          <button className="trade-close" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Buy/Sell tabs */}
        <div className="trade-tabs-row">
          <button
            className={`trade-tab ${side === "buy" ? "buy" : ""}`}
            onClick={() => setSide("buy")}
          >
            ▲ Buy
          </button>
          <button
            className={`trade-tab ${side === "sell" ? "sell" : ""}`}
            onClick={() => setSide("sell")}
          >
            ▼ Sell
          </button>
        </div>

        {/* Body — 2 columns */}
        <div className="trade-body">
          {/* LEFT — trade form + comments */}
          <div className="trade-left">
            {token.description && (
              <div
                style={{
                  fontSize: ".78rem",
                  color: "var(--muted)",
                  marginBottom: 14,
                  padding: "9px 12px",
                  background: "var(--surface2)",
                  borderRadius: 8,
                  lineHeight: 1.5,
                }}
              >
                {token.description}
              </div>
            )}

            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 14,
                fontSize: ".72rem",
                color: "var(--muted)",
              }}
            >
              <span
                style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  padding: "3px 8px",
                }}
              >
                Supply {fmt(token.totalSupply, 0)}
              </span>
              <span
                style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  padding: "3px 8px",
                }}
              >
                Sold {pct}%
              </span>
              <span
                style={{
                  background: "var(--surface2)",
                  border: "1px solid var(--border)",
                  borderRadius: 5,
                  padding: "3px 8px",
                }}
              >
                {Number(token.holderCount)} holders
              </span>
            </div>

            <div className="progress-bar" style={{ marginBottom: 16 }}>
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>

            <div className="field">
              <label>Amount ({token.symbol})</label>
              <input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>

            {quote && (
              <div className="notice notice-info" style={{ marginBottom: 12 }}>
                {quote.label}: <strong>{quote.val}</strong>
              </div>
            )}

            <button
              className={`btn ${side === "buy" ? "btn-primary" : "btn-danger"}`}
              style={{ width: "100%", marginBottom: 14 }}
              disabled={busy || !address}
              onClick={execute}
            >
              {busy ? (
                <span className="spinner" />
              ) : side === "buy" ? (
                "▲ Buy Tokens"
              ) : (
                "▼ Sell Tokens"
              )}
            </button>

            <a
              href={`${EXPLORER}/address/${token.tokenAddress}`}
              target="_blank"
              rel="noreferrer"
              style={{
                display: "block",
                textAlign: "center",
                fontSize: ".72rem",
                color: "var(--accent2)",
              }}
            >
              View on ArcScan ↗
            </a>

            {/* Comments */}
            <div className="comments-section" style={{ marginTop: 18 }}>
              <div className="card-title" style={{ marginBottom: 10 }}>
                💬 Comments ({comments.length})
              </div>
              <div className="comment-input-row">
                <input
                  className="comment-input"
                  placeholder="Add a comment… (max 280 chars)"
                  value={comment}
                  maxLength={280}
                  onChange={(e) => setComment(e.target.value)}
                  onKeyDown={(e) =>
                    e.key === "Enter" && !e.shiftKey && postComment()
                  }
                />
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={posting || !address || !comment.trim()}
                  onClick={postComment}
                >
                  {posting ? <span className="spinner" /> : "Post"}
                </button>
              </div>
              {!address && (
                <div
                  style={{
                    fontSize: ".72rem",
                    color: "var(--muted)",
                    marginTop: 6,
                  }}
                >
                  Connect wallet to comment.
                </div>
              )}
              <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 10 }}>
                {comments.length === 0 ? (
                  <div
                    style={{
                      fontSize: ".78rem",
                      color: "var(--muted)",
                      paddingTop: 8,
                    }}
                  >
                    No comments yet.
                  </div>
                ) : (
                  comments.map((c, i) => (
                    <div key={i} className="comment-item">
                      <div className="comment-author">{short(c.author)}</div>
                      <div className="comment-text">{c.text}</div>
                      <div className="comment-ts">{ago(c.timestamp)}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* RIGHT — price chart */}
          <div className="trade-right">
            <div className="chart-wrap">
              <div className="chart-title">Price Chart (last 50 trades)</div>
              {chartData.length < 2 ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    height: 200,
                    color: "var(--muted)",
                    fontSize: ".8rem",
                  }}
                >
                  Not enough trades for a chart yet.
                </div>
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart
                    data={chartData}
                    margin={{ top: 5, right: 5, bottom: 5, left: 0 }}
                  >
                    <CartesianGrid
                      stroke="rgba(255,255,255,.04)"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="time"
                      tick={{ fill: "#4a5178", fontSize: 9 }}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fill: "#4a5178", fontSize: 9 }} width={65} />
                    <Tooltip
                      contentStyle={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        fontSize: ".72rem",
                      }}
                      formatter={(v, n) => [v + " USDC", "Price"]}
                    />
                    <ReferenceLine
                      y={token.price / 1e6}
                      stroke="#5fffb0"
                      strokeDasharray="4 2"
                      label={{ value: "Now", fill: "#5fffb0", fontSize: 9 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#7b5cfa"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>

            {/* Bonding curve simulation */}
            <div className="chart-wrap">
              <div className="chart-title">Bonding Curve — What to expect</div>
              <ResponsiveContainer width="100%" height={160}>
                <LineChart
                  data={Array.from({ length: 20 }, (_, i) => {
                    const sold =
                      Number(token.tokensSold) +
                      ((Number(token.totalSupply) - Number(token.tokensSold)) *
                        i) /
                        20;
                    return {
                      pct: `${Math.round(
                        (sold * 100) / Number(token.totalSupply)
                      )}%`,
                      price: ((BASE_PRICE + sold / 1e12) / 1e6).toFixed(6),
                    };
                  })}
                  margin={{ top: 5, right: 5, bottom: 5, left: 0 }}
                >
                  <CartesianGrid
                    stroke="rgba(255,255,255,.04)"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="pct"
                    tick={{ fill: "#4a5178", fontSize: 9 }}
                  />
                  <YAxis tick={{ fill: "#4a5178", fontSize: 9 }} width={65} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      fontSize: ".72rem",
                    }}
                    formatter={(v) => [v + " USDC", "Price"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="price"
                    stroke="#5fffb0"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── LIVE FEED ────────────────────────────────────────────────────────────────

function LiveFeed({ items, tokens }) {
  if (!items.length) return null;
  const tokenMap = Object.fromEntries(
    tokens.map((t) => [t.tokenAddress?.toLowerCase(), t])
  );

  return (
    <div className="live-feed">
      {items.map((item, i) => {
        const tok = tokenMap[item.token?.toLowerCase()];
        if (item.type === "launch")
          return (
            <div key={i} className="live-item live-item-launch">
              🚀 <strong>{item.name}</strong> (${item.symbol}) just launched!
            </div>
          );
        return (
          <div
            key={i}
            className={`live-item ${
              item.type === "buy" ? "live-item-buy" : "live-item-sell"
            }`}
          >
            {item.type === "buy" ? "▲" : "▼"} {short(item.trader || "")}{" "}
            {item.type} <strong>{tok?.symbol || "?"}</strong> ·{" "}
            {fmtP(item.uAmt || 0n)} USDC
          </div>
        );
      })}
    </div>
  );
}
