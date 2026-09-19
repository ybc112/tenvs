/** TVS 藤蔓艺术 —— 线稿藤蔓 SVG（克制、学术印刷感） */
export function TendrilMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 1.15} viewBox="0 0 24 28" fill="none" aria-hidden="true">
      <path
        d="M3 25 C 3 14 9 9 19 2"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
      <path
        d="M19 2 C 15 6 12 9 12.5 13 C 13 16.5 17 17 19.5 14.5"
        stroke="currentColor"
        strokeWidth="1.1"
        strokeLinecap="round"
      />
      <path
        d="M14.5 8 C 17 6 20 6 22 7.5"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity=".6"
      />
      <path
        d="M7 21 C 4.5 21 3 22.6 3 24.6"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
        opacity=".6"
      />
    </svg>
  );
}

/** 首页主视觉：藤环 + 根/干/枝叶结构 */
export function TendrilHero({ size = 340 }: { size?: number }) {
  return (
    <svg
      width="100%"
      height="auto"
      viewBox="0 0 400 372"
      role="img"
      aria-label="TVS 一藤多币生态结构：根（TENDRIL）· 干（TVS）· 枝叶（子币）"
      style={{ maxWidth: size }}
    >
      <defs>
        <marker id="art-arr" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="8" markerHeight="8" markerUnits="userSpaceOnUse" orient="auto">
          <path d="M1 1 L7 4 L1 7 Z" fill="var(--gold)"/>
        </marker>
      </defs>
      {/* 环 */}
      <circle cx="200" cy="176" r="150" fill="none" stroke="var(--rule-strong)" strokeWidth="1" strokeDasharray="3 5" />
      <circle cx="200" cy="176" r="104" fill="none" stroke="var(--gold)" strokeWidth="0.8" opacity="0.6" />
      {/* 主藤（干线） */}
      <path d="M200 238 C 200 190 200 148 200 92" fill="none" stroke="var(--gold)" strokeWidth="1.6" strokeLinecap="round" />
      {/* 根 */}
      <path d="M200 238 C 180 262 150 288 122 318" fill="none" stroke="var(--green)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M200 238 C 220 262 250 288 278 318" fill="none" stroke="var(--green)" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M200 238 C 192 268 190 296 186 328" fill="none" stroke="var(--green)" strokeWidth="1.2" strokeLinecap="round" opacity=".7" />
      {/* 枝叶 */}
      <path d="M200 190 C 168 172 140 158 112 150" fill="none" stroke="var(--green-bright)" strokeWidth="1.2" strokeLinecap="round" markerEnd="url(#art-arr)" opacity=".85" />
      <path d="M200 150 C 170 132 146 120 124 112" fill="none" stroke="var(--green-bright)" strokeWidth="1.2" strokeLinecap="round" markerEnd="url(#art-arr)" opacity=".6" />
      <path d="M200 112 C 176 96 158 84 144 74" fill="none" stroke="var(--green-bright)" strokeWidth="1.1" strokeLinecap="round" markerEnd="url(#art-arr)" opacity=".45" />
      {/* 节点标签 */}
      <g style={{ fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".12em", textTransform: "uppercase" }}>
        <text x="200" y="84" textAnchor="middle" fill="var(--gold-bright)">TVS</text>
        <text x="200" y="260" textAnchor="middle" fill="var(--green-bright)">TENDRIL · ROOT</text>
        <text x="96" y="146" textAnchor="end" fill="var(--paper-3)">BRANCHES</text>
      </g>
    </svg>
  );
}