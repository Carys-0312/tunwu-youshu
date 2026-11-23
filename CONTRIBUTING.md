# 参与贡献

感谢你愿意一起完善「囤物有数」。这个仓库只包含 **uni-app 客户端**，服务端不在开源范围内（见 README「后端说明」）。

## 可以贡献什么

- 报告 Bug（请使用 Issue 模板，附版本、平台和复现步骤）
- 提出功能建议（说明使用场景，而不只是方案）
- 修复缺陷、改进交互与无障碍、补充纯函数测试
- 完善文档、截图和示例

## 开发环境

- Node.js 18+（推荐 20 / 22）
- npm 9+
- Android / iOS 打包需要 [HBuilderX](https://www.dcloud.io/hbuilderx.html) 5.26+

```bash
npm ci
npm run dev:h5
```

需要联调后端时，复制 `.env.example` 为 `.env.development` 并填写 `VITE_API_BASE`；不连后端也能使用库存、提醒和月报等本地功能。

## 提交流程

1. Fork 仓库，从 `main` 建分支：`feat/xxx`、`fix/xxx`、`docs/xxx`
2. 尽量让一个 PR 只做一件事；改动 UI 时附上修改前后的截图
3. 提交前在本地跑：

```bash
npm run type-check
npm test
npm run build:h5
```

涉及 App 端能力（通知、文件、原生插件）时，再跑 `npm run build:app`，并在 PR 里说明真机验证情况。

4. PR 描述里写清楚：改了什么、为什么改、怎么验证、关联的 Issue

## 不要提交

- `.env` / `.env.*`（`.env.example` 除外）、任何 API Key、服务器地址、账号密码
- `node_modules`、`dist`、`unpackage`
- 签名文件（`*.keystore`、`*.jks`、`*.p12`、`*.mobileprovision`）

## 代码约定

- Vue 3 `<script setup>` + TypeScript，类型检查必须通过
- 样式沿用现有暖黄色主题（品牌色 `#9a6514`、页面底 `#fdf6e6`），新页面保持一致
- 数据访问走 `src/db/repo.ts`，不要绕过仓储层直接写库
- 日期、热量、提醒策略等纯逻辑优先放在 `src/utils/`，便于后续补测试

## 沟通

- Issue 和 PR 请尽量使用中文或英文，描述清楚即可
- 维护者会尽量在几天内回复；涉及后端接口变更的建议，请先在 Issue 里讨论

## License

提交的代码默认以 [Apache-2.0](LICENSE) 授权。
