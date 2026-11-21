/**
 * 头像选择 + 压缩。
 *
 * 头像按 data URL 存进账号资料，所以先在本地压到 256px 的 JPEG：
 * H5 走 canvas，App 走 uni.compressImage + 文件系统读 base64。
 * 压完一般 20~40KB，服务端限制 700k 字符。
 */

const MAX_SIDE = 256;
const JPEG_QUALITY = 0.82;

function isWebPlatform(): boolean {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'web';
  } catch {
    return typeof document !== 'undefined';
  }
}

function chooseOneImage(): Promise<string> {
  return new Promise((resolve, reject) => {
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const path = Array.isArray(res.tempFilePaths) ? res.tempFilePaths[0] : '';
        if (path) {
          resolve(path);
        } else {
          reject(new Error('没有拿到图片'));
        }
      },
      fail: (err) => {
        const message = String((err as { errMsg?: string })?.errMsg || '');
        reject(new Error(message.includes('cancel') ? '已取消' : '选择图片失败'));
      },
    });
  });
}

/** 浏览器里用 canvas 缩放并转 JPEG */
function compressInBrowser(src: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const width = image.width || MAX_SIDE;
      const height = image.height || MAX_SIDE;
      const scale = Math.min(1, MAX_SIDE / Math.max(width, height));
      const targetWidth = Math.max(1, Math.round(width * scale));
      const targetHeight = Math.max(1, Math.round(height * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('当前浏览器不支持图片处理'));
        return;
      }
      ctx.drawImage(image, 0, 0, targetWidth, targetHeight);
      resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
    };
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = src;
  });
}

/** App 端：先让 uni 压缩，再读成 base64 */
async function compressInApp(src: string): Promise<string> {
  let path = src;
  try {
    const result = await new Promise<{ tempFilePath?: string }>((resolve, reject) => {
      uni.compressImage({
        src,
        quality: 80,
        compressedWidth: MAX_SIDE,
        success: (res) => resolve(res as { tempFilePath?: string }),
        fail: reject,
      });
    });
    if (result?.tempFilePath) path = result.tempFilePath;
  } catch {
    // 压缩不可用就用原图，服务端会再校验大小
  }

  const base64 = await new Promise<string>((resolve, reject) => {
    const fs = (uni as unknown as {
      getFileSystemManager: () => {
        readFile: (options: {
          filePath: string;
          encoding: string;
          success: (res: { data?: string }) => void;
          fail: (err: unknown) => void;
        }) => void;
      };
    }).getFileSystemManager();
    fs.readFile({
      filePath: path,
      encoding: 'base64',
      success: (res) => resolve(String(res.data || '')),
      fail: reject,
    });
  });

  const mime = /\.png$/i.test(path) ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${base64}`;
}

/** 让用户选一张图，返回可以直接存进账号资料的 data URL */
export async function pickAvatar(): Promise<string> {
  const src = await chooseOneImage();
  return isWebPlatform() ? compressInBrowser(src) : compressInApp(src);
}
