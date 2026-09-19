import { Link } from "react-router-dom";
import { config } from "../config";

/** 占位模式提示（TVS 合约未部署时展示） */
export function PlaceholderBanner() {
  if (config.contractsReady) return null;
  return (
    <div className="banner">
      <span className="banner-mark">‡</span>
      <div>
        <h4>占位模式 · 合约待部署</h4>
        <p>
          {config.placeholderNote}
        </p>
      </div>
    </div>
  );
}

/** 发射/铸造动作可用性提示（占位模式下返回不可用原因） */
export function gateReason(): string | null {
  if (!config.contractsReady) return config.placeholderNote;
  return null;
}

/** 可用的发射链接（占位模式仍允许浏览表单） */
export function LaunchGateLink({ children }: { children?: React.ReactNode }) {
  if (config.contractsReady) return <Link to="/launch">{children ?? "开始发射 →"}</Link>;
  return <Link to="/launch">{children ?? "预览发射台 →"}</Link>;
}