import { Router } from 'express';
import { requireAuth, requireRole } from '../../shared/auth/middleware.js';
import { forbidden } from '../../shared/http/errors.js';
import { findActiveLink, hasManageCaregiversPermission } from '../../family/links.js';
import { isAssignedCaregiver } from '../services/authorize.js';
import { createFeedItem } from '../../notifications/feedWriter.js';
import { NOTIFICATION_EVENTS } from '../../notifications/constants.js';
import { query } from '../../shared/db/pool.js';
import {
  validateCreateBooking,
  validateBookingStatusUpdate,
  validateUuid,
} from '../services/validate.js';
import {
  createBooking,
  findBookingById,
  listBookingsForUser,
  updateBookingStatus,
} from '../services/bookings.service.js';

export const bookingsRouter = Router();

async function getCaregiverUserId(caregiverId) {
  const { rows } = await query(`SELECT user_id FROM caregivers WHERE id = $1`, [caregiverId]);
  return rows[0]?.user_id ?? null;
}

// Elderly self, any family member with an active link, or admin — booking a
// caregiver on someone's behalf. Deliberately not can_manage_caregivers:
// there is no in-app payment, a booking only requests the caregiver and
// payment is arranged offline, so it commits no money. Everything else in
// the caregiver module stays behind that flag. Caregiver role is excluded
// already at requireRole below.
async function requireBookingCreatePermission(req, elderlyUserId) {
  if (req.user.id === elderlyUserId || req.user.role === 'admin') return;
  if (await findActiveLink(req.user.id, elderlyUserId)) return;
  throw forbidden('not_permitted', 'You are not permitted to book a caregiver for this account.');
}

// Elderly owner, the one who booked it, the assigned caregiver, a family
// member with hasManageCaregiversPermission, or admin.
async function requireBookingAccess(req, booking) {
  if (req.user.role === 'admin') return;
  if (req.user.id === booking.elderlyUserId || req.user.id === booking.bookedByUserId) return;
  if (req.user.role === 'caregiver' && (await isAssignedCaregiver(req.user.id, booking.caregiverId))) return;
  if (await hasManageCaregiversPermission(req.user.id, booking.elderlyUserId)) return;
  throw forbidden('not_permitted', 'You are not permitted to view this booking.');
}

// Create a booking request (elderly, family, admin)
bookingsRouter.post('/', requireAuth, requireRole('elderly', 'family', 'admin'), async (req, res) => {
  const data = validateCreateBooking(req.body);
  await requireBookingCreatePermission(req, data.elderlyUserId);
  const booking = await createBooking(data, req.user.id);

  getCaregiverUserId(booking.caregiverId)
    .then((caregiverUserId) => {
      const candidates = [caregiverUserId, booking.elderlyUserId, booking.bookedByUserId];
      const recipients = [...new Set(candidates.filter((uId) => uId && uId !== req.user.id))];

      if (recipients.length > 0) {
        createFeedItem({
          recipientUserIds: recipients,
          eventType: NOTIFICATION_EVENTS.BOOKING_CREATED,
          eventId: booking.id,
          title: 'Caregiver Booking Created',
          body: `New caregiver booking created (${booking.status}).`,
          data: { screen: 'BookingDetails', params: { id: booking.id } },
          sendPush: true,
        });
      }
    })
    .catch((err) => console.error('Feed error for booking creation:', err));

  res.status(201).json({ status: 'ok', booking });
});

// List bookings for caller
bookingsRouter.get('/', requireAuth, async (req, res) => {
  const { status } = req.query;
  const bookings = await listBookingsForUser(req.user, { status });
  res.json({ status: 'ok', count: bookings.length, bookings });
});

// Get a specific booking
bookingsRouter.get('/:id', requireAuth, async (req, res) => {
  validateUuid(req.params.id, 'bookingId');
  const booking = await findBookingById(req.params.id);
  await requireBookingAccess(req, booking);
  res.json({ status: 'ok', booking });
});

// Update booking status (accept, reject, cancel, complete)
bookingsRouter.patch('/:id/status', requireAuth, async (req, res) => {
  validateUuid(req.params.id, 'bookingId');
  const { status, cancellationReason } = validateBookingStatusUpdate(req.body);
  const booking = await updateBookingStatus(req.params.id, status, req.user, cancellationReason);

  getCaregiverUserId(booking.caregiverId)
    .then((caregiverUserId) => {
      const candidates = [caregiverUserId, booking.elderlyUserId, booking.bookedByUserId];
      const recipients = [...new Set(candidates.filter((uId) => uId && uId !== req.user.id))];

      if (recipients.length > 0) {
        createFeedItem({
          recipientUserIds: recipients,
          eventType: NOTIFICATION_EVENTS.BOOKING_STATUS_CHANGED,
          eventId: booking.id,
          title: `Caregiver Booking ${status.charAt(0).toUpperCase() + status.slice(1)}`,
          body: `Booking status updated to ${status}.`,
          data: { screen: 'BookingDetails', params: { id: booking.id } },
          sendPush: true,
        });
      }
    })
    .catch((err) => console.error('Feed error for booking status update:', err));

  res.json({ status: 'ok', booking });
});
