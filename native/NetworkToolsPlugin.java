package com.portfolio.wavescope;

import android.Manifest;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiInfo;
import android.net.wifi.WifiManager;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.URI;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.time.Instant;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@CapacitorPlugin(name = "NetworkTools", permissions = {
    @Permission(alias = "location", strings = {Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION})
})
public class NetworkToolsPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @PluginMethod public void snapshot(PluginCall call) { worker.execute(() -> readSnapshot(call, false)); }

    @PluginMethod public void scan(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            requestPermissionForAlias("location", call, "scanPermission"); return;
        }
        worker.execute(() -> readSnapshot(call, true));
    }

    @PermissionCallback private void scanPermission(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) {
            call.reject("Location permission was denied. Connection status and diagnostics remain available."); return;
        }
        worker.execute(() -> readSnapshot(call, true));
    }

    @SuppressWarnings("deprecation")
    private void readSnapshot(PluginCall call, boolean scan) {
        try {
            ConnectivityManager manager = (ConnectivityManager) getContext().getSystemService(Context.CONNECTIVITY_SERVICE);
            WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
            Network active = manager.getActiveNetwork();
            NetworkCapabilities caps = manager.getNetworkCapabilities(active);
            LinkProperties links = manager.getLinkProperties(active);
            boolean connected = caps != null;
            boolean vpn = connected && caps.hasTransport(NetworkCapabilities.TRANSPORT_VPN);
            boolean onWifi = connected && caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI);
            String type = !connected ? "Offline" : vpn ? "VPN" : onWifi ? "Wi-Fi"
                : caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) ? "Cellular" : "Ethernet / other";
            JSObject result = emptySnapshot(type, vpn, caps);
            JSArray ip = new JSArray(); JSArray dns = new JSArray();
            if (links != null) {
                links.getLinkAddresses().forEach(address -> ip.put(address.getAddress().getHostAddress()));
                links.getDnsServers().forEach(address -> dns.put(address.getHostAddress()));
            }
            result.put("ip", ip); result.put("dns", dns);
            result.put("gateway", JSObject.NULL);
            if (links != null) {
                for (android.net.RouteInfo route : links.getRoutes()) {
                    if (route.isDefaultRoute() && route.getGateway() instanceof java.net.Inet4Address
                        && !route.getGateway().isAnyLocalAddress()) {
                        result.put("gateway", route.getGateway().getHostAddress()); break;
                    }
                }
            }
            if (onWifi) {
                WifiInfo info = wifi.getConnectionInfo();
                String ssid = info.getSSID(); String bssid = info.getBSSID();
                if (ssid != null && !ssid.equals("<unknown ssid>")) result.put("ssid", ssid.replace("\"", ""));
                if (bssid != null && !bssid.equals("02:00:00:00:00:00")) result.put("bssid", bssid);
                if (info.getRssi() > -127 && info.getRssi() < 0) result.put("rssi", info.getRssi());
                if (info.getLinkSpeed() > 0) result.put("linkSpeed", info.getLinkSpeed());
                if (info.getFrequency() > 0) result.put("frequency", info.getFrequency());
            }
            JSArray networks = new JSArray();
            if (scan && wifi.isWifiEnabled()) {
                boolean requested = wifi.startScan();
                result.put("explanation", "Showing OS-cached scan results with observation timestamps. New scan "
                    + (requested ? "requested; Android may deliver refreshed data later. " : "was throttled or unavailable. ")
                    + "Location services and precise-location permission are required. No background scanning.");
                for (ScanResult point : wifi.getScanResults()) networks.put(accessPoint(point));
            }
            result.put("networks", networks); call.resolve(result);
        } catch (SecurityException error) {
            call.reject("Android denied Wi-Fi data. Enable Location services and allow precise location to read nearby Wi-Fi.");
        } catch (Exception error) { call.reject("The Android network adapter is unavailable. Try refreshing."); }
    }

    private JSObject emptySnapshot(String type, boolean vpn, NetworkCapabilities caps) {
        JSObject result = new JSObject();
        result.put("timestamp", Instant.now().toString()); result.put("source", "Android ConnectivityManager / WifiManager");
        result.put("connection", type); result.put("vpn", vpn);
        for (String name : new String[]{"ssid","bssid","rssi","signal","linkSpeed","frequency","channel"}) result.put(name, JSObject.NULL);
        result.put("captive", caps == null ? JSObject.NULL : caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_CAPTIVE_PORTAL));
        result.put("validated", caps == null ? JSObject.NULL : caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED));
        result.put("explanation", "OS-provided connection data. Redacted Wi-Fi identity remains unavailable until permission and Location settings allow it. Scans are cached and may be throttled. No packet capture.");
        return result;
    }

    @SuppressWarnings("deprecation")
    private JSObject accessPoint(ScanResult point) {
        JSObject item = new JSObject();
        item.put("ssid", point.SSID.isEmpty() ? "(hidden network)" : point.SSID); item.put("bssid", point.BSSID);
        item.put("rssi", point.level); item.put("signal", JSObject.NULL); item.put("frequency", point.frequency);
        int frequency = point.frequency;
        int channel = frequency == 2484 ? 14 : frequency < 2500 ? (frequency - 2407) / 5
            : frequency >= 5955 ? (frequency - 5950) / 5 : (frequency - 5000) / 5;
        item.put("channel", channel); item.put("security", point.capabilities);
        long ageMillis = Math.max(0, android.os.SystemClock.elapsedRealtime() - point.timestamp / 1000);
        item.put("timestamp", Instant.ofEpochMilli(System.currentTimeMillis() - ageMillis).toString());
        return item;
    }

    @PluginMethod public void diagnose(PluginCall call) { worker.execute(() -> runDiagnostic(call)); }

    private void runDiagnostic(PluginCall call) {
        String host = call.getString("host", ""); String kind = call.getString("kind", "");
        int count = call.getInt("count", 4); int interval = call.getInt("interval", 1);
        try {
            if (!(count == 4 || count == 8 || count == 12) || !(interval == 1 || interval == 2 || interval == 5)) {
                throw new IllegalArgumentException("Invalid sampling options.");
            }
            validate(host, kind);
            JSObject result = new JSObject(); JSArray samples = new JSArray(); JSArray addresses = new JSArray();
            result.put("id", UUID.randomUUID().toString()); result.put("kind", kind); result.put("host", host);
            result.put("started", Instant.now().toString()); result.put("source", "Android OS");
            result.put("intervalMs", interval * 1000); result.put("httpStatus", JSObject.NULL);
            if (kind.equals("icmp")) {
                for (int i = 0; i < count; i++) {
                    long started = System.nanoTime(); samples.put(ping(host));
                    if (i < count - 1) Thread.sleep(Math.max(0, interval * 1000 - (System.nanoTime() - started) / 1000000));
                }
                result.put("detail", "Actual system ICMP echo replies. Null means timeout or blocked echo. Requested cadence can be extended by timeouts.");
            } else runRequest(host, kind, result, samples, addresses);
            result.put("samples", samples); result.put("addresses", addresses); call.resolve(result);
        } catch (Exception error) { call.reject("The diagnostic could not run. Check destination and sampling options."); }
    }

    private Object ping(String host) {
        try {
            Process process = new ProcessBuilder("/system/bin/ping", "-n", "-c", "1", "-W", "2", host).redirectErrorStream(true).start();
            if (!process.waitFor(3, TimeUnit.SECONDS)) { process.destroyForcibly(); return JSObject.NULL; }
            StringBuilder output = new StringBuilder();
            try (BufferedReader reader = new BufferedReader(new InputStreamReader(process.getInputStream()))) {
                String line; while ((line = reader.readLine()) != null) output.append(line).append('\n');
            }
            Matcher match = Pattern.compile("time[=<]([0-9.]+)\\s*ms").matcher(output.toString());
            return match.find() ? Double.parseDouble(match.group(1)) : JSObject.NULL;
        } catch (Exception error) { return JSObject.NULL; }
    }

    private void runRequest(String host, String kind, JSObject result, JSArray samples, JSArray addresses) {
        long started = System.nanoTime();
        try {
            if (kind.equals("dns")) {
                InetAddress[] resolved = CompletableFuture.supplyAsync(() -> {
                    try { return InetAddress.getAllByName(host); }
                    catch (Exception error) { throw new IllegalStateException("DNS failed"); }
                }).get(8, TimeUnit.SECONDS);
                for (InetAddress address : resolved) addresses.put(address.getHostAddress());
                result.put("detail", "A/AAAA resolution using Android's configured resolver. This is DNS duration, not ICMP latency.");
            } else {
                HttpURLConnection connection = (HttpURLConnection) URI.create(host).toURL().openConnection();
                try {
                    connection.setRequestMethod("HEAD"); connection.setConnectTimeout(8000); connection.setReadTimeout(8000);
                    connection.setInstanceFollowRedirects(false); result.put("httpStatus", connection.getResponseCode());
                    result.put("detail", "One HTTPS HEAD request, including connection/TLS overhead. Redirects are not followed. Not ICMP ping.");
                } finally { connection.disconnect(); }
            }
            samples.put((System.nanoTime() - started) / 1000000.0);
        } catch (Exception error) { samples.put(JSObject.NULL); result.put("detail", "Request failed or timed out. Check the destination and connection."); }
    }

    private void validate(String host, String kind) {
        if (!kind.equals("icmp") && !kind.equals("dns") && !kind.equals("http")) throw new IllegalArgumentException();
        if (kind.equals("http")) {
            URI uri = URI.create(host);
            if (!"https".equals(uri.getScheme()) || uri.getUserInfo() != null || uri.getPort() != -1 || uri.getFragment() != null) throw new IllegalArgumentException();
            validate(uri.getHost(), "dns"); return;
        }
        if (host == null || host.length() > 253 || !host.matches("[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?")
            || host.contains("..")) throw new IllegalArgumentException();
        for (String label : host.split("\\.")) if (label.length() > 63 || label.startsWith("-") || label.endsWith("-")) throw new IllegalArgumentException();
        if (host.matches("[0-9.]+")) {
            String[] parts = host.split("\\."); if (parts.length != 4) throw new IllegalArgumentException();
            for (String part : parts) if (Integer.parseInt(part) > 255) throw new IllegalArgumentException();
        }
    }

    @Override protected void handleOnDestroy() { worker.shutdownNow(); }
}
