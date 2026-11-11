import { storeInfoView } from "@/lib/store/engine/store-info-map";
import type { EngineSectionProps } from "../registry";
import { StoreInfoHours } from "./StoreInfoHours";
import { str, withDefaults } from "./shared";

/** A card with today's hours and live status, the address, and Call / WhatsApp / Directions buttons. Parts with no data are left out. */
export function StoreInfo({ section, data, store, theme }: EngineSectionProps) {
  const v = withDefaults(section);
  const view = storeInfoView({
    storeName: store.name,
    heading: str(v.heading),
    phone: store.phone,
    address: data?.storeAddress,
    hours: store.store_hours,
    whatsapp: theme.settings.social.whatsapp,
    showHours: v.show_hours !== false,
    showAddress: v.show_address !== false,
    showButtons: v.show_buttons !== false,
  });
  if (!view) return null;
  const hasButtons = view.callHref || view.whatsappHref || view.directionsHref;
  return (
    <div className="eng-info-sec">
      <div className="eng-info">
        <h2 className="eng-info-heading">{view.heading}</h2>
        {view.hours ? <StoreInfoHours hours={view.hours} /> : null}
        {view.address ? (
          <p className="eng-info-address">{view.address}</p>
        ) : null}
        {hasButtons ? (
          <div className="eng-info-actions">
            {view.callHref ? (
              <a className="st-btn eng-info-btn" href={view.callHref}>
                Call
              </a>
            ) : null}
            {view.whatsappHref ? (
              <a
                className="eng-info-btn eng-info-btn--line"
                href={view.whatsappHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                WhatsApp
              </a>
            ) : null}
            {view.directionsHref ? (
              <a
                className="eng-info-btn eng-info-btn--line"
                href={view.directionsHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                Directions
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
