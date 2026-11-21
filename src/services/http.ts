/**
 * 统一的 HTTP 请求封装。
 *
 * uni-app 的 App 端没有浏览器原生 fetch（会直接报 fetch is not defined），
 * 账号、同步这些在 App 里也要跑的接口必须走 uni.request。
 */

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

export interface HttpResult {
  status: number;
  /** 统一转成字符串，交给调用方自己 JSON.parse，避免各端返回类型不一致 */
  body: string;
}

interface HttpOptions {
  url: string;
  method?: HttpMethod;
  header?: Record<string, string>;
  data?: unknown;
  timeout?: number;
}

export function httpRequest(options: HttpOptions): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    uni.request({
      url: options.url,
      method: options.method ?? 'GET',
      header: options.header,
      data: options.data as any,
      timeout: options.timeout ?? 20000,
      dataType: 'text',
      success: (res) => {
        const raw = res.data as unknown;
        resolve({
          status: res.statusCode,
          body: typeof raw === 'string' ? raw : JSON.stringify(raw ?? {}),
        });
      },
      fail: () => reject(new Error('network')),
    });
  });
}

/** fetch 的 init.body 是字符串；uni.request 需要对象，这里安全地转一下 */
export function parseJsonBody(body: unknown): unknown {
  if (typeof body !== 'string' || !body) return body ?? undefined;
  try {
    return JSON.parse(body);
  } catch {
    return body;
  }
}
