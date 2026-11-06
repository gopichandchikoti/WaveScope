import type { NetworkSnapshot } from './domain';
export function Privacy({ network }: { network?: NetworkSnapshot }) {
  return (
    <div className="settings-grid">
      <section className="panel prose">
        <h2>Read locally, kept locally</h2>
        <p>
          Connection status, IP/DNS configuration, and permitted Wi-Fi metrics come from your operating system. No
          router password, packet capture, other-app traffic, or administrator access is requested.
        </p>
        <h3>Permissions</h3>
        <p>
          Android uses network/Wi-Fi state access. Precise location is requested only after you choose to read nearby
          Wi-Fi. Permission denial, disabled Location, Wi-Fi off, or OS scan throttling can hide SSID/BSSID and scan
          results. Missing values stay unavailable.
        </p>
        <h3>Storage & deletion</h3>
        <p>
          Test destination, timestamp, sample results, response status and source are stored in IndexedDB on web or
          app-private SQLite on Android. Connection snapshots and nearby AP lists are held in memory. Clear history in
          Settings. Clearing app/site data removes all preferences and history.
        </p>
      </section>
      <section className="panel prose">
        <h2>Where data goes</h2>
        <p>
          Only a test you start sends network traffic. ICMP goes to your chosen host. DNS asks your configured resolver
          for the chosen hostname. HTTPS sends one HEAD request to the displayed URL, without following redirects.
        </p>
        <p>
          Speed tests send bounded HTTPS downloads/uploads and latency requests directly to speed.cloudflare.com, four
          ICMP probes to 1.1.1.1, and a DNS lookup for the speed-test host through your configured resolver. Cloudflare
          sees your public IP. No cookies or credentials are sent to the speed endpoint. Quick uses up to 17 MB and
          Extended up to 39 MB of payload, plus protocol overhead. Measurements stay in local history and can be
          exported or deleted with other diagnostics.
        </p>
        <p>
          No accounts, analytics, crash uploads or advertising. Fonts ship locally. The web companion binds only to
          127.0.0.1 and rejects cross-origin diagnostic requests.
        </p>
        <h3>Current adapter</h3>
        <p>{network?.source ?? 'Unavailable'}</p>
        <p>{network?.explanation ?? 'Refresh connection status to read adapter capabilities.'}</p>
        <h3>Useful limits</h3>
        <p>
          Signal is not throughput. A failed ping may mean ICMP is blocked. VPN detection on Windows is based on adapter
          names and can miss VPNs. Captive portal and validated-internet status come from Android capabilities and are
          unavailable on the Windows companion.
        </p>
      </section>
    </div>
  );
}
