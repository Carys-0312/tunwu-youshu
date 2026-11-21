import Foundation
import UIKit
import UserNotifications

@objcMembers
public class TunwuNotifyNative: NSObject {

    private static var cachedPermission: String = "default"

    public static func requestPermission(_ completion: @escaping (Bool) -> Void) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { granted, _ in
            cachedPermission = granted ? "granted" : "denied"
            DispatchQueue.main.async {
                completion(granted)
            }
        }
    }

    public static func getPermission() -> String {
        return cachedPermission
    }

    public static func refreshPermission(_ completion: @escaping (String) -> Void) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let value: String
            switch settings.authorizationStatus {
            case .authorized, .provisional:
                value = "granted"
            case .denied:
                value = "denied"
            case .notDetermined:
                value = "default"
            default:
                value = "default"
            }
            cachedPermission = value
            DispatchQueue.main.async {
                completion(value)
            }
        }
    }

    // UTS 的 number 在 iOS 侧编译为 NSNumber，这里用 NSNumber 接收再取 doubleValue
    public static func schedule(_ id: String, _ title: String, _ body: String, _ at: NSNumber, _ payload: String) -> Bool {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["payload": payload]

        let date = Date(timeIntervalSince1970: at.doubleValue / 1000.0)
        if date.timeIntervalSinceNow <= 0 {
            return false
        }

        let components = Calendar.current.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: date
        )
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        let request = UNNotificationRequest(identifier: id, content: content, trigger: trigger)

        UNUserNotificationCenter.current().add(request, withCompletionHandler: nil)
        return true
    }

    public static func cancel(_ id: String) {
        UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [id])
        UNUserNotificationCenter.current().removeDeliveredNotifications(withIdentifiers: [id])
    }

    public static func cancelAll() {
        UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
        UNUserNotificationCenter.current().removeAllDeliveredNotifications()
    }

    public static func canScheduleExact() -> Bool {
        return true
    }

    public static func openSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            return
        }
        UIApplication.shared.open(url, options: [:], completionHandler: nil)
    }

    public static func consumeLaunchPayload() -> String {
        // 点击通知拉起 App 的页面跳转由 UNUserNotificationCenterDelegate 处理，
        // 当前版本先保证通知送达，启动参数留空。
        return ""
    }
}
