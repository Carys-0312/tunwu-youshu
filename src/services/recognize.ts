/**
 * 拍照识别服务：把图片传到服务端 AI 代理（server/，Spring Boot + LangChain4j），
 * 由服务端持有模型 Key。前端不接触 Key。
 */

import { API_BASE } from './api';
import { logDetail, logInfo, logWarn } from './logger';

export interface RecognitionConfidence {
  name: number;
  category: number;
  dates: number;
  storage: number;
}

export interface RecognizedItem {
  name: string;
  category: string;
  quantity: number;
  unit: string;
  production_date: string | null;
  expiry_date: string | null;
  /** 包装上的保质期原文，如「6个月」，用于展示，不参与计算 */
  shelf_life_text: string | null;
  storage_text: string | null;
  /** 日期是从哪张照片、按什么依据判断的，一句话；没有日期时为 null */
  date_note: string | null;
  /** 每件（每份）热量 kcal；非食品或读不到时为 null */
  calories: number | null;
  /** 模型原始分类名；超出内置分类时 category 会是「其他」，这里保留原值 */
  category_guess?: string | null;
  /** 模型原始分类是否属于内置分类；旧版服务端不返回时视为 true */
  category_known?: boolean;
  /** 模型为什么选这个分类，一句话；没给时为 null */
  category_reason?: string | null;
  /** 模型自评把握，不是概率，只用来提示核对；模型没给时为 null */
  confidence: RecognitionConfidence | null;
}

interface RecognitionResponse {
  items: RecognizedItem[];
  model?: string;
}

/** 上传 + 模型识别的总超时。服务端模型本身 60 秒超时，这里再留一点余量。 */
const UPLOAD_TIMEOUT_MS = 90_000;

export type RecognizeErrorKind = 'network' | 'timeout' | 'server' | 'request';

/** 便于页面区分「网络问题」和「照片本身有问题」，文案已经写成可以直接展示的中文 */
export class RecognizeError extends Error {
  readonly kind: RecognizeErrorKind;

  constructor(message: string, kind: RecognizeErrorKind) {
    super(message);
    this.name = 'RecognizeError';
    this.kind = kind;
  }
}

/** 把 HTTP 响应统一转成业务结果，两个平台的上传实现共用 */
function readResponse(status: number, body: string): RecognitionResponse {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    // 服务端返回了非 JSON（例如网关错误页），下面按状态码处理
  }

  if (status >= 200 && status < 300) {
    const items = (parsed as RecognitionResponse | null)?.items;
    if (!Array.isArray(items)) {
      throw new RecognizeError('识别服务返回的内容看不懂，稍后再试', 'server');
    }
    return { items, model: (parsed as RecognitionResponse).model };
  }

  const serverMessage = (parsed as { error?: string } | null)?.error;
  console.warn('[recognize] 识别请求失败', status, serverMessage || body.slice(0, 200));

  if (status === 413) {
    throw new RecognizeError('照片太大了，换一张或重拍一次', 'request');
  }
  if (status === 400 || status === 415) {
    // 服务端这些状态码的提示都是给用户看的（图片为空、格式不对等），但为了不把内部术语露给用户，统一成一句话
    throw new RecognizeError('这张照片传不上去，换一张再试', 'request');
  }
  if (status === 503) {
    throw new RecognizeError('识别服务暂时不可用，可以手动填写', 'server');
  }
  throw new RecognizeError('识别服务暂时没成功，稍后再试', 'server');
}

// #ifdef H5
/** H5 用 fetch + FormData，浏览器原生支持多文件且可以按字段名区分 */
async function uploadH5(paths: string[], roles: string[]): Promise<RecognitionResponse> {
  const form = new FormData();
  form.append('roles', roles.join(','));
  for (let i = 0; i < paths.length; i += 1) {
    const local = await fetch(paths[i]);
    if (!local.ok) {
      throw new RecognizeError('照片读取失败，重新拍一张试试', 'request');
    }
    // 每张用不同的字段名：服务端按 image0、image1 的顺序合并成一件商品
    form.append(`image${i}`, await local.blob(), `photo${i}.jpg`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/api/recognize`, {
      method: 'POST',
      body: form,
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    return readResponse(res.status, await res.text());
  } catch (err) {
    if (err instanceof RecognizeError) throw err;
    if (controller.signal.aborted) {
      throw new RecognizeError('识别服务这次响应太慢', 'timeout');
    }
    console.warn('[recognize] 网络请求失败', err, API_BASE);
    throw new RecognizeError('连不上识别服务，检查一下手机网络', 'network');
  } finally {
    clearTimeout(timer);
  }
}
// #endif

// #ifndef H5
/**
 * App 端用 plus.uploader 而不是 uni.uploadFile 的 files：
 * uni.uploadFile 要求每个文件的字段名唯一，同名文件在 App 端只会传上去一张，
 * 结果第二张日期特写永远到不了服务端，识别自然总是缺日期或者直接为空。
 */
function uploadApp(paths: string[], roles: string[]): Promise<RecognitionResponse> {
  return new Promise((resolve, reject) => {
    const task = plus.uploader.createUpload(
      `${API_BASE}/api/recognize`,
      {
        method: 'POST',
        // 单位是秒；只等服务器响应，不包括上传本身的耗时
        timeout: UPLOAD_TIMEOUT_MS / 1000,
        // 不自动重试：模型调用很贵，失败后由用户决定要不要再来一次
        retry: 0,
      },
      (upload, status) => {
        if (status === 0) {
          console.warn('[recognize] 上传失败', upload, API_BASE);
          reject(new RecognizeError('连不上识别服务，检查一下手机网络', 'network'));
          return;
        }
        try {
          resolve(readResponse(status, upload.responseText || ''));
        } catch (err) {
          reject(err);
        }
      },
    );

    task.addData('roles', roles.join(','));
    let added = 0;
    paths.forEach((path, index) => {
      if (task.addFile(path, { key: `image${index}`, name: `photo${index}.jpg`, mime: 'image/jpeg' })) {
        added += 1;
      }
    });
    if (!added) {
      reject(new RecognizeError('照片读取失败，重新拍一张试试', 'request'));
      return;
    }
    task.start();
  });
}
// #endif

function upload(paths: string[], roles: string[]): Promise<RecognitionResponse> {
  // #ifdef H5
  return uploadH5(paths, roles);
  // #endif
  // #ifndef H5
  return uploadApp(paths, roles);
  // #endif
}

/**
 * 识别 1~3 张照片。多张照片视为同一件商品的不同角度，由服务端合并成一条记录。
 *
 * roles 和 paths 一一对应：front（包装正面）、back（背面或日期特写）。
 * 一定要带——第二张往往只有一小块日期喷码，模型没有这个提示会把它当成另一件商品。
 *
 * 返回空数组表示「照片里没找到包装」，这是正常结果，不是异常，由页面温和提示。
 */
export async function recognizeImages(paths: string[], roles: string[] = []): Promise<RecognizedItem[]> {
  const images = paths.filter(Boolean);
  if (!images.length) throw new RecognizeError('没有图片', 'request');

  try {
    const { items, model } = await upload(images, roles.slice(0, images.length));
    logInfo(
      '识别',
      `识别完成：${items.length ? `${items.length} 件` : '没找到包装'}`,
      `${images.length} 张照片${model ? ` · ${model}` : ''}`,
    );
    return items;
  } catch (err) {
    logWarn('识别', '识别失败', logDetail(err));
    throw err;
  }
}
