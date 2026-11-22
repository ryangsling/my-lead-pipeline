# US home-service calls

One workspace represents one crew and one calendar. A roofing estimate, an HVAC breakdown and a plumbing emergency use the same intake. The caller's need determines whether the next action is a visit, a callback or emergency advice.

## Urgent calls and live transfers

Store transferEnabled (boolean default false, including existing rows), callbackMinutes (integer default 15), E.164 on-call and backup numbers, and escalation triggers on the workspace. Use the booking hours and workspace timezone as the on-call schedule. The settings form exposes those fields and explains that transfer uses paid outbound minutes. The owner configures and tests an email and a Telegram notification channel.

Always register a synchronous notify_urgent function. Capture a usable callback number, problem and name, and persist one urgent event per workspace and conversation before sending either alert. Start email and Telegram in parallel during the call. Use the notification log's per-channel dedupe key and record delivery outcomes. Say the team was alerted and quote the configured callback time only after a provider accepts an alert. If delivery fails or no channel is configured, say the request was recorded and immediate contact could not be confirmed. The hub can verify provider acceptance. Handset delivery is a manual check.

On gas smell, fire or flooding near electrics, the first instruction is to get to safety and call 911 immediately. Intake and contractor contact come afterward. With transfer disabled, omit all transfer tools, destinations and transfer instructions from the synced assistant. With it enabled, notify first, then offer to connect the caller. Register a native Vapi transferCall tool with a server-resolved destination. The authenticated hub chooses the primary during opening hours and backup outside them. Refuse a missing number, an archived workspace or a disabled setting. Ignore model-supplied numbers. If the transfer goes unanswered, the already delivered alert remains with the owner for callback. Do not loop through paid calls.

Test migration defaults, both sync bodies, an archived or disabled destination request, deterministic routing by local hours, deduped urgent alerts before end-of-call, provider failure, and the life-safety prompt. Effort is medium.

## Service area and estimate visits

Keep ZIP codes as strings to preserve leading zeros. Store ZIP lists and optional city exceptions on workspaces. Empty lists preserve existing unrestricted workspaces. For a restricted workspace require a five-digit ZIP and match either an allowed ZIP or an exact case-insensitive city exception. Ask for the site ZIP before check_availability. Apply the same rule inside bookAppointment against current settings. A declined voice caller can leave contact details and a job for follow-up. Public booking collects the site information before fetching slots.

Add visitKind to services, default standard. Estimates require a site address and ZIP at booking. Reuse durationMin for visit length and bufferMin for travel. The admin edits the kind beside duration and buffer. The booking confirmation and prompt say “estimate visit” and explain that a visit does not guarantee a price or completed work. Booking notifications keep the service, time and hub link.

Test ZIPs with leading zeros, city exceptions, missing and out-of-area ZIPs, changed coverage between offer and commit, required estimate location and the existing buffered overlap constraint. Effort is medium.

## Jobs and dispositions

Create a jobs table with workspace, contact, optional conversation and appointment references, site address, ZIP, city, job type, problem, urgency, callback window, workspace timezone and lead source (Google, referral, yard sign, other). Link voice intake by workspace and conversation, and public bookings by appointment. Extend capture_lead and booking arguments for intake fields. Keep unprovided details empty. Present the job on the conversation detail page. Keep addresses and detailed problem descriptions behind the hub link in notifications.

Use a bounded disposition field in the structured output. An actual booking or persisted urgent/lead action takes precedence over model classification. Booked sends the existing booking notification, lead sends the lead alert and urgent sends the immediate alert. Price question, existing customer, vendor and spam are recorded silently by default. Keep the existing no-booking behavior when a report supplies no disposition. The CRM shows the disposition. The prompt asks about the problem, site, referral source and callback window when relevant, and gives no invented price.

Test linked lead and booked jobs, persisted timezone, provider classification precedence, and silence for spam. Effort is medium.

## Implementation order

1. Add workspace escalation settings, default-off sync and server-selected paid transfer routing.
2. Add ZIP and city coverage and estimate visits across booking settings, public booking and voice.
3. Persist job intake, display it in the CRM, and classify call dispositions.
4. Persist urgent events and deliver deduplicated alerts synchronously, including honest failure wording and life-safety instructions.
