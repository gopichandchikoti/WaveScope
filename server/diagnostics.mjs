import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { getServers, resolve4, resolve6 } from 'node:dns/promises';
import { networkInterfaces } from 'node:os';
import { randomUUID } from 'node:crypto';
const execute = promisify(execFile);
const windows = process.platform === 'win32';

export function validateHost(host, kind) {
  if (typeof host !== 'string' || host.length > 2000) throw new Error('Invalid destination.');
  if (kind === 'http') {
    const url = new URL(host);
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.hash) throw new Error('Use HTTPS without credentials, ports or fragments.');
    validateHost(url.hostname, 'dns'); return;
  }
  if (host.length > 253 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)
    || host.includes('..') || host.split('.').some(label => label.length > 63 || label.startsWith('-') || label.endsWith('-'))) {
    throw new Error('Use a valid hostname or IPv4 address.');
  }
  if (/^[0-9.]+$/.test(host) && (host.split('.').length !== 4 || host.split('.').some(n => Number(n) > 255))) throw new Error('Invalid IPv4 address.');
}

export function parseInterface(text) {
  const blocks = text.split(/(?=^\s*Name\s*:)/im);
  const active = blocks.find(block => /^\s*State\s*:\s*connected\s*$/im.test(block)) ?? text;
  const field = name => new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, 'im').exec(active)?.[1]?.trim() ?? null;
  const number = name => { const value = field(name); return value ? Number.parseFloat(value) || null : null; };
  return { ssid: field('SSID'), bssid: field('BSSID'), signal: number('Signal'),
    channel: number('Channel'), linkSpeed: number('Receive rate \\(Mbps\\)'), band: field('Band'),
    connected: field('State')?.toLowerCase() === 'connected' };
}

export function parseNetworks(text) {
  const networks = []; let ssid = ''; let security = 'Unavailable'; let current;
  for (const line of text.split(/\r?\n/)) {
    const name = /^\s*SSID\s+\d+\s*:\s*(.*)/i.exec(line);
    if (name) { ssid = name[1].trim() || '(hidden network)'; current = undefined; security = 'Unavailable'; }
    const auth = /^\s*Authentication\s*:\s*(.*)/i.exec(line);
    if (auth) security = auth[1].trim();
    const bssid = /^\s*BSSID\s+\d+\s*:\s*(.*)/i.exec(line);
    if (bssid) { current = { ssid, bssid: bssid[1].trim(), signal: null, rssi: null, channel: null,
      frequency: null, security, timestamp: new Date().toISOString() }; networks.push(current); }
    const signal = /^\s*Signal\s*:\s*(\d+)/i.exec(line);
    const channel = /^\s*Channel\s*:\s*(\d+)/i.exec(line);
    if (current && signal) current.signal = Number(signal[1]);
    if (current && channel) current.channel = Number(channel[1]);
  }
  return networks;
}

export function parseGateway(text) {
  const routes = text.split(/\r?\n/).map(line =>
    /^\s*0\.0\.0\.0\s+0\.0\.0\.0\s+(\d+\.\d+\.\d+\.\d+)\s+\S+\s+(\d+)\s*$/.exec(line))
    .filter(Boolean).sort((left, right) => Number(left[2]) - Number(right[2]));
  return routes[0]?.[1] ?? null;
}

export async function snapshot(scan = false) {
  const interfaces = Object.entries(networkInterfaces()).filter(([, addresses]) => addresses?.some(a => !a.internal));
  const ip = interfaces.flatMap(([, addresses]) => addresses.filter(a => !a.internal && a.family === 'IPv4').map(a => a.address));
  let wifi = parseInterface(''); let networks = []; let explanation = ''; let gateway = null;
  if (windows) {
    try {
      const route = await execute('route.exe', ['print', '0.0.0.0'], { timeout: 5000, windowsHide: true });
      gateway = parseGateway(route.stdout);
    } catch { gateway = null; }
    try { const result = await execute('netsh.exe', ['wlan','show','interfaces'], { timeout: 7000, windowsHide: true });
      wifi = parseInterface(result.stdout); } catch { explanation = 'Windows did not expose Wi-Fi details. '; }
    if (scan) {
      try { const result = await execute('netsh.exe', ['wlan','show','networks','mode=bssid'], { timeout: 10000, windowsHide: true });
        networks = parseNetworks(result.stdout); } catch { explanation += 'Windows denied the nearby-network request. '; }
    }
  } else explanation = 'Wi-Fi metrics are supported by the Windows companion or Android app. ';
  if (!wifi.ssid) explanation += 'SSID, BSSID, signal and channel may require Windows Location services and Wi-Fi hardware. ';
  explanation += 'RSSI is not inferred from Windows signal percentage. Captive-portal and validated-internet status are unavailable on this companion. Nearby scans are OS-cached; no unrestricted scanning is promised.';
  const vpn = interfaces.some(([name]) => /vpn|wireguard|tailscale|tun\d|tap/i.test(name));
  return { timestamp: new Date().toISOString(), source: windows ? 'Windows companion · OS data' : 'Local companion · OS data',
    connection: !ip.length ? 'Offline' : vpn ? 'VPN' : wifi.connected ? 'Wi-Fi' : 'Ethernet / other',
    ssid: wifi.ssid, bssid: wifi.bssid, signal: wifi.signal, rssi: null, linkSpeed: wifi.linkSpeed,
    channel: wifi.channel, frequency: wifi.band?.startsWith('2.4') ? 2400 : wifi.band?.startsWith('5') ? 5000 : wifi.band?.startsWith('6') ? 6000 : null,
    ip, dns: getServers(), gateway, vpn, captive: null, validated: null, explanation, networks };
}

export async function diagnose({ kind, host, count, interval }) {
  if (!['icmp','dns','http'].includes(kind) || ![4,8,12].includes(count) || ![1,2,5].includes(interval)) throw new Error('Invalid test options.');
  validateHost(host, kind);
  const result = { id: randomUUID(), kind, host, started: new Date().toISOString(), samples: [], intervalMs: interval * 1000,
    addresses: [], httpStatus: null, detail: '', source: windows ? 'Windows companion' : 'Local companion' };
  if (kind === 'icmp') {
    for (let i = 0; i < count; i++) {
      const started = performance.now();
      try {
        const command = windows ? ['-n','1','-w','1500',host] : ['-c','1','-W','2',host];
        const { stdout } = await execute(windows ? 'ping.exe' : 'ping', command, { timeout: 3500, windowsHide: true });
        const time = /(?:time|temps|zeit)[=<]\s*([\d.,]+)\s*ms/i.exec(stdout);
        result.samples.push(time ? Number(time[1].replace(',','.')) : null);
      } catch { result.samples.push(null); }
      if (i < count - 1) await new Promise(resolve => setTimeout(resolve, Math.max(0, interval * 1000 - (performance.now() - started))));
    }
    result.detail = 'Actual ICMP echo probes. Null samples mean no parsable reply before timeout; firewalls can block ICMP. Sub-millisecond Windows replies are recorded at its 1 ms reporting resolution.';
    return result;
  }
  const started = performance.now();
  try {
    if (kind === 'dns') {
      const lookup = Promise.allSettled([resolve4(host), resolve6(host)]);
      let timer;
      const answers = await Promise.race([lookup, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('DNS timeout')), 7000); })]).finally(() => clearTimeout(timer));
      result.addresses = answers.flatMap(answer => answer.status === 'fulfilled' ? answer.value : []);
      if (!result.addresses.length) throw new Error('No address records returned');
      result.detail = 'A/AAAA resolution using the OS-configured resolver. This is DNS lookup duration, not ICMP latency.';
    } else {
      const response = await fetch(host, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(8000) });
      result.httpStatus = response.status;
      result.detail = `HTTPS HEAD returned ${response.status}. Redirects are not followed. Includes connection/TLS overhead; this is not ICMP ping.`;
      await response.body?.cancel();
    }
    result.samples = [performance.now() - started];
  } catch { result.samples = [null]; result.detail = `${kind === 'dns' ? 'DNS resolution' : 'HTTPS reachability'} failed or timed out. Check the destination and connection.`; }
  return result;
}
