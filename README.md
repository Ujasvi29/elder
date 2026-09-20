# elder-care

A mobile platform for elderly safety, emergency response, and caregiver management.

ElderCare is an emergency response and caregiver assistance application built using React Native (Expo) for the mobile app, Node.js + Express for the backend API, and PostgreSQL for persistent data storage.

---

## 1. Overview & Project Goals

ElderCare is designed to assist elderly individuals in remaining safe while keeping their family members and care network connected:

- **Emergency & Safety Response**: High-contrast, large-button mobile interface for elderly users to trigger emergency alerts, request ambulances, view weather/disaster warnings, call the 24/7 response helpline, or signal a manual fall event.
- **Family & Caregiver Monitoring**: Web/mobile dashboards for family members and caregivers to receive real-time alerts, monitor safety status, and manage care schedules.
- **Elderly-Friendly Accessibility**: Tailored for high stress and low vision with large touch targets (height 56px+ to 220px buttons), high contrast color palettes, clear screen-reader labels (`accessibilityRole`, `accessibilityLabel`), and minimal navigation complexity.

---

## 2. Technology Stack

| Layer | Technology | Usage |
|---|---|---|
| **Mobile App** | React Native (Expo SDK 54) | Single codebase for iOS and Android |
| **Backend API** | Node.js + Express (ES Modules) | RESTful API endpoints, Bearer JWT authentication, input validation |
| **Database** | PostgreSQL 18 | Relational storage for users, alerts, bookings, and location data |
| **Storage / Auth** | Expo SecureStore & JWT | Persistent JWT access tokens and secure session management |
| **Native Integration** | React Native `Linking` & Location | Phone dialer (`tel:`) and GPS location capture |

---

## 3. Directory & Repository Structure

```text
elder-care/
├── backend/
│   ├── emergency/
│   │   ├── ambulance/         # Ambulance booking service & mock provider
│   │   ├── disaster/          # Disaster alerts service & mock provider
│   │   ├── notifications/     # Emergency contact fanout & escalation
│   │   ├── alerts.js          # SOS and Fall alert database queries
│   │   ├── locations.js       # GPS reading ingestion
│   │   ├── routes.js          # Express emergency sub-router
│   │   └── validate.js        # Input validation helpers
│   ├── shared/
│   │   ├── auth/              # JWT middleware & user authentication
│   │   ├── db/                # PostgreSQL connection pool & schema.sql
│   │   └── http/              # Centralized error handling
│   ├── server.js              # Express app entry point (port 5000)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── emergency/
│   │   │   ├── api/           # API clients (alerts, ambulance, disaster)
│   │   │   └── screens/       # ElderlyHome, AmbulanceBooking, AmbulanceStatus, DisasterAlerts, DisasterDetail, ResponseCenter, FallDetection
│   │   ├── caregiver/         # Caregiver management screens
│   │   └── shared/
│   │       ├── api/           # Base fetch client with JWT headers
│   │       ├── auth/          # AuthContext provider & SecureStore token storage
│   │       ├── location/      # GPS location capture helper
│   │       ├── navigation/    # AppNavigator & AuthNavigator role-based routing
│   │       ├── screens/       # LoginScreen, RegisterScreen, AdminHomeScreen
│   │       ├── ui/            # Theme tokens (colors, spacing, typography)
│   │       └── config.js      # Base API URL & helpline configuration
│   └── package.json
├── API.md                     # REST API specification
├── SCHEMA_DESIGN.md           # PostgreSQL database design
├── WORK_DIVISION.md           # Module ownership & phase breakdown
└── README.md
```

---

## 4. Completed Features

### Phase 0 — Login & Registration
- **Elderly-Friendly Sign In**: Phone number or email login with password show/hide toggle, large touch targets, accessible error messages, and loading feedback.
- **Registration Flow**: Auto-defaulted `elderly` role (so elderly users do not have to pick zones or complex roles), password confirmation matching, and input sanitization.
- **Token Persistence**: JWT tokens stored securely via Expo `SecureStore` for seamless auto-login across app restarts.
- **Role-Based Routing**: Dynamic routing in `AppNavigator.js` serving tailored experiences for `elderly`, `family`, `caregiver`, and `admin` roles.

### Phase 5 — Emergency Response Services

#### 1. Emergency Ambulance Booking
- **Booking Request Form**: GPS auto-capture with manual address entry fallback, destination hospital chips (Apollo, Fortis, Manipal, City General, Nearest ER) + custom input, and notes field.
- **Confirmation Protection**: Review modal ("Confirm Ambulance Request") before submission to prevent accidental dispatches.
- **Active Booking Protection**: Prevents duplicate bookings; automatically redirects users with an active booking to the status view.
- **Mock Ambulance Provider**: Backend mock dispatch generating driver name, vehicle registration number, driver contact number, and ETA (5–12 mins).
- **Status Screen**: Live status tracking badge (`REQUESTED`, `DISPATCHED`, `EN ROUTE`, `ARRIVED`, `COMPLETED`, `CANCELLED`), ETA countdown, driver contact details, direct **📞 Call Driver** action (`tel:`), status refresh, and cancellation modal.

#### 2. Disaster Alerts
- **Area Warnings List**: High-contrast list screen displaying active weather/disaster warnings (Heavy Rain, Severe Flood Warning, Extreme Heatwave, Thunderstorm Advisory).
- **Severity Visuals**: Color-coded badges (`CRITICAL` in crimson, `HIGH` in red, `MEDIUM` in orange, `LOW` in blue).
- **Meta & Timestamps**: Displays affected area (e.g. *Hyderabad Central*) and relative timestamps (*"Issued 25 mins ago"*).
- **Alert Details View**: Complete warning text, official source attribution (*IMD / Disaster Relief Feed*), and a dedicated **Elderly Safety Guidelines** card.
- **Pull-To-Refresh**: Integrated `RefreshControl` and empty/error state views with retry actions.

#### 3. 24/7 Emergency Response Center
- **Helpline Contact Screen**: Contact screen with a prominent **CALL EMERGENCY CENTER** primary button (min height 56px).
- **Native OS Dialer Integration**: Calls `Linking.openURL('tel:<number>')` to launch the device's native phone dialer with user confirmation.
- **Configurable Settings**: Response helpline phone number (`EMERGENCY_RESPONSE_CENTER_PHONE`) and desk name (`EMERGENCY_RESPONSE_CENTER_NAME`) configured in `src/shared/config.js` (overridable via `app.config.js` / `extra`).
- **Emergency Advice**: Clear, calm bullet-point instructions for crisis situations.
- **Emergency Shortcuts**: Quick navigation links to Ambulance Booking, Disaster Alerts, and Emergency SOS.

#### 4. Hybrid Fall Detection (Automatic Motion + Manual "I FELL")
- **Hybrid System Overview**: Combines phone motion sensor monitoring (`expo-sensors`) with a manual "I FELL" emergency override button.
- **Multi-Stage Motion Heuristic**: Uses accelerometer & gyroscope data to evaluate impact acceleration spike, angular rotation, and post-impact rest phase before starting countdown, preventing false triggers from simple phone drops.
- **10-Second Confirmation Countdown Overlay**: Shows a visible `10..9..8..7..6..5..4..3..2..1` timer modal (`⚠️ POSSIBLE FALL DETECTED`):
  - **`I'M OK`**: Cancels alert, stops countdown, clears state, enters 10s cooldown.
  - **`SEND HELP NOW`**: Immediately sends emergency fall alert.
  - **Timeout (0s)**: Automatically creates fall alert and notifies contacts if user does not respond within 10 seconds.
- **Manual Override**: The large "I FELL" button remains available for immediate manual emergency requests.
- **Sensor Availability & Permissions**: Gracefully detects when motion sensors are unavailable (e.g. web or emulators without motion hardware) and falls back to Manual Fall Mode with clear UI messaging without crashing.
- **Emergency Contact Fanout**: Integrates with the backend alert pipeline (`advanceFanout`), notifying emergency contacts by priority (SMS, push, email).

---

## 5. Mock Provider Architecture

External provider integrations (Ambulance dispatch, Disaster warning feeds, 24/7 Response helpline) currently use isolated backend mock providers:

```text
Mobile App Screens
       ↓
Express API Routes
       ↓
Service Layer (ambulance.js / disaster.js)
       ↓
Mock Provider Layer (mockProvider.js)
       ↓
PostgreSQL Database (ambulance_bookings / disaster_alerts)
```

**Future Real Provider Integration**:
When real third-party provider APIs (e.g. 108 Ambulance fleet API, NDMA/IMD disaster alert feed) are contracted by the client:
- Only `mockProvider.js` is replaced with `realProvider.js` in the backend service layer.
- **Zero changes** are needed in database schemas, Express controllers, API contracts, or mobile screen components.

---

## 6. Database Schema & Tables

The Phase 5 Emergency Response module integrates directly with the existing PostgreSQL schema defined in `backend/shared/db/schema.sql`:

1. `users`: Shared authentication table (columns: `id`, `phone`, `email`, `role`, `full_name`, `password_hash`).
2. `ambulance_bookings`: Stores ambulance dispatches (columns: `id`, `user_id`, `pickup_address`, `destination_hospital`, `status`, `driver_name`, `driver_phone`, `vehicle_number`, `eta_minutes`, `notes`).
3. `disaster_alerts`: Stores active area advisories (columns: `id`, `title`, `description`, `disaster_type`, `severity` enum: `low`/`medium`/`high`/`critical`, `area_name`, `source`, `external_id`, `issued_at`, `expires_at`, `is_active`).
4. `alerts`: Stores emergency SOS and manual fall events (columns: `id`, `user_id`, `alert_type` enum: `sos`/`fall`, `status`, `severity`, `latitude`, `longitude`, `message`, `triggered_at`).

---

## 7. Setup & How to Run

### Prerequisites
- Node.js (v18 or higher)
- PostgreSQL (v14 or higher running on default port `5432` with database `eldercare`)
- Expo Go mobile application on Android/iOS (or Android Emulator / iOS Simulator)

### 1. Backend Setup
```bash
cd backend
npm install

# Copy .env.example at the repository root to .env and fill it in.
# The backend reads exactly two required variables (shared/config/env.js):
#   DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@localhost:5432/eldercare
#   JWT_SECRET=<32+ random characters>
# Optional: PORT (defaults to 5000), plus the notification-channel keys
# documented in .env.example. A missing DATABASE_URL or JWT_SECRET exits
# at startup with a message naming the file.

npm start
```
*Backend runs on `http://localhost:5000` with health check at `http://localhost:5000/health`.*

### 2. Mobile App Setup
```bash
cd frontend
npm install

# Start Metro bundler with Expo Go
npx expo start --go -c
```
*Scan the generated QR code using Expo Go on your mobile device (ensure handset and computer are connected to the same local Wi-Fi network).*

---

## 8. API Documentation
All API endpoints, request/response formats, error codes, and authentication requirements are documented in [`API.md`](file:///c:/Users/ujasv/OneDrive/Desktop/Elder%20Care/elder-care/API.md).

---

## 9. Notes for Reviewers

Things a new owner of this repository needs to know before building or deploying it.

- **The EAS project belongs to `@sree25`.** `frontend/app.config.js` carries
  `extra.eas.projectId = c89864ad-512c-4674-9258-236cb3b560f9`, which is linked to a
  personal Expo account. Another organisation cannot build against it. Run
  `npx eas-cli init` from `frontend/` to create and link a project under your own
  account before the first build; that rewrites the `projectId`. Note that Expo push
  tokens are project-scoped, so existing `device_tokens` rows become stale once the id
  changes.
- **`usesCleartextTraffic` is `true`, for development only.** Set via the
  `expo-build-properties` plugin in `frontend/app.config.js`. It exists because
  `EXPO_PUBLIC_API_URL` is a plain `http://` LAN address during development, and
  Android blocks cleartext by default. Before any production build, either replace it
  with a `network_security_config.xml` scoped to private address ranges, or drop it
  once the backend is reachable over `https://`.
- **`EXPO_PUBLIC_API_URL` must be set as an EAS environment variable before building.**
  The `preview` and `production` profiles have no fallback: `app.config.js` throws
  during config resolution if the variable is missing, rather than baking in a
  localhost address an installed app can never reach. Local development does not need
  it — the dev client resolves the backend from Metro's own host. See `SETUP.md`.
- **Ambulance dispatch and disaster alerts run on mock providers, by design.**
  `backend/emergency/ambulance/mockProvider.js` and
  `backend/emergency/disaster/mockProvider.js` simulate driver assignment and the alert
  feed. No third-party emergency service is contacted. See section 5 for the
  architecture and the swap points for a real provider.
