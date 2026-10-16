package com.khatario.phone.khatario_phone

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.PendingIntent
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothClass
import android.bluetooth.BluetoothManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.provider.Settings
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import io.flutter.plugin.common.BinaryMessenger
import io.flutter.plugin.common.MethodChannel
import java.util.UUID
import java.util.concurrent.Executors

/**
 * Moves printer bytes for the phone app. The bytes (ESC/POS bills, TSPL / ZPL labels, Hindi drawn
 * as images) come ready from the server (POST /api/print/render); this only sends them:
 *   - Classic Bluetooth (SPP / RFCOMM) printers paired in phone Settings, the common Indian thermals;
 *   - USB printers on an OTG cable (printer-class or vendor bulk-out endpoint).
 * Network printers are reached from Dart directly (TCP 9100).
 */
class ThermalPrinterChannel(private val activity: Activity) {
    companion object {
        const val CHANNEL = "khatario/thermal_printer"
        private val SPP_UUID: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")
        private const val USB_PERMISSION = "com.khatario.phone.USB_PERMISSION"
        private const val CHUNK = 512
    }

    private val io = Executors.newSingleThreadExecutor()

    fun register(messenger: BinaryMessenger) {
        MethodChannel(messenger, CHANNEL).setMethodCallHandler { call, result ->
            val reply = { block: () -> Any? ->
                io.execute {
                    try {
                        val value = block()
                        activity.runOnUiThread { result.success(value) }
                    } catch (e: PrinterException) {
                        activity.runOnUiThread { result.error(e.code, e.message, null) }
                    } catch (e: Exception) {
                        activity.runOnUiThread { result.error("PRINT_FAILED", e.message ?: "Could not print", null) }
                    }
                }
            }
            when (call.method) {
                "bluetoothState" -> reply { bluetoothState() }
                "pairedDevices" -> reply { pairedDevices() }
                "printBluetooth" -> reply {
                    printBluetooth(call.argument<String>("address") ?: "", call.argument<ByteArray>("bytes") ?: ByteArray(0))
                    null
                }
                "usbDevices" -> reply { usbDevices() }
                "printUsb" -> reply {
                    printUsb(call.argument<String>("device") ?: "", call.argument<ByteArray>("bytes") ?: ByteArray(0))
                    null
                }
                "openBluetoothSettings" -> {
                    activity.startActivity(Intent(Settings.ACTION_BLUETOOTH_SETTINGS))
                    result.success(null)
                }
                else -> result.notImplemented()
            }
        }
    }

    private class PrinterException(val code: String, message: String) : Exception(message)

    // ---------------------------------------------------------------- Bluetooth

    private fun adapter(): BluetoothAdapter? =
        (activity.getSystemService(Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private fun hasConnectPermission(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.S ||
            ContextCompat.checkSelfPermission(activity, Manifest.permission.BLUETOOTH_CONNECT) == PackageManager.PERMISSION_GRANTED

    /** Asks for "Nearby devices" (Android 12+) and reports PERMISSION so Dart can try again after. */
    private fun requireConnectPermission() {
        if (hasConnectPermission()) return
        activity.runOnUiThread {
            ActivityCompat.requestPermissions(activity, arrayOf(Manifest.permission.BLUETOOTH_CONNECT), 4711)
        }
        throw PrinterException("PERMISSION", "Allow Nearby devices for Khatario, then try again.")
    }

    private fun bluetoothState(): String {
        val a = adapter() ?: return "unsupported"
        if (!hasConnectPermission()) return "permission"
        return if (a.isEnabled) "on" else "off"
    }

    @SuppressLint("MissingPermission")
    private fun pairedDevices(): List<Map<String, Any?>> {
        val a = adapter() ?: throw PrinterException("UNSUPPORTED", "This phone has no Bluetooth.")
        requireConnectPermission()
        if (!a.isEnabled) throw PrinterException("BLUETOOTH_OFF", "Turn on Bluetooth, then try again.")
        return a.bondedDevices.map { d ->
            val major = d.bluetoothClass?.majorDeviceClass
            mapOf(
                "address" to d.address,
                "name" to (d.name ?: d.address),
                // Imaging = printers; uncategorized is common on cheap thermals. Audio / phones are not printers.
                "likelyPrinter" to (major == BluetoothClass.Device.Major.IMAGING || major == BluetoothClass.Device.Major.UNCATEGORIZED),
            )
        }
    }

    @SuppressLint("MissingPermission")
    private fun printBluetooth(address: String, bytes: ByteArray) {
        if (bytes.isEmpty()) throw PrinterException("EMPTY", "Nothing to print.")
        val a = adapter() ?: throw PrinterException("UNSUPPORTED", "This phone has no Bluetooth.")
        requireConnectPermission()
        if (!a.isEnabled) throw PrinterException("BLUETOOTH_OFF", "Turn on Bluetooth, then try again.")
        val device = try {
            a.getRemoteDevice(address)
        } catch (e: IllegalArgumentException) {
            throw PrinterException("NOT_FOUND", "This printer is no longer paired. Pair it again in Bluetooth settings.")
        }
        a.cancelDiscovery()
        val socket = try {
            device.createRfcommSocketToServiceRecord(SPP_UUID).also { it.connect() }
        } catch (e: Exception) {
            // Some clones only answer the insecure channel.
            try {
                device.createInsecureRfcommSocketToServiceRecord(SPP_UUID).also { it.connect() }
            } catch (e2: Exception) {
                throw PrinterException("UNREACHABLE", "Could not reach the printer. Turn it on, keep it near the phone and try again.")
            }
        }
        socket.use { s ->
            val out = s.outputStream
            var i = 0
            while (i < bytes.size) {
                val n = minOf(CHUNK, bytes.size - i)
                out.write(bytes, i, n)
                out.flush()
                i += n
                // Cheap printers have small buffers; give them time to keep up.
                Thread.sleep(15)
            }
            // Let the last bytes leave the radio before the socket closes.
            Thread.sleep(400L + bytes.size / 40)
        }
    }

    // ---------------------------------------------------------------- USB (OTG)

    private fun usbManager(): UsbManager = activity.getSystemService(Context.USB_SERVICE) as UsbManager

    /** Bulk-out endpoint on a printer-class interface, or any vendor interface that has one. */
    private fun printerEndpoint(device: UsbDevice): Pair<Int, Int>? {
        var fallback: Pair<Int, Int>? = null
        for (i in 0 until device.interfaceCount) {
            val itf = device.getInterface(i)
            for (e in 0 until itf.endpointCount) {
                val ep = itf.getEndpoint(e)
                if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK && ep.direction == UsbConstants.USB_DIR_OUT) {
                    if (itf.interfaceClass == UsbConstants.USB_CLASS_PRINTER) return i to e
                    if (fallback == null && itf.interfaceClass == UsbConstants.USB_CLASS_VENDOR_SPEC) fallback = i to e
                }
            }
        }
        return fallback
    }

    private fun usbDevices(): List<Map<String, Any?>> =
        usbManager().deviceList.values.filter { printerEndpoint(it) != null }.map { d ->
            mapOf(
                "device" to d.deviceName,
                "name" to listOfNotNull(d.manufacturerName, d.productName).joinToString(" ").ifBlank { "USB printer" },
                "vendorId" to d.vendorId,
                "productId" to d.productId,
            )
        }

    private fun requestUsbPermission(device: UsbDevice): Boolean {
        val usb = usbManager()
        if (usb.hasPermission(device)) return true
        val lock = Object()
        var granted = false
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                synchronized(lock) { lock.notifyAll() }
            }
        }
        ContextCompat.registerReceiver(activity, receiver, IntentFilter(USB_PERMISSION), ContextCompat.RECEIVER_NOT_EXPORTED)
        try {
            val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) PendingIntent.FLAG_MUTABLE else 0
            val intent = Intent(USB_PERMISSION).setPackage(activity.packageName)
            usb.requestPermission(device, PendingIntent.getBroadcast(activity, 0, intent, flags))
            synchronized(lock) { lock.wait(30_000) }
        } finally {
            activity.unregisterReceiver(receiver)
        }
        return granted
    }

    private fun printUsb(deviceName: String, bytes: ByteArray) {
        if (bytes.isEmpty()) throw PrinterException("EMPTY", "Nothing to print.")
        val usb = usbManager()
        val device = usb.deviceList[deviceName]
            ?: usb.deviceList.values.firstOrNull { printerEndpoint(it) != null && "${it.vendorId}:${it.productId}" == deviceName }
            ?: throw PrinterException("NOT_FOUND", "Plug in the USB printer with an OTG cable, then try again.")
        val (itfIndex, epIndex) = printerEndpoint(device)
            ?: throw PrinterException("NOT_PRINTER", "This USB device is not a printer.")
        if (!requestUsbPermission(device)) throw PrinterException("PERMISSION", "Allow Khatario to use the USB printer, then try again.")
        val connection = usb.openDevice(device) ?: throw PrinterException("UNREACHABLE", "Could not open the USB printer.")
        try {
            val itf = device.getInterface(itfIndex)
            val ep = itf.getEndpoint(epIndex)
            if (!connection.claimInterface(itf, true)) throw PrinterException("BUSY", "The USB printer is in use by another app.")
            var i = 0
            while (i < bytes.size) {
                val n = minOf(16 * 1024, bytes.size - i)
                val sent = connection.bulkTransfer(ep, bytes.copyOfRange(i, i + n), n, 10_000)
                if (sent <= 0) throw PrinterException("WRITE_FAILED", "Printing stopped part-way. Check paper and cable.")
                i += sent
            }
            connection.releaseInterface(itf)
        } finally {
            connection.close()
        }
    }
}
