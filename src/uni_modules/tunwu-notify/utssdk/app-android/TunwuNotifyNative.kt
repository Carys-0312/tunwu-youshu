package uts.sdk.modules.tunwuNotify

import android.Manifest
import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import io.dcloud.uts.UTSAndroid
import org.json.JSONObject

/**
 * Android 系统级通知调度。
 *
 * 计划同时写入 SharedPreferences 并登记到 AlarmManager；App 进程被杀后，
 * 由静态注册的 TunwuNotifyReceiver 到点唤起并展示通知；开机后由
 * TunwuNotifyBootReceiver 重新登记未触发的计划。
 */
object TunwuNotifyNative {

    const val CHANNEL_ID = "tunwu-expiry"
    const val PREFS = "tunwu_notify"
    const val KEY_PREFIX = "n_"
    const val ACTION_FIRE = "com.tunwu.youshu.NOTIFY_FIRE"
    const val EXTRA_ID = "id"
    const val EXTRA_TITLE = "title"
    const val EXTRA_BODY = "body"
    const val EXTRA_PAYLOAD = "payload"

    private const val CHANNEL_NAME = "临期提醒"

    fun ensureChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        val channel = NotificationChannel(
            CHANNEL_ID,
            CHANNEL_NAME,
            NotificationManager.IMPORTANCE_HIGH
        ).apply {
            description = "食品到期前的系统提醒"
            enableVibration(true)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        manager.createNotificationChannel(channel)
    }

    // UTS 的 number 在 Android 侧编译为 kotlin.Number，这里用 Number 接收再转 Long
    fun schedule(id: String, title: String, body: String, at: Number, payload: String?): Boolean {
        val context = UTSAndroid.getAppContext() ?: return false
        val atMillis = at.toLong()
        if (atMillis <= System.currentTimeMillis()) return false

        ensureChannel(context)
        val json = JSONObject()
        json.put("title", title)
        json.put("body", body)
        json.put("at", atMillis)
        json.put("payload", payload ?: "")
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .putString(KEY_PREFIX + id, json.toString())
            .apply()

        val ok = setAlarm(context, id, title, body, atMillis, payload)
        if (!ok) {
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .edit()
                .remove(KEY_PREFIX + id)
                .apply()
        }
        return ok
    }

    private fun setAlarm(
        context: Context,
        id: String,
        title: String,
        body: String,
        at: Long,
        payload: String?
    ): Boolean {
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, TunwuNotifyReceiver::class.java).apply {
            action = ACTION_FIRE
            putExtra(EXTRA_ID, id)
            putExtra(EXTRA_TITLE, title)
            putExtra(EXTRA_BODY, body)
            putExtra(EXTRA_PAYLOAD, payload)
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pending = PendingIntent.getBroadcast(context, id.hashCode(), intent, flags)

        return try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
                // 没有精确闹钟权限时降级为非精确闹钟，仍能在 Doze 下唤醒
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            } else {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
            }
            true
        } catch (e: SecurityException) {
            // 部分厂商在权限被回收时仍抛 SecurityException，再降一级
            try {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending)
                true
            } catch (second: Exception) {
                false
            }
        } catch (e: Exception) {
            false
        }
    }

    fun cancel(id: String) {
        val context = UTSAndroid.getAppContext() ?: return
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        val intent = Intent(context, TunwuNotifyReceiver::class.java).apply {
            action = ACTION_FIRE
        }
        val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        val pending = PendingIntent.getBroadcast(context, id.hashCode(), intent, flags)
        manager.cancel(pending)
        pending.cancel()
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(KEY_PREFIX + id)
            .apply()
    }

    fun cancelAll() {
        val context = UTSAndroid.getAppContext() ?: return
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        for (key in prefs.all.keys.toList()) {
            if (key.startsWith(KEY_PREFIX)) {
                cancel(key.substring(KEY_PREFIX.length))
            }
        }
    }

    /** 开机或应用更新后，把未触发的计划重新登记到 AlarmManager。
     *  这里显式接收 Receiver 的 Context：开机广播可能早于 UTS 运行时初始化，
     *  不能依赖 UTSAndroid.getAppContext()。 */
    fun rescheduleAll(context: Context) {
        val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()

        for ((key, value) in prefs.all.toMap()) {
            if (!key.startsWith(KEY_PREFIX) || value !is String) continue
            val id = key.substring(KEY_PREFIX.length)
            try {
                val json = JSONObject(value)
                val at = json.optLong("at", 0L)
                if (at <= now) {
                    // 关机期间已经错过的计划丢弃，App 打开时会做一次补查
                    prefs.edit().remove(key).apply()
                    continue
                }
                setAlarm(
                    context,
                    id,
                    json.optString("title", "囤物有数"),
                    json.optString("body", "有物品快到保质期了"),
                    at,
                    json.optString("payload", "")
                )
            } catch (e: Exception) {
                prefs.edit().remove(key).apply()
            }
        }
    }

    fun postNotification(
        context: Context,
        id: String,
        title: String,
        body: String,
        payload: String
    ) {
        ensureChannel(context)

        val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val contentIntent = if (launch != null) {
            launch.putExtra(EXTRA_PAYLOAD, payload)
            launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            PendingIntent.getActivity(context, id.hashCode(), launch, flags)
        } else {
            null
        }

        val builder = Notification.Builder(context, CHANNEL_ID)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            // 系统内置图标，避免把自适应启动图标当成小图标导致通知不显示
            .setSmallIcon(android.R.drawable.ic_popup_reminder)
            .setAutoCancel(true)

        if (contentIntent != null) {
            builder.setContentIntent(contentIntent)
        }

        try {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            manager.notify(id.hashCode(), builder.build())
        } catch (e: Exception) {
            // 通知权限被拒或渠道被关闭时静默失败，App 内仍会有补查
        }
    }

    /**
     * 标准基座不会合并插件的 AndroidManifest.xml，接收器没有静态注册时
     * 闹钟到点也起不来。这里查一次组件信息，避免把 L1 误报成 L2。
     */
    fun isReceiverRegistered(): Boolean {
        val context = UTSAndroid.getAppContext() ?: return false
        return try {
            context.packageManager.getReceiverInfo(
                ComponentName(context, TunwuNotifyReceiver::class.java),
                0
            )
            true
        } catch (e: Exception) {
            false
        }
    }

    fun getPermission(): String {
        val context = UTSAndroid.getAppContext() ?: return "unsupported"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
            if (!granted) return "denied"
        }
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        return if (manager.areNotificationsEnabled()) "granted" else "denied"
    }

    fun canScheduleExact(): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true
        val context = UTSAndroid.getAppContext() ?: return false
        val manager = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
        return manager.canScheduleExactAlarms()
    }

    fun openSettings() {
        val context = UTSAndroid.getAppContext() ?: return
        try {
            val intent = Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            // 个别 ROM 没有这个设置页，忽略
        }
    }

    fun openExactAlarmSettings() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return
        val context = UTSAndroid.getAppContext() ?: return
        try {
            val intent = Intent(
                Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                Uri.parse("package:${context.packageName}")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(intent)
        } catch (e: Exception) {
            openSettings()
        }
    }

    /** 冷启动时从启动 Intent 里取出通知携带的页面路径，取完即清 */
    fun consumeLaunchPayload(): String {
        val activity = UTSAndroid.getUniActivity() ?: return ""
        val intent = activity.intent ?: return ""
        val payload = intent.getStringExtra(EXTRA_PAYLOAD) ?: ""
        if (payload.isNotEmpty()) {
            intent.removeExtra(EXTRA_PAYLOAD)
        }
        return payload
    }
}

class TunwuNotifyReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != TunwuNotifyNative.ACTION_FIRE) return
        val id = intent.getStringExtra(TunwuNotifyNative.EXTRA_ID) ?: return
        val title = intent.getStringExtra(TunwuNotifyNative.EXTRA_TITLE) ?: "囤物有数"
        val body = intent.getStringExtra(TunwuNotifyNative.EXTRA_BODY) ?: "有物品快到保质期了"
        val payload = intent.getStringExtra(TunwuNotifyNative.EXTRA_PAYLOAD) ?: ""

        TunwuNotifyNative.postNotification(context, id, title, body, payload)
        context.getSharedPreferences(TunwuNotifyNative.PREFS, Context.MODE_PRIVATE)
            .edit()
            .remove(TunwuNotifyNative.KEY_PREFIX + id)
            .apply()
    }
}

class TunwuNotifyBootReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == Intent.ACTION_BOOT_COMPLETED ||
            intent.action == Intent.ACTION_MY_PACKAGE_REPLACED
        ) {
            TunwuNotifyNative.rescheduleAll(context)
        }
    }
}
