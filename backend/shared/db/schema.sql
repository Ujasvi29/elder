-- ============================================================================
-- ElderCare - Database Schema
-- PostgreSQL 14+   (no PostGIS)
--
-- Revision 2. 21 tables: 6 shared, 7 emergency, 8 caregiver.
--
-- Run once against an empty database:
--   psql -U postgres -d eldercare -f backend/shared/db/schema.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- provides gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Enum types
-- ----------------------------------------------------------------------------

CREATE TYPE user_role             AS ENUM ('elderly', 'family', 'caregiver', 'admin');
CREATE TYPE family_permission     AS ENUM ('view', 'manage', 'owner');
CREATE TYPE link_status           AS ENUM ('pending', 'active', 'revoked');
CREATE TYPE device_platform       AS ENUM ('ios', 'android', 'web');

CREATE TYPE alert_type            AS ENUM ('sos', 'fall', 'geofence_breach', 'disaster', 'manual');
CREATE TYPE alert_status          AS ENUM ('active', 'acknowledged', 'resolved', 'cancelled', 'false_alarm');
CREATE TYPE alert_severity        AS ENUM ('low', 'medium', 'high', 'critical');

CREATE TYPE notification_channel  AS ENUM ('sms', 'voice_call', 'push', 'email');
CREATE TYPE notification_status   AS ENUM ('pending', 'sent', 'delivered', 'failed', 'read');

CREATE TYPE ambulance_status      AS ENUM ('requested', 'dispatched', 'en_route', 'arrived', 'completed', 'cancelled');

CREATE TYPE verification_status   AS ENUM ('pending', 'verified', 'rejected', 'suspended');
CREATE TYPE booking_status        AS ENUM ('requested', 'confirmed', 'active', 'completed', 'cancelled', 'rejected');
CREATE TYPE schedule_status       AS ENUM ('scheduled', 'completed', 'missed', 'cancelled', 'rescheduled');
CREATE TYPE attendance_status     AS ENUM ('pending', 'checked_in', 'checked_out', 'absent', 'late');
CREATE TYPE care_plan_status      AS ENUM ('draft', 'active', 'archived');
CREATE TYPE task_priority         AS ENUM ('low', 'normal', 'high');
CREATE TYPE task_status           AS ENUM ('pending', 'in_progress', 'completed', 'skipped', 'cancelled');

-- ----------------------------------------------------------------------------
-- Keeps updated_at correct without the application having to remember
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- SHARED MODULE
-- ============================================================================

CREATE TABLE users (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone               VARCHAR(20)  NOT NULL UNIQUE,
    email               VARCHAR(255) UNIQUE,
    password_hash       TEXT         NOT NULL,
    full_name           VARCHAR(120) NOT NULL,
    role                user_role    NOT NULL,
    date_of_birth       DATE,
    gender              VARCHAR(20),
    preferred_language  VARCHAR(10)  NOT NULL DEFAULT 'en',
    profile_photo_url   TEXT,
    address_line        TEXT,
    city                VARCHAR(100),
    state               VARCHAR(100),
    postal_code         VARCHAR(12),
    is_active           BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at       TIMESTAMPTZ,
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role   ON users (role);
CREATE INDEX idx_users_active ON users (is_active) WHERE is_active = TRUE;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Who may see and manage whose data. Deliberately separate from
-- emergency_contacts: being phoned in a crisis is not the same permission
-- as being able to watch someone's live location.
CREATE TABLE family_links (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    elderly_user_id        UUID               NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    family_user_id         UUID               NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    relationship           VARCHAR(50),
    permission_level       family_permission  NOT NULL DEFAULT 'view',
    can_view_location      BOOLEAN            NOT NULL DEFAULT TRUE,
    can_manage_contacts    BOOLEAN            NOT NULL DEFAULT FALSE,
    can_manage_caregivers  BOOLEAN            NOT NULL DEFAULT FALSE,
    can_acknowledge_alerts BOOLEAN            NOT NULL DEFAULT TRUE,
    status                 link_status        NOT NULL DEFAULT 'pending',
    invited_by             UUID               REFERENCES users (id) ON DELETE SET NULL,
    approved_at            TIMESTAMPTZ,
    revoked_at             TIMESTAMPTZ,
    created_at             TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ        NOT NULL DEFAULT now(),
    CONSTRAINT uq_family_link  UNIQUE (elderly_user_id, family_user_id),
    CONSTRAINT chk_not_self    CHECK (elderly_user_id <> family_user_id)
);

-- "Which elderly people can this family member open?" â€” run on every login.
CREATE INDEX idx_family_links_family  ON family_links (family_user_id) WHERE status = 'active';
CREATE INDEX idx_family_links_elderly ON family_links (elderly_user_id) WHERE status = 'active';

CREATE TRIGGER trg_family_links_updated_at
    BEFORE UPDATE ON family_links
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Long-lived session credentials. Stored so a device can be logged out
-- remotely; hashed so a leaked database yields no usable sessions.
CREATE TABLE refresh_tokens (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash            TEXT          NOT NULL UNIQUE,
    device_label          VARCHAR(120),
    ip_address            INET,
    user_agent            TEXT,
    issued_at             TIMESTAMPTZ   NOT NULL DEFAULT now(),
    expires_at            TIMESTAMPTZ   NOT NULL,
    last_used_at          TIMESTAMPTZ,
    revoked_at            TIMESTAMPTZ,
    revoked_reason        VARCHAR(100),
    replaced_by_token_id  UUID          REFERENCES refresh_tokens (id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_refresh_tokens_exp  ON refresh_tokens (expires_at);


-- One row per physical device. Never a column on users: a person with a
-- phone and a tablet would silently lose alerts on one of them.
CREATE TABLE device_tokens (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID             NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    expo_push_token   TEXT             NOT NULL UNIQUE,
    platform          device_platform  NOT NULL,
    device_name       VARCHAR(120),
    device_model      VARCHAR(120),
    app_version       VARCHAR(20),
    os_version        VARCHAR(40),
    is_active         BOOLEAN          NOT NULL DEFAULT TRUE,
    last_seen_at      TIMESTAMPTZ,
    failure_count     SMALLINT         NOT NULL DEFAULT 0,
    created_at        TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX idx_device_tokens_user ON device_tokens (user_id) WHERE is_active = TRUE;

CREATE TRIGGER trg_device_tokens_updated_at
    BEFORE UPDATE ON device_tokens
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Pending Expo push tickets tracked for asynchronous receipt reconciliation.
-- Populated on successful ticket return from Expo push API; removed once
-- receipt status is verified or ticket expires after 24h.
CREATE TABLE push_receipt_tickets (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id         TEXT             NOT NULL UNIQUE,
    expo_push_token   TEXT             NOT NULL,
    user_id           UUID             REFERENCES users (id) ON DELETE CASCADE,
    created_at        TIMESTAMPTZ      NOT NULL DEFAULT now()
);

CREATE INDEX idx_push_receipt_tickets_created_at ON push_receipt_tickets (created_at);


-- The in-app notification feed. Cross-cutting rather than owned by one
-- module: emergency, family and caregiver routes all write here through
-- notifications/feedWriter.js, and every role reads its own rows back from
-- GET /notifications.
--
-- Push delivery and this table are deliberately separate. A push is a
-- best-effort interruption that may never arrive; a feed row is the durable
-- record the person can come back to. `data` carries the deep link the feed
-- screen navigates with: { screen, params }.
--
-- Also shipped as migrations/001_notification_feed.sql for databases created
-- before this table existed. That file and this block must stay identical.
CREATE TABLE notification_feed (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    recipient_user_id UUID            NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    event_type        VARCHAR(50)     NOT NULL,
    event_id          UUID,                       -- nullable: references source row (alert, booking, link, task)
    title             VARCHAR(200)    NOT NULL,
    body              TEXT,
    data              JSONB,                      -- deep-link metadata: { screen, params }
    is_read           BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_feed_recipient ON notification_feed (recipient_user_id, created_at DESC);
CREATE INDEX idx_feed_unread    ON notification_feed (recipient_user_id, created_at DESC)
    WHERE is_read = FALSE;

-- ============================================================================
-- EMERGENCY MODULE
-- ============================================================================

CREATE TABLE emergency_contacts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    -- Set only so we can also reach this contact by push. Grants no access.
    contact_user_id  UUID         REFERENCES users (id) ON DELETE SET NULL,
    full_name        VARCHAR(120) NOT NULL,
    phone            VARCHAR(20)  NOT NULL,
    email            VARCHAR(255),
    relationship     VARCHAR(50),
    priority         SMALLINT     NOT NULL DEFAULT 1 CHECK (priority BETWEEN 1 AND 10),
    notify_by_sms    BOOLEAN      NOT NULL DEFAULT TRUE,
    notify_by_call   BOOLEAN      NOT NULL DEFAULT TRUE,
    notify_by_push   BOOLEAN      NOT NULL DEFAULT TRUE,
    is_active        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_contact_per_user UNIQUE (user_id, phone)
);

CREATE INDEX idx_contacts_user   ON emergency_contacts (user_id, priority);
CREATE INDEX idx_contacts_linked ON emergency_contacts (contact_user_id);

CREATE TRIGGER trg_contacts_updated_at
    BEFORE UPDATE ON emergency_contacts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE geofences (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    name               VARCHAR(100)  NOT NULL,
    center_latitude    NUMERIC(9,6)  NOT NULL,
    center_longitude   NUMERIC(9,6)  NOT NULL,
    radius_meters      INTEGER       NOT NULL CHECK (radius_meters > 0),
    fence_type         VARCHAR(20)   NOT NULL DEFAULT 'safe_zone',
    alert_on_exit      BOOLEAN       NOT NULL DEFAULT TRUE,
    alert_on_enter     BOOLEAN       NOT NULL DEFAULT FALSE,
    is_active          BOOLEAN       NOT NULL DEFAULT TRUE,
    created_by         UUID          REFERENCES users (id) ON DELETE SET NULL,
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX idx_geofences_user ON geofences (user_id) WHERE is_active = TRUE;

CREATE TRIGGER trg_geofences_updated_at
    BEFORE UPDATE ON geofences
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


-- Raw GPS trail. Retention policy: 30 days, then delete.
-- The cleanup job is Phase 6:
--   DELETE FROM locations WHERE recorded_at < now() - INTERVAL '30 days';
-- Run daily, in batches of a few thousand rows, so it never holds a long lock.
-- Safe to purge because alerts carry their own coordinates.
CREATE TABLE locations (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    latitude         NUMERIC(9,6)  NOT NULL,
    longitude        NUMERIC(9,6)  NOT NULL,
    accuracy_meters  NUMERIC(6,2),
    altitude_meters  NUMERIC(7,2),
    speed_mps        NUMERIC(6,2),
    heading_degrees  NUMERIC(5,2)  CHECK (heading_degrees BETWEEN 0 AND 360),
    battery_level    SMALLINT      CHECK (battery_level BETWEEN 0 AND 100),
    is_moving        BOOLEAN,
    source           VARCHAR(20)   NOT NULL DEFAULT 'gps',
    recorded_at      TIMESTAMPTZ   NOT NULL DEFAULT now(),
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    -- One reading per user per GPS timestamp. Backs createLocation's
    -- ON CONFLICT DO NOTHING, which absorbs the queued-retry duplicates a
    -- foreground mount/background task resend produces (see BUILD_LOG.md).
    CONSTRAINT locations_user_recorded_at_key UNIQUE (user_id, recorded_at)
);

-- The only query this table ever serves: latest positions for one user.
CREATE INDEX idx_locations_user_time ON locations (user_id, recorded_at DESC);
-- Supports the Phase 6 retention sweep.
CREATE INDEX idx_locations_recorded  ON locations (recorded_at);


CREATE TABLE alerts (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id           UUID            NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    alert_type        alert_type      NOT NULL,
    status            alert_status    NOT NULL DEFAULT 'active',
    severity          alert_severity  NOT NULL DEFAULT 'high',
    -- Own copy of the position: an SOS may fire with GPS off, and this
    -- outlives the 30-day location retention window.
    latitude          NUMERIC(9,6),
    longitude         NUMERIC(9,6),
    -- Accuracy of whatever reading is currently on latitude/longitude, and
    -- when the device actually took it — distinct from triggered_at, since a
    -- last-known or async-attached fix can predate or postdate alert
    -- creation. location_is_approximate is true only for a getLastKnownPositionAsync
    -- floor value; an async-attached fresh fix always clears it back to false.
    location_accuracy_meters  NUMERIC(6,2),
    location_is_approximate   BOOLEAN     NOT NULL DEFAULT FALSE,
    location_captured_at      TIMESTAMPTZ,
    location_id       UUID            REFERENCES locations (id) ON DELETE SET NULL,
    geofence_id       UUID            REFERENCES geofences (id) ON DELETE SET NULL,
    message           TEXT,
    triggered_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    acknowledged_at   TIMESTAMPTZ,
    acknowledged_by   UUID            REFERENCES users (id) ON DELETE SET NULL,
    resolved_at       TIMESTAMPTZ,
    resolved_by       UUID            REFERENCES users (id) ON DELETE SET NULL,
    resolution_notes  TEXT,
    created_at        TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_user_time ON alerts (user_id, triggered_at DESC);
-- Partial index: "are there open alerts?" stays fast as history grows.
CREATE INDEX idx_alerts_active    ON alerts (user_id, triggered_at DESC) WHERE status = 'active';
-- Not for reads. The Phase 6 location purge must find every alert referencing
-- a deleted location to apply ON DELETE SET NULL; without this it scans the
-- whole alerts table once per deleted row.
CREATE INDEX idx_alerts_location  ON alerts (location_id);

CREATE TRIGGER trg_alerts_updated_at
    BEFORE UPDATE ON alerts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE notifications (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    alert_id               UUID                  NOT NULL REFERENCES alerts (id) ON DELETE CASCADE,
    recipient_user_id      UUID                  REFERENCES users (id) ON DELETE SET NULL,
    emergency_contact_id   UUID                  REFERENCES emergency_contacts (id) ON DELETE SET NULL,
    device_token_id        UUID                  REFERENCES device_tokens (id) ON DELETE SET NULL,
    channel                notification_channel  NOT NULL,
    destination            VARCHAR(255)          NOT NULL,
    status                 notification_status   NOT NULL DEFAULT 'pending',
    provider               VARCHAR(50),
    provider_message_id    VARCHAR(255),
    error_message          TEXT,
    attempt_count          SMALLINT              NOT NULL DEFAULT 0,
    sent_at                TIMESTAMPTZ,
    delivered_at           TIMESTAMPTZ,
    read_at                TIMESTAMPTZ,
    created_at             TIMESTAMPTZ           NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_alert     ON notifications (alert_id);
CREATE INDEX idx_notifications_recipient ON notifications (recipient_user_id, created_at DESC);
-- Used to match a provider delivery webhook back to its row.
CREATE INDEX idx_notifications_provider  ON notifications (provider_message_id);

CREATE TRIGGER trg_notifications_updated_at
    BEFORE UPDATE ON notifications
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE ambulance_bookings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               UUID              NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    alert_id              UUID              REFERENCES alerts (id) ON DELETE SET NULL,
    requested_by          UUID              REFERENCES users (id) ON DELETE SET NULL,
    pickup_latitude       NUMERIC(9,6),
    pickup_longitude      NUMERIC(9,6),
    pickup_address        TEXT,
    destination_hospital  VARCHAR(200),
    status                ambulance_status  NOT NULL DEFAULT 'requested',
    provider_name         VARCHAR(100),
    provider_reference    VARCHAR(100),
    driver_name           VARCHAR(120),
    driver_phone          VARCHAR(20),
    vehicle_number        VARCHAR(30),
    eta_minutes           INTEGER,
    notes                 TEXT,
    requested_at          TIMESTAMPTZ       NOT NULL DEFAULT now(),
    dispatched_at         TIMESTAMPTZ,
    completed_at          TIMESTAMPTZ,
    created_at            TIMESTAMPTZ       NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ       NOT NULL DEFAULT now()
);

CREATE INDEX idx_ambulance_user ON ambulance_bookings (user_id, requested_at DESC);

CREATE TRIGGER trg_ambulance_updated_at
    BEFORE UPDATE ON ambulance_bookings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE disaster_alerts (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title              VARCHAR(200)    NOT NULL,
    description        TEXT,
    disaster_type      VARCHAR(50),
    severity           alert_severity  NOT NULL DEFAULT 'medium',
    area_name          VARCHAR(150),
    center_latitude    NUMERIC(9,6),
    center_longitude   NUMERIC(9,6),
    radius_meters      INTEGER,
    source             VARCHAR(100),
    external_id        VARCHAR(120)    UNIQUE,   -- stops the same feed item being ingested twice
    issued_at          TIMESTAMPTZ     NOT NULL,
    expires_at         TIMESTAMPTZ,
    is_active          BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ     NOT NULL DEFAULT now()
);

CREATE INDEX idx_disaster_active ON disaster_alerts (issued_at DESC) WHERE is_active = TRUE;

CREATE TRIGGER trg_disaster_updated_at
    BEFORE UPDATE ON disaster_alerts
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- CAREGIVER MODULE
-- ============================================================================

CREATE TABLE caregivers (
    id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              UUID                 NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
    bio                  TEXT,
    experience_years     SMALLINT             CHECK (experience_years >= 0),
    qualifications       TEXT,
    specializations      TEXT[],
    languages            TEXT[],
    hourly_rate          NUMERIC(10,2),
    currency             CHAR(3)              NOT NULL DEFAULT 'INR',
    service_area_city    VARCHAR(100),
    -- Identity verification: which kind of document was checked and whether
    -- it passed. The number itself is deliberately never stored.
    id_proof_type        VARCHAR(50),
    id_verified          BOOLEAN              NOT NULL DEFAULT FALSE,
    verification_status  verification_status  NOT NULL DEFAULT 'pending',
    verified_at          TIMESTAMPTZ,
    verified_by          UUID                 REFERENCES users (id) ON DELETE SET NULL,
    is_available         BOOLEAN              NOT NULL DEFAULT TRUE,
    average_rating       NUMERIC(3,2)         NOT NULL DEFAULT 0 CHECK (average_rating BETWEEN 0 AND 5),
    total_reviews        INTEGER              NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ          NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ          NOT NULL DEFAULT now()
);

-- Supports the caregiver search screen: verified + available, in my city, best rated first.
CREATE INDEX idx_caregivers_bookable ON caregivers (service_area_city, average_rating DESC)
    WHERE verification_status = 'verified' AND is_available = TRUE;

CREATE TRIGGER trg_caregivers_updated_at
    BEFORE UPDATE ON caregivers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE caregiver_bookings (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    elderly_user_id       UUID            NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    caregiver_id          UUID            NOT NULL REFERENCES caregivers (id) ON DELETE RESTRICT,
    booked_by_user_id     UUID            REFERENCES users (id) ON DELETE SET NULL,
    status                booking_status  NOT NULL DEFAULT 'requested',
    start_date            DATE            NOT NULL,
    end_date              DATE,
    recurrence            VARCHAR(20)     NOT NULL DEFAULT 'one_time',
    hours_per_visit       NUMERIC(4,2),
    agreed_rate           NUMERIC(10,2),
    currency              CHAR(3)         NOT NULL DEFAULT 'INR',
    special_instructions  TEXT,
    cancellation_reason   TEXT,
    cancelled_by          UUID            REFERENCES users (id) ON DELETE SET NULL,
    created_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ     NOT NULL DEFAULT now(),
    CONSTRAINT chk_booking_dates CHECK (end_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_bookings_elderly   ON caregiver_bookings (elderly_user_id, start_date DESC);
CREATE INDEX idx_bookings_caregiver ON caregiver_bookings (caregiver_id, start_date DESC);

CREATE TRIGGER trg_bookings_updated_at
    BEFORE UPDATE ON caregiver_bookings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE schedules (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    booking_id       UUID             NOT NULL REFERENCES caregiver_bookings (id) ON DELETE CASCADE,
    caregiver_id     UUID             NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
    elderly_user_id  UUID             NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    visit_date       DATE             NOT NULL,
    start_time       TIME             NOT NULL,
    end_time         TIME             NOT NULL,
    status           schedule_status  NOT NULL DEFAULT 'scheduled',
    notes            TEXT,
    created_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ      NOT NULL DEFAULT now(),
    CONSTRAINT chk_schedule_times CHECK (end_time > start_time),
    -- Stops the exact same slot being booked twice. Overlapping visits that
    -- start at different times are still possible; the application checks for
    -- those.
    CONSTRAINT uq_caregiver_slot   UNIQUE (caregiver_id, visit_date, start_time)
);

CREATE INDEX idx_schedules_caregiver ON schedules (caregiver_id, visit_date);
CREATE INDEX idx_schedules_elderly   ON schedules (elderly_user_id, visit_date);

CREATE TRIGGER trg_schedules_updated_at
    BEFORE UPDATE ON schedules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE attendance (
    id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id           UUID               NOT NULL UNIQUE REFERENCES schedules (id) ON DELETE CASCADE,
    caregiver_id          UUID               NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
    check_in_at           TIMESTAMPTZ,
    check_in_latitude     NUMERIC(9,6),
    check_in_longitude    NUMERIC(9,6),
    check_out_at          TIMESTAMPTZ,
    check_out_latitude    NUMERIC(9,6),
    check_out_longitude   NUMERIC(9,6),
    duration_minutes      INTEGER,
    status                attendance_status  NOT NULL DEFAULT 'pending',
    verified_by_family    BOOLEAN            NOT NULL DEFAULT FALSE,
    notes                 TEXT,
    created_at            TIMESTAMPTZ        NOT NULL DEFAULT now(),
    updated_at            TIMESTAMPTZ        NOT NULL DEFAULT now(),
    CONSTRAINT chk_attendance_order CHECK (
        check_out_at IS NULL OR check_in_at IS NULL OR check_out_at >= check_in_at
    )
);

CREATE INDEX idx_attendance_caregiver ON attendance (caregiver_id, check_in_at DESC);

CREATE TRIGGER trg_attendance_updated_at
    BEFORE UPDATE ON attendance
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE care_plans (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    elderly_user_id         UUID              NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_by_user_id      UUID              REFERENCES users (id) ON DELETE SET NULL,
    title                   VARCHAR(150)      NOT NULL,
    description             TEXT,
    medical_conditions      TEXT,
    allergies               TEXT,
    medications             TEXT,
    dietary_notes           TEXT,
    mobility_notes          TEXT,
    emergency_instructions  TEXT,
    start_date              DATE,
    end_date                DATE,
    status                  care_plan_status  NOT NULL DEFAULT 'active',
    created_at              TIMESTAMPTZ       NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ       NOT NULL DEFAULT now(),
    CONSTRAINT chk_care_plan_dates CHECK (end_date IS NULL OR start_date IS NULL OR end_date >= start_date)
);

CREATE INDEX idx_care_plans_elderly ON care_plans (elderly_user_id) WHERE status = 'active';

CREATE TRIGGER trg_care_plans_updated_at
    BEFORE UPDATE ON care_plans
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE activity_reports (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    schedule_id        UUID          REFERENCES schedules (id) ON DELETE SET NULL,
    caregiver_id       UUID          NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
    elderly_user_id    UUID          NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    care_plan_id       UUID          REFERENCES care_plans (id) ON DELETE SET NULL,
    report_date        DATE          NOT NULL,
    summary            TEXT          NOT NULL,
    meals_taken        TEXT,
    medications_given  TEXT,
    mood               VARCHAR(50),
    sleep_hours        NUMERIC(3,1),
    vitals             JSONB,
    concerns           TEXT,
    photo_urls         TEXT[],
    created_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT uq_report_per_day UNIQUE (caregiver_id, elderly_user_id, report_date)
);

CREATE INDEX idx_reports_elderly ON activity_reports (elderly_user_id, report_date DESC);

CREATE TRIGGER trg_reports_updated_at
    BEFORE UPDATE ON activity_reports
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE tasks (
    id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    care_plan_id              UUID           REFERENCES care_plans (id) ON DELETE CASCADE,
    elderly_user_id           UUID           NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    assigned_to_caregiver_id  UUID           REFERENCES caregivers (id) ON DELETE SET NULL,
    assigned_by_user_id       UUID           REFERENCES users (id) ON DELETE SET NULL,
    schedule_id               UUID           REFERENCES schedules (id) ON DELETE SET NULL,
    title                     VARCHAR(150)   NOT NULL,
    description               TEXT,
    category                  VARCHAR(50),
    priority                  task_priority  NOT NULL DEFAULT 'normal',
    due_date                  DATE,
    due_time                  TIME,
    recurrence                VARCHAR(20)    NOT NULL DEFAULT 'none',
    status                    task_status    NOT NULL DEFAULT 'pending',
    completed_at              TIMESTAMPTZ,
    completed_by              UUID           REFERENCES users (id) ON DELETE SET NULL,
    completion_notes          TEXT,
    created_at                TIMESTAMPTZ    NOT NULL DEFAULT now(),
    updated_at                TIMESTAMPTZ    NOT NULL DEFAULT now()
);

CREATE INDEX idx_tasks_caregiver ON tasks (assigned_to_caregiver_id, due_date)
    WHERE status IN ('pending', 'in_progress');
CREATE INDEX idx_tasks_elderly   ON tasks (elderly_user_id, due_date DESC);

CREATE TRIGGER trg_tasks_updated_at
    BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();


CREATE TABLE reviews (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    caregiver_id           UUID         NOT NULL REFERENCES caregivers (id) ON DELETE CASCADE,
    booking_id             UUID         REFERENCES caregiver_bookings (id) ON DELETE SET NULL,
    reviewer_user_id       UUID         NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    elderly_user_id        UUID         REFERENCES users (id) ON DELETE SET NULL,
    rating                 SMALLINT     NOT NULL CHECK (rating BETWEEN 1 AND 5),
    punctuality_rating     SMALLINT     CHECK (punctuality_rating BETWEEN 1 AND 5),
    care_quality_rating    SMALLINT     CHECK (care_quality_rating BETWEEN 1 AND 5),
    communication_rating   SMALLINT     CHECK (communication_rating BETWEEN 1 AND 5),
    comment                TEXT,
    is_visible             BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
    CONSTRAINT uq_review_per_booking UNIQUE (booking_id, reviewer_user_id)
);

CREATE INDEX idx_reviews_caregiver ON reviews (caregiver_id, created_at DESC) WHERE is_visible = TRUE;

CREATE TRIGGER trg_reviews_updated_at
    BEFORE UPDATE ON reviews
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Keeps caregivers.average_rating/total_reviews correct under any write to
-- `reviews` — an insert, a rating edit, an is_visible hide, a delete — without
-- the application having to remember to recalculate. See BUILD_LOG.md,
-- "caregivers.average_rating/total_reviews", for why this replaced the
-- application-level recalculation that used to be the only thing doing this.
CREATE OR REPLACE FUNCTION recalc_caregiver_rating()
RETURNS TRIGGER AS $$
DECLARE
    affected_caregiver_id UUID := COALESCE(NEW.caregiver_id, OLD.caregiver_id);
BEGIN
    UPDATE caregivers
       SET average_rating = COALESCE(
             (SELECT ROUND(AVG(rating), 2) FROM reviews WHERE caregiver_id = affected_caregiver_id AND is_visible = TRUE),
             0
           ),
           total_reviews = (SELECT COUNT(*) FROM reviews WHERE caregiver_id = affected_caregiver_id AND is_visible = TRUE)
     WHERE id = affected_caregiver_id;
    RETURN NULL; -- AFTER trigger; return value is ignored
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_reviews_recalc_caregiver_rating
    AFTER INSERT OR UPDATE OR DELETE ON reviews
    FOR EACH ROW EXECUTE FUNCTION recalc_caregiver_rating();

-- ============================================================================
-- End of schema. 21 tables, 17 enum types.
-- ============================================================================
