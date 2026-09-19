import { Link } from "react-router-dom";
import { config, EXPLORER_BASE } from "../config";

/** 页脚：编辑部题跋（colophon） */
export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="colophon">
          <div>
            <h4>TVS · Tendril Vault</h4>
            <p>
              首个以原生 RWA（TENDRIL）为储备的 DeFi 3.0 价值发射协议。
              以只涨不跌的 TENDRIL 为根，构建一藤多币的价值生态。
            </p>
          </div>
          <div>
            <h4>Stack</h4>
            <p>Vite · React · TypeScript · ethers v6。合约部署于 BSC，查看链上合约与开源验证。</p>
          </div>
          <div>
            <h4>Factory</h4>
            <p className="mono">{config.factoryAddress}</p>
            <a href={`${EXPLORER_BASE}/address/${config.factoryAddress}`} target="_blank" rel="noreferrer">
              View on BscScan →
            </a>
          </div>
          <div>
            <h4>Disclaimer</h4>
            <p>
              白皮书与站点机制描述均为项目公开资料，实际运行以链上合约与代码为准。
              Meme 与代币存在极高波动风险，参与前请自行研究（DYOR），勿投入超出承受能力的资金。
            </p>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© MMXXVI TVS (Tendril Vault) · 藤蔓之上，开创未来</span>
          <span>
            <Link to="/launch" style={{ color: "var(--gold-bright)" }}>立即发射 →</Link>
          </span>
        </div>
      </div>
    </footer>
  );
}