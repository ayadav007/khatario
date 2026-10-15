package com.khatario.phone.khatario_phone

import android.content.Context
import android.net.wifi.WifiManager
import android.os.Build
import android.provider.Settings
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyInfo
import android.security.keystore.KeyProperties
import android.util.Base64
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.io.File
import java.security.KeyFactory
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.PrivateKey
import java.security.Signature
import java.security.spec.ECGenParameterSpec

/**
 * Khatario Staff device bridge: a signing key that lives in the Android keystore (it cannot be
 * exported or copied to another phone), nearby Wi-Fi routers, and root / emulator hints.
 * The server makes every decision; these are only evidence.
 */
class StaffDeviceChannel(private val context: Context) {
    companion object {
        const val CHANNEL = "khatario/staff_device"
        private const val KEY_ALIAS = "khatario_staff_device"
        private const val KEYSTORE = "AndroidKeyStore"
    }

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, CHANNEL).setMethodCallHandler { call, result ->
            try {
                when (call.method) {
                    "ensureKey" -> result.success(ensureKey())
                    "sign" -> result.success(sign(call.argument<String>("text") ?: ""))
                    "deleteKey" -> {
                        keyStore().deleteEntry(KEY_ALIAS)
                        result.success(null)
                    }
                    "wifiScan" -> result.success(wifiScan())
                    "integrity" -> result.success(integrity())
                    "deviceInfo" -> result.success(
                        mapOf(
                            "model" to "${Build.MANUFACTURER} ${Build.MODEL}",
                            "os_version" to "Android ${Build.VERSION.RELEASE} (SDK ${Build.VERSION.SDK_INT})",
                        ),
                    )
                    else -> result.notImplemented()
                }
            } catch (e: Exception) {
                result.error("STAFF_DEVICE", e.message, null)
            }
        }
    }

    private fun keyStore(): KeyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }

    private fun generate(strongBox: Boolean) {
        val spec = KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_SIGN)
            .setAlgorithmParameterSpec(ECGenParameterSpec("secp256r1"))
            .setDigests(KeyProperties.DIGEST_SHA256)
            .apply { if (strongBox && Build.VERSION.SDK_INT >= 28) setIsStrongBoxBacked(true) }
            .build()
        KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_EC, KEYSTORE).apply {
            initialize(spec)
            generateKeyPair()
        }
    }

    /** Public key (base64 DER SubjectPublicKeyInfo) and whether the private key is in secure hardware. */
    private fun ensureKey(): Map<String, Any> {
        val ks = keyStore()
        if (!ks.containsAlias(KEY_ALIAS)) {
            try {
                generate(strongBox = true)
            } catch (e: Exception) {
                generate(strongBox = false)
            }
        }
        val publicKey = ks.getCertificate(KEY_ALIAS).publicKey
        val privateKey = ks.getKey(KEY_ALIAS, null) as PrivateKey
        return mapOf(
            "public_key" to Base64.encodeToString(publicKey.encoded, Base64.NO_WRAP),
            "hardware_backed" to isHardwareBacked(privateKey),
        )
    }

    private fun isHardwareBacked(key: PrivateKey): Boolean = try {
        val info = KeyFactory.getInstance(key.algorithm, KEYSTORE).getKeySpec(key, KeyInfo::class.java)
        if (Build.VERSION.SDK_INT >= 31) {
            info.securityLevel == KeyProperties.SECURITY_LEVEL_TRUSTED_ENVIRONMENT ||
                info.securityLevel == KeyProperties.SECURITY_LEVEL_STRONGBOX
        } else {
            @Suppress("DEPRECATION")
            info.isInsideSecureHardware
        }
    } catch (e: Exception) {
        false
    }

    /** SHA256withECDSA, base64 DER. */
    private fun sign(text: String): String {
        val key = keyStore().getKey(KEY_ALIAS, null) as? PrivateKey
            ?: throw IllegalStateException("No device key")
        val sig = Signature.getInstance("SHA256withECDSA").apply {
            initSign(key)
            update(text.toByteArray(Charsets.UTF_8))
        }
        return Base64.encodeToString(sig.sign(), Base64.NO_WRAP)
    }

    /** Routers the phone can see now (needs location permission and location turned on). */
    @Suppress("DEPRECATION")
    private fun wifiScan(): List<Map<String, Any?>> {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        val out = LinkedHashMap<String, Map<String, Any?>>()
        try {
            wifi.connectionInfo?.let { info ->
                val bssid = info.bssid
                if (bssid != null && bssid != "02:00:00:00:00:00") {
                    out[bssid.lowercase()] = mapOf(
                        "bssid" to bssid.lowercase(),
                        "ssid" to info.ssid?.trim('"'),
                        "rssi" to info.rssi,
                        "connected" to true,
                    )
                }
            }
            // Throttled by Android; a refused scan still leaves the recent results.
            wifi.startScan()
            for (r in wifi.scanResults) {
                val bssid = r.BSSID?.lowercase() ?: continue
                if (out.containsKey(bssid)) continue
                out[bssid] = mapOf("bssid" to bssid, "ssid" to r.SSID, "rssi" to r.level, "connected" to false)
            }
        } catch (e: SecurityException) {
            // Without location permission the scan is empty; the server treats that as "Wi-Fi not seen".
        }
        return out.values.take(60)
    }

    private fun integrity(): Map<String, Any> {
        val hints = mutableListOf<String>()
        val suPaths = listOf(
            "/system/bin/su", "/system/xbin/su", "/sbin/su", "/system/su", "/vendor/bin/su",
            "/su/bin/su", "/data/local/su", "/data/local/xbin/su", "/data/local/bin/su",
            "/system/app/Superuser.apk", "/data/adb/magisk", "/data/adb/ksu",
        )
        if (suPaths.any { File(it).exists() }) hints.add("su_binary")
        if (Build.TAGS?.contains("test-keys") == true) hints.add("test_keys")
        if (System.getenv("PATH")?.split(":")?.any { File(it, "su").exists() } == true) hints.add("su_on_path")
        val rooted = hints.isNotEmpty()

        val emulatorHints = mutableListOf<String>()
        val fp = Build.FINGERPRINT ?: ""
        if (fp.startsWith("generic") || fp.startsWith("unknown") || fp.contains("emulator")) emulatorHints.add("fingerprint")
        val hw = (Build.HARDWARE ?: "").lowercase()
        if (hw.contains("goldfish") || hw.contains("ranchu") || hw.contains("vbox")) emulatorHints.add("hardware")
        val product = (Build.PRODUCT ?: "").lowercase()
        if (product.contains("sdk") || product.contains("emulator") || product.contains("simulator")) emulatorHints.add("product")
        if ((Build.MODEL ?: "").contains("Android SDK built for")) emulatorHints.add("model")
        if (File("/dev/qemu_pipe").exists() || File("/dev/socket/qemud").exists()) emulatorHints.add("qemu")
        hints.addAll(emulatorHints.map { "emulator_$it" })

        val resolver = context.contentResolver
        val devOptions = Settings.Global.getInt(resolver, Settings.Global.DEVELOPMENT_SETTINGS_ENABLED, 0) == 1
        val adb = Settings.Global.getInt(resolver, Settings.Global.ADB_ENABLED, 0) == 1

        return mapOf(
            "rooted" to rooted,
            "emulator" to (emulatorHints.size >= 2),
            "developer_options" to devOptions,
            "adb_enabled" to adb,
            "hints" to hints,
        )
    }
}
