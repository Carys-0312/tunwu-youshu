# tunwu-notify

囤物有数的系统级本地通知插件，用于把「临期提醒」从 App 进程内的延迟消息升级到 L2：

- Android：`AlarmManager` 精确闹钟 + 静态注册的 `BroadcastReceiver` + 独立 `NotificationChannel`；开机后自动重排未触发的计划。
- iOS：`UNUserNotificationCenter` + `UNCalendarNotificationTrigger`，计划由系统持有。
- App 被用户从最近任务划掉、进程被系统回收后，已登记的提醒仍会到点展示。
- 不支持 H5；H5 由 `reminders.ts` 回退到浏览器通知。

## 目录

```
tunwu-notify/
├─ package.json
└─ utssdk/
   ├─ interface.uts
   ├─ app-android/
   │  ├─ index.uts              # UTS 桥接
   │  ├─ TunwuNotifyNative.kt   # AlarmManager / 通知渠道 / 接收器
   │  ├─ AndroidManifest.xml    # 静态注册接收器与权限
   │  └─ config.json
   └─ app-ios/
      ├─ index.uts
      └─ TunwuNotifyNative.swift
```

## 构建要求

1. **HBuilderX 4.25+**（Swift/Kotlin 混编需要）。
2. **必须使用自定义基座或云打包**。标准基座不会合并插件的 `AndroidManifest.xml`，接收器没有静态注册，`getCapability()` 会返回 `supported: false`，App 自动退回 L1。
3. Android 最低 8.0（`minSdkVersion 26`）。Android 13+ 需要用户允许通知；Android 12+ 需要允许「闹钟和提醒」。
4. iOS 需要 macOS/云打包与推送证书环境；本地通知本身不需要 APNs，但需要在系统弹窗中允许通知。

## 验收步骤（Android 真机）

1. 用自定义基座或云打包安装 APK。
2. 打开「我的 → 提醒」，确认「系统级提醒」显示「已就绪」。
3. 点「测试系统通知」，弹窗提示后把 App 从最近任务划掉。
4. 约 1 分钟后通知栏应出现「囤物有数 · 测试提醒」，点击能回到 App。
5. 若显示「精确闹钟未开」，点「允许精确闹钟」到系统设置打开后重试。

## 已知边界

- L3（厂商省电策略清理）需要 UniPush 2.0 + 厂商通道，不在本插件范围内。
- L4（用户在设置里「强行停止」）会被 Android 阻断，任何本地方案都不保证。
- 部分厂商（小米、华为、OPPO、vivo）需要把 App 加入自启动/后台运行白名单，否则提醒可能延迟。
- iOS 点击通知后的页面跳转暂未实现，先保证通知送达。

## API

```ts
import {
  schedule, cancel, cancelAll, getPermission, getCapability,
  requestPermission, openSettings, openExactAlarmSettings,
  consumeLaunchPayload
} from '@/uni_modules/tunwu-notify'

schedule({ id: 'expiry-2026-11-07', title: '临期提醒', body: '牛奶明天到期', at: Date.now() + 60000 })
```

`getCapability()` 返回：

```ts
{
  supported: boolean      // 原生接收器是否已注册（标准基座为 false）
  permission: 'granted' | 'denied' | 'default' | 'unsupported'
  exactAlarm: boolean     // Android 12+ 精确闹钟权限
  channelReady: boolean
  level: 'L1' | 'L2'
}
```
