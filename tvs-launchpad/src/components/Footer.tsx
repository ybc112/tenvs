import { Link } from "react-router-dom";

/** 页脚：1:1 对齐 TVS官网/index.html 的 footer 结构 */
export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        <div className="footer-inner">
          <div className="footer-brand">
            <div className="logo">
              <img src="/tvs-logo.png" alt="TVS Logo" style={{ height: 56, width: "auto", borderRadius: 8 }} />
            </div>
            <p>首个以原生RWA为储备的DeFi 3.0发射协议。以只涨不跌的TENDRIL为根，构建一藤多币的价值生态。</p>
          </div>
          <div className="footer-col">
            <h5>产品</h5>
            <ul>
              <li><Link to="/launch">发射平台</Link></li>
              <li><Link to="/projects">已发射代币</Link></li>
              <li><a href="#">IWO发行</a></li>
              <li><a href="#">FUSE质押</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <h5>资源</h5>
            <ul>
              <li><a href="#roadmap">白皮书</a></li>
              <li><a href="#">合约审计</a></li>
              <li><a href="#">开发者文档</a></li>
              <li><a href="#">品牌资源</a></li>
            </ul>
          </div>
          <div className="footer-col">
            <h5>关于</h5>
            <ul>
              <li><a href="#">团队</a></li>
              <li><a href="#">合作伙伴</a></li>
              <li><a href="#">联系我们</a></li>
              <li><a href="#">品牌资源</a></li>
            </ul>
          </div>
        </div>
        <div className="footer-bottom">
          <p>© 2026 TVS (Tendril Vault). All rights reserved.</p>
          <p>藤蔓之上，开创未来</p>
        </div>
        <div className="disclaimer">
          ⚠️ 风险提示：加密货币投资具有高波动性和高风险性，可能导致本金全部损失。本网站内容仅供信息参考，不构成任何投资建议、要约或招揽。TVS和TENDRIL的机制描述基于项目公开资料，实际运行以链上合约为准。过去的表现不代表未来结果。请根据自身风险承受能力谨慎决策，切勿投资超出承受能力的资金。
        </div>
      </div>
    </footer>
  );
}