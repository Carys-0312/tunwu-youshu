import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import uni from '@dcloudio/vite-plugin-uni';

// 版本号以 manifest.json 为准，避免打包信息和页面显示各写一份
const manifestText = readFileSync(new URL('./src/manifest.json', import.meta.url), 'utf8');
const appVersion = /"versionName"\s*:\s*"([^"]+)"/.exec(manifestText)?.[1] ?? '0.0.0';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

function buildStamp(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [uni()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __BUILD_TIME__: JSON.stringify(buildStamp()),
  },
  server: {
    // 允许手机在同一局域网访问 H5 预览
    host: '0.0.0.0',
    port: 5173,
  },
});
