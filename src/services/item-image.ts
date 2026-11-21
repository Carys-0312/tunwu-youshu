/**
 * 物品照片的选取与保存。
 *
 * 拍到的临时地址不能直接存：H5 的 blob: 地址刷新就失效，所以这里存成
 * 压缩后的 data URL；App 端存到应用私有目录，存路径即可。
 */

/** H5：缩到最长边 1280 再转 jpeg，避免 IndexedDB 里塞几 MB 的原图 */
// #ifdef H5
function shrinkToDataUrl(path: string, maxSide = 1280, quality = 0.82): Promise<string> {
  return new Promise<string>((resolve) => {
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(path);
          return;
        }
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      } catch {
        // 跨域画布等异常就退回临时地址，至少本次会话能看
        resolve(path);
      }
    };
    image.onerror = () => resolve(path);
    image.src = path;
  });
}
// #endif

/** 把 chooseImage 拿到的临时路径转成能长期保存的地址 */
export function persistImage(path: string): Promise<string | null> {
  if (!path) return Promise.resolve(null);

  // #ifdef APP-PLUS
  return new Promise<string | null>((resolve) => {
    uni.saveFile({
      tempFilePath: path,
      success: (res) => resolve(res.savedFilePath),
      fail: () => resolve(path),
    });
  });
  // #endif

  // #ifdef H5
  return shrinkToDataUrl(path);
  // #endif

  // #ifndef APP-PLUS
  // #ifndef H5
  return Promise.resolve(path);
  // #endif
  // #endif
}

/** 让用户选一张图并直接存好；取消或失败返回 null */
export function chooseAndPersistImage(source: 'camera' | 'album'): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    uni.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: [source],
      success: async (res) => {
        const path = Array.isArray(res.tempFilePaths) ? res.tempFilePaths[0] : '';
        if (!path) {
          resolve(null);
          return;
        }
        try {
          resolve(await persistImage(path));
        } catch {
          resolve(null);
        }
      },
      fail: () => resolve(null),
    });
  });
}
