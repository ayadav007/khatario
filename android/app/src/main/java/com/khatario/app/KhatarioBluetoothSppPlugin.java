package com.khatario.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Settings;
import android.util.Base64;

import androidx.core.app.ActivityCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import java.io.IOException;
import java.io.OutputStream;
import java.lang.reflect.Method;
import java.util.Set;
import java.util.UUID;

/**
 * Classic Bluetooth (SPP / RFCOMM) for ESC/POS thermal printers.
 * Lists bonded devices, connects via standard SPP UUID, streams raw bytes.
 */
@CapacitorPlugin(
    name = "KhatarioBluetoothSpp",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.BLUETOOTH_SCAN
            }
        )
    }
)
public class KhatarioBluetoothSppPlugin extends Plugin {

    private static final UUID SPP_UUID =
        UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");
    private static final int CONNECT_TIMEOUT_MS = 12_000;

    private BluetoothSocket socket;
    private OutputStream outputStream;
    private final Object ioLock = new Object();

    @PluginMethod
    public void checkPermissions(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasBluetoothPermissions());
        call.resolve(ret);
    }

    @PluginMethod
    public void requestPermissions(PluginCall call) {
        if (hasBluetoothPermissions()) {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
            return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            requestPermissionForAlias("bluetooth", call, "permissionsCallback");
        } else {
            JSObject ret = new JSObject();
            ret.put("granted", true);
            call.resolve(ret);
        }
    }

    @PermissionCallback
    private void permissionsCallback(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("granted", hasBluetoothPermissions());
        call.resolve(ret);
    }

    @PluginMethod
    public void openBluetoothSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_BLUETOOTH_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void listBondedDevices(PluginCall call) {
        if (!hasBluetoothPermissions()) {
            call.reject("Bluetooth permissions not granted");
            return;
        }
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter == null) {
            call.reject("Bluetooth is not available on this device");
            return;
        }
        if (!adapter.isEnabled()) {
            call.reject("Bluetooth is turned off");
            return;
        }

        JSArray devices = new JSArray();
        Set<BluetoothDevice> bonded = adapter.getBondedDevices();
        if (bonded != null) {
            for (BluetoothDevice device : bonded) {
                JSObject d = new JSObject();
                d.put("address", device.getAddress());
                String name = device.getName();
                d.put("name", name != null && !name.isEmpty() ? name : "Bluetooth device");
                devices.put(d);
            }
        }
        JSObject ret = new JSObject();
        ret.put("devices", devices);
        call.resolve(ret);
    }

    @PluginMethod
    public void isEnabled(PluginCall call) {
        JSObject ret = new JSObject();
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        ret.put("enabled", adapter != null && adapter.isEnabled());
        call.resolve(ret);
    }

    @PluginMethod
    public void isConnected(PluginCall call) {
        JSObject ret = new JSObject();
        synchronized (ioLock) {
            ret.put("connected", socket != null && socket.isConnected() && outputStream != null);
        }
        call.resolve(ret);
    }

    @PluginMethod
    public void connect(PluginCall call) {
        String address = call.getString("address");
        if (address == null || address.isEmpty()) {
            call.reject("address is required");
            return;
        }
        if (!hasBluetoothPermissions()) {
            call.reject("Bluetooth permissions not granted");
            return;
        }

        new Thread(() -> {
            try {
                synchronized (ioLock) {
                    disconnectInternal();
                    BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
                    if (adapter == null) {
                        rejectOnMain(call, "Bluetooth is not available");
                        return;
                    }
                    if (!adapter.isEnabled()) {
                        rejectOnMain(call, "Bluetooth is turned off");
                        return;
                    }

                    BluetoothDevice device = adapter.getRemoteDevice(address);
                    BluetoothSocket sock = openSocket(device);
                    socket = sock;
                    outputStream = sock.getOutputStream();
                }
                resolveOnMain(call);
            } catch (Exception e) {
                rejectOnMain(call, "Connection failed: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void disconnect(PluginCall call) {
        new Thread(() -> {
            synchronized (ioLock) {
                disconnectInternal();
            }
            resolveOnMain(call);
        }).start();
    }

    @PluginMethod
    public void write(PluginCall call) {
        String dataB64 = call.getString("data");
        if (dataB64 == null) {
            call.reject("data is required (base64)");
            return;
        }

        new Thread(() -> {
            try {
                byte[] bytes = Base64.decode(dataB64, Base64.NO_WRAP);
                synchronized (ioLock) {
                    if (outputStream == null) {
                        rejectOnMain(call, "Printer not connected");
                        return;
                    }
                    outputStream.write(bytes);
                    outputStream.flush();
                }
                resolveOnMain(call);
            } catch (Exception e) {
                synchronized (ioLock) {
                    disconnectInternal();
                }
                rejectOnMain(call, "Write failed: " + e.getMessage());
            }
        }).start();
    }

    private BluetoothSocket openSocket(BluetoothDevice device) throws Exception {
        BluetoothAdapter adapter = BluetoothAdapter.getDefaultAdapter();
        if (adapter != null && adapter.isDiscovering()) {
            adapter.cancelDiscovery();
        }

        Exception last = null;
        BluetoothSocket sock = tryCreateSecure(device);
        if (sock != null) {
            try {
                return connectWithTimeout(sock);
            } catch (Exception e) {
                last = e;
                closeQuietly(sock);
            }
        }
        sock = tryCreateInsecure(device);
        if (sock != null) {
            try {
                return connectWithTimeout(sock);
            } catch (Exception e) {
                last = e;
                closeQuietly(sock);
            }
        }
        sock = tryCreateChannel1(device);
        if (sock != null) {
            try {
                return connectWithTimeout(sock);
            } catch (Exception e) {
                last = e;
                closeQuietly(sock);
            }
        }
        if (last != null) throw last;
        throw new IOException("Could not open a printer connection");
    }

    private BluetoothSocket tryCreateSecure(BluetoothDevice device) {
        try {
            return device.createRfcommSocketToServiceRecord(SPP_UUID);
        } catch (Exception e) {
            return null;
        }
    }

    private BluetoothSocket tryCreateInsecure(BluetoothDevice device) {
        try {
            return device.createInsecureRfcommSocketToServiceRecord(SPP_UUID);
        } catch (Exception e) {
            return null;
        }
    }

    private BluetoothSocket tryCreateChannel1(BluetoothDevice device) {
        try {
            Method m = device.getClass().getMethod("createRfcommSocket", int.class);
            return (BluetoothSocket) m.invoke(device, 1);
        } catch (Exception e) {
            return null;
        }
    }

    private BluetoothSocket connectWithTimeout(final BluetoothSocket sock) throws Exception {
        final Exception[] fail = new Exception[1];
        Thread t = new Thread(() -> {
            try {
                sock.connect();
            } catch (Exception e) {
                fail[0] = e;
            }
        }, "khatario-spp-connect");
        t.start();
        t.join(CONNECT_TIMEOUT_MS);
        if (sock.isConnected()) {
            return sock;
        }
        closeQuietly(sock);
        if (fail[0] != null) {
            throw fail[0];
        }
        throw new IOException("Printer did not respond in time");
    }

    private void closeQuietly(BluetoothSocket sock) {
        try {
            sock.close();
        } catch (Exception ignored) {
        }
    }

    private void disconnectInternal() {
        try {
            if (outputStream != null) {
                outputStream.close();
            }
        } catch (Exception ignored) {
        }
        try {
            if (socket != null) {
                socket.close();
            }
        } catch (Exception ignored) {
        }
        outputStream = null;
        socket = null;
    }

    private boolean hasBluetoothPermissions() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
            return true;
        }
        return getPermissionState("bluetooth") == PermissionState.GRANTED;
    }

    private void resolveOnMain(PluginCall call) {
        bridge.executeOnMainThread(call::resolve);
    }

    private void rejectOnMain(PluginCall call, String message) {
        bridge.executeOnMainThread(() -> call.reject(message));
    }
}
