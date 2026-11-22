# Incodet Agent Hub UI verification

Playwright captured these pages at 1280px and 390px. The admin pages use synthetic Bloom data and the normal sign-in flow with a local Auth fixture. The booking tests mock availability and the booking response.

| View | 1280px | 390px |
| --- | --- | --- |
| Dashboard | [PNG](dashboard-1280.png) | [PNG](dashboard-390.png) |
| Conversations | [PNG](conversations-1280.png) | [PNG](conversations-390.png) |
| Conversation detail | [PNG](conversation-detail-1280.png) | [PNG](conversation-detail-390.png) |
| Appointments | [PNG](appointments-1280.png) | [PNG](appointments-390.png) |
| Settings | [PNG](settings-1280.png) | [PNG](settings-390.png) |
| Booking · service | [PNG](booking-1-service-1280.png) | [PNG](booking-1-service-390.png) |
| Booking · day and time | [PNG](booking-2-time-1280.png) | [PNG](booking-2-time-390.png) |
| Booking · details | [PNG](booking-3-details-1280.png) | [PNG](booking-3-details-390.png) |
| Booking · confirmation | [PNG](booking-4-confirmation-1280.png) | [PNG](booking-4-confirmation-390.png) |

To retake the screenshots, run Playwright with `UI_SCREENSHOT_CONVERSATION` set to a synthetic conversation ID for the Bloom workspace and supply the usual test admin credentials. Use a disposable database with Bloom seeded.

## Text contrast

Ratios use the WCAG relative luminance formula in sRGB. Both the canvas and default card use `#000000`. Raised surfaces and status fills use `#111111`. The dark admin theme uses the light surface token only as a reference value.

| Admin text | Foreground | Canvas and cards | Raised surfaces |
| --- | --- | ---: | ---: |
| Primary | `#FFFFFF` | 21.00:1 | 18.88:1 |
| Body | `#B3B3B3` | 10.02:1 | 9.01:1 |
| Muted, including cancelled | `#A6A6A6` | 8.63:1 | 7.76:1 |
| Faint and placeholder | `#929292` | 6.75:1 | 6.07:1 |
| Success | `#8ADDB0` | 13.05:1 | 11.73:1 |
| Warning | `#F5C87C` | 13.44:1 | 12.08:1 |
| Danger | `#FF9BA7` | 10.50:1 | 9.44:1 |
| Info | `#A9BFFF` | 11.58:1 | 10.42:1 |

| Additional text pair | Foreground | Background | Contrast |
| --- | --- | --- | ---: |
| Active navigation and caller message | `#FFFFFF` | `#18264B` | 14.81:1 |
| Highlighted option | `#FFFFFF` | `#263663` | 11.73:1 |
| Primary button | `#0A0A0A` | `#FFFFFF` | 19.80:1 |
| Primary button hover | `#0A0A0A` | `#CCCCCC` | 12.33:1 |
| Wordmark accent | `#3B6CF6` | `#000000` | 4.66:1 |
| Booking text | `#171C26` | `#FFFFFF` / `#EDF0F5` | 17.07:1 / 14.94:1 |
| Booking secondary text | `#4B5563` | `#FFFFFF` / `#EDF0F5` | 7.56:1 / 6.62:1 |
| Booking default accent label | `#FFFFFF` | `#275DF5` | 5.29:1 |
| Booking error | `#9F1239` | `#FFF1F2` | 7.30:1 |
| Booking confirmation icon | `#14643B` | `#E8F6ED` | 6.46:1 |

Workspace accents use black or white labels according to their luminance. The lowest ratio across all valid hex colours is at least 4.58:1.
