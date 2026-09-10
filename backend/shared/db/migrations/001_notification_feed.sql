-- ============================================================================
-- Migration 001: In-app notification feed
-- ============================================================================

CREATE TABLE IF NOT EXISTS notification_feed (
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

CREATE INDEX IF NOT EXISTS idx_feed_recipient ON notification_feed (recipient_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_feed_unread    ON notification_feed (recipient_user_id, created_at DESC)
    WHERE is_read = FALSE;
