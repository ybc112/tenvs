import { config } from "../config";

/** 组装后端地址：VITE_BACKEND_URL 为空时走同源（dev 由 vite proxy 转发） */
function base(): string {
  return config.backendUrl.replace(/\/+$/, "");
}

export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${base()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 (${res.status})`);
  }
  return data;
}

export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}${path}`);
  const data = (await res.json().catch(() => ({}))) as T;
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 (${res.status})`);
  }
  return data;
}

/** 上传 base64 图片到后端静态资产目录 */
export async function uploadAsset(dataUrl: string) {
  return postJson<{ ok: boolean; url: string; mimeType: string; bytes: number }>("/api/assets", {
    dataUrl,
  });
}

/** 请求后端为项目排队自动验证 */
export async function requestVerify(token: string) {
  return postJson<{ ok: boolean; token: string }>("/api/verify-project", { token });
}

export async function verifyStatus(token: string) {
  return getJson<{ token: string; job: unknown }>(`/api/verify-status?token=${encodeURIComponent(token)}`);
}