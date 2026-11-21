/// <reference types="vite/client" />

// 构建时由 vite.config.ts 注入
declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

declare module '*.vue' {
  import { DefineComponent } from 'vue'
  // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/ban-types
  const component: DefineComponent<{}, {}, any>
  export default component
}
