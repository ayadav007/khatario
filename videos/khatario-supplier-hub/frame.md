# Khatario Supplier Hub — design spec

Brand truth for this video. Matches the Khatario phone app's "fresh direction"
(docs/design/PHONE_APP_HANDOFF.md) and the approved style samples.

## Palette

| Role        | Hex       | Use                                              |
| ----------- | --------- | ------------------------------------------------ |
| Background  | `#F7F4EE` | every scene (cream, one canvas for the film)     |
| Ink         | `#063F35` | headlines, shop outlines, the retailer           |
| Accent      | `#F58220` | the one thing to look at: wholesaler, alerts, CTA |
| Soft green  | `#EEF2F1` | cards' inner fills, bars' tracks                 |
| Hairline    | `#E4DDD0` | paper, rules, card edges                         |
| Body ink    | `#3D5C56` | supporting text                                  |
| Card        | `#FFFFFF` | phone screens, bills, cards (sparingly)          |
| Box brown   | `#C99A5B` / `#D9AE70` | cartons only                          |
| Miss red    | `#C62828` | only for "wrong" marks in the old-way scene      |

## Type

- Headlines: **Montserrat 900**, 84–110px (16:9), 96–130px (9:16), tight
  tracking (-0.02em), sentence case, Hinglish in Roman script.
- Body / labels: **Inter 700/400**, 30–40px body, 24px labels minimum.

## Shapes

Flat geometric illustration: rounded rects (radius 14–24px), 4px ink strokes,
no gradients, no faces, no shadows except one soft card lift (`0 18px 40px
rgba(6,63,53,.12)`). Shops are a triangle roof + box + door. Products are small
ink blocks on shelves. Cartons are brown squares.

## Layout

- 16:9: text zone left (x 140–760), illustration zone right (x 820–1780).
  A small pill "Khatario Supplier Hub" top-left at (140, 96).
- 9:16: text zone top (y 220–700), illustration zone below (y 760–1700).
- Background texture: a faint dot grid (ink at 10%), plus one large soft
  green disc behind the illustration.

## Do / Don't

- Do keep one accent moment per scene.
- Don't put more than two lines of on-screen text per scene.
- Don't use real customer names or photos.
