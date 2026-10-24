import { mapBluetoothUserMessage } from '@/lib/bluetooth/user-errors';
import { rankBondedBluetoothDevices } from '@/lib/bluetooth/bonded-device-rank';

describe('mapBluetoothUserMessage', () => {
  it('rewrites socket failures for cashiers', () => {
    expect(mapBluetoothUserMessage('Connection failed: read failed, socket might closed')).toMatch(
      /Could not reach the printer/
    );
  });

  it('rewrites Bluetooth off', () => {
    expect(mapBluetoothUserMessage('Bluetooth is turned off')).toMatch(/Turn on Bluetooth/);
  });
});

describe('rankBondedBluetoothDevices', () => {
  it('lists likely printers before phones and watches', () => {
    const ranked = rankBondedBluetoothDevices([
      { address: '1', name: 'Abhishek\'s Buds' },
      { address: '2', name: 'RPP02N' },
      { address: '3', name: 'Galaxy Watch' },
    ]);
    expect(ranked[0].name).toBe('RPP02N');
  });
});
