declare module '@/uni_modules/tunwu-notify' {
  export type NotifyPermission = 'granted' | 'denied' | 'default' | 'unsupported'
  export type NotifyLevel = 'L1' | 'L2'

  export interface ScheduleOptions {
    id: string
    title: string
    body: string
    /** 触发时间，毫秒时间戳 */
    at: number
    /** 点击通知后打开的页面路径 */
    payload?: string
  }

  export interface NotifyCapability {
    supported: boolean
    permission: NotifyPermission
    exactAlarm: boolean
    channelReady: boolean
    level: NotifyLevel
  }

  export function schedule(options: ScheduleOptions): boolean
  export function cancel(id: string): void
  export function cancelAll(): void
  export function getPermission(): NotifyPermission
  export function getCapability(): NotifyCapability
  export function requestPermission(): Promise<boolean>
  /** iOS 专用：刷新缓存的授权状态 */
  export function refreshPermission(): Promise<NotifyPermission>
  export function openSettings(): void
  export function openExactAlarmSettings(): void
  export function consumeLaunchPayload(): string
}
