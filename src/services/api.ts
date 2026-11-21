/** 服务端地址：识别和同步共用；H5 默认沿用当前 hostname 的 8080 端口。 */
function resolveApiBase(): string {
  const configured = (import.meta.env.VITE_API_BASE as string | undefined)?.trim();
  if (configured) return configured.replace(/\/+$/, '');
  // #ifdef H5
  return `${location.protocol}//${location.hostname}:8080`;
  // #endif
  // #ifndef H5
  return 'http://127.0.0.1:8080';
  // #endif
}

export const API_BASE = resolveApiBase();
