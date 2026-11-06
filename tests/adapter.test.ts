import { describe, expect, it } from 'vitest';
// @ts-expect-error OS adapter is intentionally plain Node ESM.
import { parseGateway, parseInterface, parseNetworks, validateHost } from '../server/diagnostics.mjs';
describe('Windows adapter boundary', () => {
  it('selects the lowest-metric reported IPv4 default gateway and handles missing routes', () => {
    expect(parseGateway('0.0.0.0 0.0.0.0 192.0.2.1 192.0.2.10 100\n' + '0.0.0.0 0.0.0.0 192.0.2.2 192.0.2.11 20')).toBe(
      '192.0.2.2',
    );
    expect(parseGateway('No active routes')).toBeNull();
  });
  it('parses observed netsh fields without estimating RSSI', () => {
    const result = parseInterface(
      ' State : connected\n SSID : Test fixture\n BSSID : aa:bb:cc:dd:ee:ff\n Signal : 90%\n Channel : 36\n Receive rate (Mbps) : 866.7\n Band : 5 GHz',
    );
    expect(result.ssid).toBe('Test fixture');
    expect(result.signal).toBe(90);
    expect(result.linkSpeed).toBe(866.7);
    expect(parseInterface('').ssid).toBeNull();
  });
  it('handles a cached AP listing and permission-denied/empty output', () => {
    const list = parseNetworks(
      'SSID 1 : Fixture\n Authentication : WPA2-Personal\n BSSID 1 : aa:bb:cc:dd:ee:ff\n Signal : 80%\n Channel : 6',
    );
    expect(list).toHaveLength(1);
    expect(list[0].channel).toBe(6);
    expect(list[0].rssi).toBeNull();
    expect(parseNetworks('Access denied')).toEqual([]);
  });
  it('keeps metrics together on the connected interface when several adapters exist', () => {
    const parsed = parseInterface(
      'Name : Disconnected adapter\nState : disconnected\n' +
        'Name : Connected adapter\nState : connected\nSSID : Fixture active\nSignal : 85%\nChannel : 6',
    );
    expect(parsed.connected).toBe(true);
    expect(parsed.ssid).toBe('Fixture active');
    expect(parsed.signal).toBe(85);
  });
  it('never inherits one access point’s security from another with missing metadata', () => {
    const results = parseNetworks(
      'SSID 1 : First\nAuthentication : WPA2\nBSSID 1 : aa:bb:cc:dd:ee:ff\n' +
        'SSID 2 : Second\nBSSID 1 : 11:22:33:44:55:66',
    );
    expect(results[0].security).toBe('WPA2');
    expect(results[1].security).toBe('Unavailable');
  });
  it('rejects command options and accepts explicit legitimate targets', () => {
    expect(() => validateHost('-n 100', 'icmp')).toThrow();
    expect(() => validateHost('x;calc.exe', 'icmp')).toThrow();
    expect(() => validateHost('http://example.com', 'http')).toThrow();
    expect(() => validateHost('1.1.1.1', 'icmp')).not.toThrow();
  });
});
