# Rachio Winterizer

A browser-based tool for cycling irrigation zones during a supervised compressed-air
blowout. Set the zone duration, the recovery/cooldown interval, and the number of
passes. Built by `radian23`. Independent of Rachio.

## Intended use and contractor access

This tool is intended primarily for **homeowners winterizing their own irrigation
systems**, using their own Rachio account and API key. Its configurable recovery and
cooldown intervals are useful when working with a smaller compressor.

Rachio supports delegated contractor access in its own app, but its
[third-party integration documentation](https://support.rachio.com/en_us/smart-home-integrations-rJOy_UyYP)
states that shared-access devices are not supported for third-party integrations.
A controller visible in a contractor's Rachio app therefore should not be assumed
to be available through that contractor's API key in this tool.

The newer [Pro Business Accounts documentation](https://support.rachio.com/en_us/rachio-pro-business-accounts-rJRC06pg)
describes managing client properties in Rachio, but does not confirm public-API access
to those shared properties. **Contractor/shared-account operation has not been
verified and is not advertised as supported.**

A homeowner can connect on their own device using their own key while working with
a contractor. There is no need to hand the contractor the homeowner's API key.
If a key returns multiple controllers, this tool supports selecting among them and
saving separate settings; each session operates one controller at a time. It is not
a contractor fleet-management or simultaneous multi-property control system.

## Hosted app

Open **https://simpleplum.com/rachio-winterizer/** on your phone or computer.
Settings are local to each browser and website origin; settings from localhost do
not automatically transfer. No installation is needed.

## Run locally

Requires Python 3 to serve the files. No dependency installation or build is needed.

```sh
python3 -m http.server 8765 --bind 127.0.0.1
```

Open **http://127.0.0.1:8765**. Serve the files over HTTP; opening `index.html`
directly from disk may block JavaScript modules or API access.

You can also host these static files with GitHub Pages. Choose the repository's
`main` branch and root directory in **Settings → Pages** after publishing.
GitHub Pages serves the interface; it does not execute the sequence on a server.

## Use

1. Try **Explore with a simulated controller** first. It makes no network requests
   and uses real elapsed time. Use short settings, such as 1 second/run, 1 second/wait,
   and 1 pass, for a quick test. Reconnect to return to a real controller.
2. Get your key in the Rachio mobile app: **Profile → API key → Copy**.
3. Connect, choose a controller, and select the enabled zones to include.
4. Set **Run** in seconds, **Wait** in seconds, and **Passes**.
5. Under **Optional settings**, enable **Use a different duration for the first pass**
   if desired, then set its duration in seconds. This applies to every selected zone
   on pass one; later passes use the regular run duration. It is off by default.
6. Optionally enable **Add extra rest between passes** and set its duration.
   This is added after the normal wait at each pass boundary, except after the final
   pass. It is off by default; enabling it initially suggests 180 seconds.
7. Start and stay present. Use **Stop session** to cancel early.

The defaults are a **30-second run**, **480-second wait (8 minutes)**, **4 passes**,
and **0 seconds of extra rest between passes**. With eight zones, this estimates
**4 hours 24 minutes**, plus API delays. There is no wait after the final zone.
Wait is your measured recharge time plus your chosen cooldown; this tool does not
measure or guarantee compressor motor duty cycle. These are starting values, not
a recommendation for every compressor. Existing saved controller settings are
preserved; use Reset to restore the current defaults (and clear your API key).
Both optional settings default to off. Their enabled states and durations are saved
per controller; saved settings from older versions without enabled flags load with
these options off. First-pass durations are included in estimates and pause/resume.

Disable normal irrigation schedules and avoid other controller commands during the
session. Stop affects **all watering on the selected controller**. Only enabled zones
are offered, in zone-number order.

## Appearance

Use the sun/moon button in the header to switch between light and dark. Until you
make a choice, the app follows your browser/device color preference, with dark as
the fallback. Your manual choice is saved locally in your browser. Theme and controller-specific run settings are saved locally; your API key remains
in tab memory.

## Saved settings and screen sleep protection

Timing values and selected zones are saved automatically in this browser, separately
for each controller ID. Simulation has its own settings namespace. Selecting a controller
restores its settings; a new controller starts with defaults. Removed or disabled zones
are never run because of an old saved selection. New zones require selection if they
were not in the saved list. Nothing resumes automatically.

**Reset settings & clear API key** deletes only the selected controller's saved
settings, restores default timing, clears the API key from the form and API client,
and disconnects the controller. Reconnect before starting another session; all
currently enabled zones are selected unless that controller still has saved settings.
It leaves other controllers and the theme preference alone. Settings cannot be cleared
or edited during a session or while Stop is unconfirmed. If browser storage is blocked,
the app can still run and reports that settings were not saved.

A screen wake lock is requested automatically during active sessions, including waits
and Stop cleanup, and released when cleanup ends. The
app tries again when you return to a visible tab. HTTPS (such as GitHub Pages) or a
trusted local origin such as localhost is required. Unsupported browsers, low battery,
power-saving settings, tab visibility, or browser policies can prevent/release the lock.
Keep the tab open: a screen wake lock does not guarantee background execution, prevent
manual device sleep, or replace continuous compressor supervision.

## Pause and Resume

**Pause session** stops the active zone, retains its estimated remaining time, and
holds the sequence until you press **Resume session**. It waits for Stop acknowledgement
before enabling Resume. A Start that is already pending must settle before the pause
can be confirmed. Pausing a recovery or extra-pass-rest interval holds that countdown.

Resume sends a new zone Start with only the remaining duration, rounded up to the next
whole second. A resumed attempt counts once when the full zone run finishes. These are
browser-timer estimates; network/valve delays can affect the actual airflow duration.
The native timed Rachio pause endpoint is intentionally not used because a timed pause
can expire without a manual Resume. No Start is automatically retried on failure.

Stop is available while paused and ends the session permanently. Pause/Resume errors
halt the session and attempt Stop. Wake lock remains requested while paused: keep the
tab open and continue supervising your equipment. Closing the page loses the session;
it will not automatically resume later.

The display shows the current phase countdown, total remaining time in minutes:seconds,
and estimated clock time of completion. Remaining time holds while paused, while the clock
estimate moves forward each second to show the finish time if resumed now. It includes remaining runs, recovery intervals, and
extra rest between passes; API delays can extend completion time.

## Stop and failures

- Each Start includes a duration in seconds for Rachio to enforce.
- Only one session can run. Its selected zones and timings are captured at Start.
- Stop cancels future starts and interrupts the browser's wait immediately.
- Stop sends a command immediately, then the sequence sends a final Stop after any
  pending Start settles. Run remains locked throughout this cleanup.
- A failed/timed-out Start halts the entire session. Starts are never automatically
  retried because a missing response does not prove a command was not delivered.
- Requests, including response reads, have a 15-second timeout.
- A failed final Stop leaves **Stop unconfirmed** visible, keeps Run locked, and
  offers **Retry Stop**. Check the Rachio app and your equipment.
- Passes are bounded; failed or interrupted attempts do not count as completed runs.
- Counts reflect elapsed, API-accepted timed runs, not sensor-confirmed valve operation.

The application requires an awake computer, an open tab, internet access, and Rachio's
cloud API. Closing/reloading the page does not immediately stop an active zone. Rachio
should finish its requested duration, and future browser commands cease. A browser leave
warning is provided where supported, but is not a shutdown mechanism. There is no resume.

A timed-out HTTP command cannot be retracted. API acknowledgement does not prove physical
valve closure. Command delivery can be delayed; verify shutdown using Rachio/manual
controls when state is uncertain. No browser-based tool can guarantee delivery during
an outage.

## Equipment

Choose a wait interval sufficient for recharge **and additional motor-off cooling**.
Insufficient cooling can cause overheating and equipment damage. Some compressors
are rated for 50% duty cycle, but ratings and allowed cycle periods vary: follow your
manufacturer's duty-cycle rating, maximum runtime, and cooling requirements. Measure
motor runtime during recovery, include any motor runtime during the blowout, and use
that total when selecting the interval. Recharge is not motor-off cooldown.

This tool is provided as is. Use it at your own risk. To the extent permitted by law,
the author accepts no responsibility for damage to compressors, irrigation systems,
or other equipment arising from its use. See LICENSE for the full warranty disclaimer.

**Continuous supervision is required, including recovery and rest periods.** Do not
leave the compressor running unattended. Fire, overheating, electrical faults, and
other equipment failures can occur. The app cannot detect these problems or turn
off the compressor; its Stop button controls irrigation valves only. If a problem
occurs, stop using the equipment and shut it down safely following the manufacturer’s
instructions. An extra 3–5 minute break is an optional scheduling interval, not a
guarantee of adequate cooling or a substitute for per-zone duty-cycle requirements.

Stay with the compressor. Follow the winterization instructions and pressure limits
for your compressor, irrigation components, and backflow equipment. Regulate air
appropriately. This software controls zone valves only; it does not switch compressor
power, isolate air, measure pressure, detect dry zones, or establish that winterization
is complete. Ensure your physical setup permits safe recovery intervals with zone
valves closed. Stop passing air through dry components.

## Privacy

The real controller's API key is held in JavaScript memory in the current tab. It is
not stored in localStorage, cookies, repository files, URLs, or logs. The connected
key is sent only in authorization headers to `https://api.rach.io`. Closing the tab
clears the application's memory. There are no third-party scripts, fonts, or dependencies.
The Simple Plum hosted copy makes one cookieless page-view request to its own Matomo
installation. It includes the fixed page address and referring website origin when
available; the server records IP addresses for visitor/location reports. The code
never reads or transmits API keys, form values, controller details, or session logs.
Browser Do Not Track and Global Privacy Control are respected. Other hosts and
localhost do not send analytics to Simple Plum. The simulated controller makes no
Rachio requests. Never commit your API key.

## Development and validation

Node.js 22 or later is used for tests; the deployed page needs only a modern browser.

```sh
npm test
```

The tests cover bounded passes, recovery timing, failure handling, interrupted runs,
Stop/restart races, late Start responses, unconfirmed Stop/retry, timeout behavior,
API payloads, and UI wiring through a minimal mocked DOM. All use simulated APIs.
The maintainer has reported successful operation on a real controller. Automated tests use
simulated APIs; no automated browser-rendering verification has been performed.
The maintainer has also confirmed the hosted interface works on his phone. Controller switching and saved-settings isolation are tested with
two simulated controller IDs through the application UI.

Files:

- `engine.js`: Rachio API client, plan generation, cancellation and session state
- `app.js`: browser controls, simulation and display
- `browser-support.js`: controller settings and screen wake lock lifecycle
- `analytics.js`: hosted-copy-only first-party page-view counting
- `index.html` / `style.css`: original interface and styling
- `test/`: simulation and DOM smoke tests

## Source and license

This implementation was written anew from the project requirements and Rachio's public
API documentation. No source files, styling, assets, or patch code from the previously
reviewed third-party project are included. The implementer had previously reviewed that
project; this is not represented as a formal clean-room implementation. See
[DEVELOPMENT.md](DEVELOPMENT.md) for the development record.

Released under the [MIT License](LICENSE). Rachio is a trademark of its respective owner;
this project is not endorsed by or affiliated with Rachio.

API references: [authentication](https://rachio.readme.io/reference/authentication),
[zone start](https://rachio.readme.io/reference/zonestart),
[controller Stop](https://rachio.readme.io/reference/devicestop_water),
[API limits](https://rachio.readme.io/reference/rate-limiting).
