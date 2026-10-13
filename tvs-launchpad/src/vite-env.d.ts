/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 网络开关：设为 "testnet" 时前端连 BSC 测试网 */
  readonly VITE_NET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
