export {
  CapacitorSppDriver,
  CapacitorBluetoothNotAvailableError,
  CapacitorBluetoothNotConnectedError,
} from './capacitor-spp-driver';

import { CapacitorSppDriver } from './capacitor-spp-driver';

export function createCapacitorSppDriver(): CapacitorSppDriver {
  return new CapacitorSppDriver();
}
