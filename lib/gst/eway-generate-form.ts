// Checks the "Generate e-way bill" form before it is sent. Pure, so it is unit tested.
import type { GenerateEwayInput } from "@/lib/gst/eway-generate";

export type EwayForm = {
  distance: string;
  mode: "road" | "rail" | "air" | "ship";
  vehicle: string;
  transporterGstin: string;
  transporterName: string;
  docNumber: string;
  docDate: string;
  isOdc: boolean;
  shipToGstin: string;
  shipToPlace: string;
  shipToPincode: string;
  shipToStateCode: string;
};

export type EwayFormErrors = Partial<Record<keyof EwayForm, string>>;
export type EwayFormResult =
  | { ok: true; body: Omit<GenerateEwayInput, "source_type" | "source_id"> }
  | { ok: false; errors: EwayFormErrors };

const VEHICLE = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$|^TM[A-Z0-9]{6}$/;
const DISTANCE_MSG =
  "Enter the distance in km, 0 to 4000. Enter 0 to use the portal's distance.";
const GSTIN_MSG = "Enter a 15-character GSTIN";
const SHIP_TO_MSG = "Enter the ship-to city, PIN code and state together";
const DOC_MSG = "Enter the transport document number and date";

const isGstin = (g: string) => g === "URP" || g.length === 15;

export function validateEwayForm(f: EwayForm): EwayFormResult {
  const errors: EwayFormErrors = {};

  const distanceText = f.distance.trim();
  const distance = /^\d+$/.test(distanceText) ? Number(distanceText) : NaN;
  if (!Number.isInteger(distance) || distance < 0 || distance > 4000)
    errors.distance = DISTANCE_MSG;

  const vehicle = f.vehicle.toUpperCase().replace(/\s+/g, "");
  const transporterGstin = f.transporterGstin.trim().toUpperCase();
  const shipToGstin = f.shipToGstin.trim().toUpperCase();
  if (vehicle && !VEHICLE.test(vehicle))
    errors.vehicle = "Enter a valid vehicle number, like KA01AB1234";
  if (transporterGstin && !isGstin(transporterGstin))
    errors.transporterGstin = GSTIN_MSG;
  if (shipToGstin && !isGstin(shipToGstin)) errors.shipToGstin = GSTIN_MSG;

  const docNumber = f.docNumber.trim();
  const docDate = f.docDate.trim();
  if (f.mode === "road") {
    if (!vehicle && !transporterGstin) {
      errors.vehicle =
        "Enter the vehicle number, or the transporter's GSTIN to generate Part A only";
    }
  } else {
    if (!docNumber) errors.docNumber = DOC_MSG;
    if (!docDate) errors.docDate = DOC_MSG;
  }

  const place = f.shipToPlace.trim();
  const pincode = f.shipToPincode.trim();
  const stateCode = f.shipToStateCode.trim();
  if (place || pincode || stateCode) {
    if (!place) errors.shipToPlace = SHIP_TO_MSG;
    else if (!pincode) errors.shipToPincode = SHIP_TO_MSG;
    else if (!stateCode) errors.shipToStateCode = SHIP_TO_MSG;
    if (pincode && !/^\d{6}$/.test(pincode))
      errors.shipToPincode = "Enter a 6-digit PIN code";
  }

  if (Object.keys(errors).length) return { ok: false, errors };

  const body: Omit<GenerateEwayInput, "source_type" | "source_id"> = {
    distance_km: distance,
    transport_mode: f.mode,
    is_odc: f.isOdc,
  };
  if (vehicle) body.vehicle_number = vehicle;
  if (transporterGstin) body.transporter_gstin = transporterGstin;
  if (f.transporterName.trim())
    body.transporter_name = f.transporterName.trim();
  if (docNumber) body.transport_doc_number = docNumber;
  if (docDate) body.transport_doc_date = docDate;
  if (shipToGstin) body.ship_to_gstin = shipToGstin;
  if (place) {
    body.ship_to_place = place;
    body.ship_to_pincode = pincode;
    body.ship_to_state_code = stateCode;
  }
  return { ok: true, body };
}
