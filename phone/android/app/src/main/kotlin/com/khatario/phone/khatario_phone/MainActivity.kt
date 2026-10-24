package com.khatario.phone.khatario_phone

import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine

class MainActivity : FlutterActivity() {
    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        StaffDeviceChannel(this).register(flutterEngine.dartExecutor.binaryMessenger)
        ThermalPrinterChannel(this).register(flutterEngine.dartExecutor.binaryMessenger)
    }
}
