import { useState } from "react";
import { NavLink, Link } from "react-router-dom";
import { useWallet } from "../wallet";
import { fmtAddress } from "../config";

export function WalletButton() {
  const { account, connect, disconnect, connecting, error } = useWallet();

  if (account) {
    return (
      <div className="flex center gap-12">
        <span className="wallet-tag">
          <span className="dot" />
          {fmtAddress(account)}
        </span>
        <button className="btn btn-sm" onClick={disconnect}>断开</button>
      </div>
    );
  }

  return (
    <div className="flex center gap-12">
      {error && <span className="wallet-err">{error.length > 30 ? error.slice(0, 30) + "…" : error}</span>}
      <button className="btn btn-gold btn-sm" onClick={() => void connect()} disabled={connecting}>
        {connecting ? "连接中…" : "连接钱包"}
      </button>
    </div>
  );
}

const LINKS = [
  { to: "/", label: "首页", end: true },
  { to: "/launch", label: "发射台", end: false },
  { to: "/projects", label: "已发射代币", end: false },
];

export function Nav() {
  const [open, setOpen] = useState(false);

  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand" onClick={() => setOpen(false)}>
          <img src="/tvs-logo.png" alt="TVS" />
          <span>
            <span className="brand-name">TVS <em>· 藤昇</em></span>
            <span className="brand-sub" style={{ display: "block" }}>Tendril Vault · Launchpad</span>
          </span>
        </Link>

        <nav className="nav-links">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => `nav-link ${isActive ? "active" : ""}`}>
              {l.label}
            </NavLink>
          ))}
        </nav>

        <div className="nav-mobile">
          <WalletButton />
          <button
            type="button"
            className={`nav-burger ${open ? "open" : ""}`}
            aria-label="打开菜单"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            <span /><span /><span />
          </button>
        </div>
      </div>

      <div className={`nav-dropdown ${open ? "open" : ""}`}>
        {LINKS.map((l, i) => (
          <NavLink
            key={l.to}
            to={l.to}
            end={l.end}
            className={({ isActive }) => `nav-drop-item ${isActive ? "active" : ""}`}
            onClick={() => setOpen(false)}
          >
            <span className="nd-no">0{i + 1}</span>
            <span className="nd-label">{l.label}</span>
          </NavLink>
        ))}
      </div>
    </header>
  );
}