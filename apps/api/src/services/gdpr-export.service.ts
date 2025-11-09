import { clientPrisma as prisma, Prisma } from '@blobinfini/database';
import { secureLogger } from '../utils/secure-logger';
import * as crypto from 'crypto';

/**
 * GDPR Data Export Service
 * Implements Article 20 of GDPR - Right to data portability
 *
 * Security considerations:
 * - Only exports data for authenticated user (no userId parameter to prevent IDOR)
 * - Sanitizes sensitive data (passwords, tokens)
 * - Logs all export requests for audit trail
 * - Rate-limited at controller level (3/hour)
 * - Query limits to prevent DoS (10k messages, 5k transactions, etc.)
 * - Pseudonymizes emails of other users (GDPR Article 5.1.c - Data minimization)
 */

/**
 * Pseudonymize an email address using SHA-256 hash
 * Returns a short, non-reversible hash for privacy protection
 *
 * @param email - Email to pseudonymize
 * @returns 8-character hash (e.g., "a3f5d9e2")
 */
function pseudonymizeEmail(email: string): string {
  return crypto
    .createHash('sha256')
    .update(email.toLowerCase().trim())
    .digest('hex')
    .substring(0, 8);
}

function pseudonymizeIdentifier(identifier: string): string {
  return crypto
    .createHash('sha256')
    .update(`id:${identifier}`)
    .digest('hex')
    .substring(0, 8);
}

// Export limits for DoS protection
const EXPORT_LIMITS = {
  CONVERSATIONS: 1000,
  MESSAGES: 10000,
  TRANSACTIONS: 5000,
  MATCHES: 1000,
  BOOKINGS: 1000,
  BOOKING_REQUESTS: 1000,
  PRO_AVAILABILITIES: 1000,
  PRO_OFFERS: 1000,
  CONTACT_REQUESTS: 1000,
  AUDIT_LOGS: 100,
} as const;

interface ExportedData {
  exportDate: string;
  userId: string;
  user: {
    email: string;
    role: string;
    emailVerified: boolean;
    twoFactorEnabled: boolean;
    consentedAt: string | null;
    consentVersion: string | null;
    createdAt: string;
    updatedAt: string;
  };
  profile?: RiderProfileExport | ProProfileExport | AdminProfileExport;
  disciplines?: Array<{ sport: string; level: string }>;
  lastSearch?: {
    sport: string;
    level: string;
    distanceKm: number | null;
    date: string | null;
  };
  matches?: Array<{
    matchId: string;
    otherUserEmailHash: string; // Pseudonymized for privacy (GDPR Art. 5.1.c)
    status: string;
    createdAt: string;
    lastActivityAt: string;
  }>;
  conversations?: Array<{
    conversationId: string;
    type: string;
    createdAt: string;
    messageCount: number;
    lastReadAt: string | null;
  }>;
  messages?: Array<{
    conversationId: string;
    type: string;
    content: string;
    createdAt: string;
    isSentByMe: boolean;
  }>;
  bookingRequests?: Array<{
    availabilityId: string;
    message: string | null;
    status: string;
    createdAt: string;
  }>;
  bookings?: Array<{
    availabilityId: string;
    status: string;
    createdAt: string;
  }>;
  proAvailabilities?: Array<{
    sport: string;
    levels: string[];
    startAt: string;
    endAt: string;
    capacity: number;
    bookedCount: number;
    status: string;
    price: string | null;
  }>;
  proOffers?: Array<{
    sport: string;
    level: string;
    title: string;
    description: string;
    hourlyRate: string;
    isActive: boolean;
    createdAt: string;
  }>;
  contactRequests?: Array<{
    conversationId: string;
    message: string | null;
    status: string;
    createdAt: string;
  }>;
  auditLogs?: Array<{
    action: string;
    resource: string;
    createdAt: string;
  }>;
}

interface RiderProfileExport {
  displayName: string | null;
  bio: string | null;
  sex: string;
  maxDistanceKm: number;
  emailNotif: boolean;
  photoUrl: string | null;
  lat: number | null;
  lng: number | null;
  wantsLesson: boolean;
  lessonSport: string | null;
  lessonLevel: string | null;
  lessonDate: string | null;
  lessonPlace: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ProProfileExport {
  businessName: string | null;
  bio: string | null;
  pricePerHour: number | null;
  emailNotif: boolean;
  photoUrl: string | null;
  lat: number | null;
  lng: number | null;
  verified: boolean;
  createdAt: string;
  updatedAt: string;
}

interface AdminProfileExport {
  displayName: string | null;
  permissions: string[];
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

type BookingRequestSummary = Prisma.BookingRequestGetPayload<{
  select: { availabilityId: true; message: true; status: true; createdAt: true };
}>;
type BookingSummary = Prisma.BookingGetPayload<{
  select: { availabilityId: true; status: true; createdAt: true };
}>;
type ProOfferSummary = Prisma.ProOffer;
type ProAvailabilitySummary = Prisma.ProAvailability;
type ContactRequestSummary = Prisma.ContactRequestGetPayload<{
  select: { conversationId: true; message: true; status: true; createdAt: true };
}>;
type MatchWithUsers = Prisma.MatchGetPayload<{
  include: {
    userOne: { select: { email: true } };
    userTwo: { select: { email: true } };
  };
}>;
type ConversationMemberSummary = Prisma.ConversationMemberGetPayload<{
  include: {
    conversation: {
      select: {
        id: true;
        type: true;
        createdAt: true;
        _count: { select: { messages: true } };
      };
    };
  };
}>;
type MessageSummary = Prisma.MessageGetPayload<{
  select: { conversationId: true; senderId: true; type: true; content: true; createdAt: true };
}>;
type AuditLogSummary = Prisma.AuditLogGetPayload<{
  select: { action: true; resource: true; createdAt: true };
}>;

export class GdprExportService {
  /**
   * Export all user data in JSON format (GDPR Article 20)
   * @param userId - Authenticated user ID (from JWT token)
   * @param ipAddress - Request IP for audit logging
   */
  async exportUserData(userId: string, ipAddress?: string): Promise<ExportedData> {
    try {
      // Log export request for audit trail
      secureLogger.info('GDPR_EXPORT_REQUESTED', { userId, ip: ipAddress });

      // Fetch user data
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          role: true,
          emailVerified: true,
          twoFactorEnabled: true,
          consentedAt: true,
          consentVersion: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        secureLogger.warn('GDPR_EXPORT_USER_NOT_FOUND', { userId });
        throw new Error('User not found');
      }

      const exportData: ExportedData = {
        exportDate: new Date().toISOString(),
        userId: user.id,
        user: {
          email: user.email,
          role: user.role,
          emailVerified: user.emailVerified,
          twoFactorEnabled: user.twoFactorEnabled,
          consentedAt: user.consentedAt?.toISOString() ?? null,
          consentVersion: user.consentVersion,
          createdAt: user.createdAt.toISOString(),
          updatedAt: user.updatedAt.toISOString(),
        },
      };

      // Export profile based on role
      if (user.role === 'RIDER') {
        await this.addRiderData(userId, exportData);
      } else if (user.role === 'PRO') {
        await this.addProData(userId, exportData);
      } else if (user.role === 'ADMIN') {
        await this.addAdminData(userId, exportData);
      }

      // Export common data (conversations, messages, bookings, etc.)
      await this.addCommonData(userId, exportData);

      // Log successful export
      secureLogger.info('GDPR_EXPORT_SUCCESS', {
        userId,
        dataSize: JSON.stringify(exportData).length,
        ip: ipAddress
      });

      return exportData;
    } catch (error) {
      secureLogger.error('GDPR_EXPORT_ERROR', { userId, error: String(error) });
      throw error;
    }
  }

  private async addRiderData(userId: string, exportData: ExportedData): Promise<void> {
    // Rider profile
    const riderProfile = await prisma.riderProfile.findUnique({
      where: { userId },
    });

    if (riderProfile) {
      exportData.profile = {
        displayName: riderProfile.displayName,
        bio: riderProfile.bio,
        sex: riderProfile.sex,
        maxDistanceKm: riderProfile.maxDistanceKm,
        emailNotif: riderProfile.emailNotif,
        photoUrl: riderProfile.photoUrl,
        lat: riderProfile.lat,
        lng: riderProfile.lng,
        wantsLesson: riderProfile.wantsLesson,
        lessonSport: riderProfile.lessonSport,
        lessonLevel: riderProfile.lessonLevel,
        lessonDate: riderProfile.lessonDate?.toISOString() ?? null,
        lessonPlace: riderProfile.lessonPlace,
        createdAt: riderProfile.createdAt.toISOString(),
        updatedAt: riderProfile.updatedAt.toISOString(),
      };

      // Disciplines
      const disciplines = await prisma.riderDiscipline.findMany({
        where: { profileId: riderProfile.id },
        select: { sport: true, level: true },
      });
      exportData.disciplines = disciplines;
    }

    // Last search
    const lastSearch = await prisma.lastSearch.findUnique({
      where: { userId },
    });

    if (lastSearch) {
      exportData.lastSearch = {
        sport: lastSearch.sport,
        level: lastSearch.level,
        distanceKm: lastSearch.distanceKm,
        date: lastSearch.date?.toISOString() ?? null,
      };
    }

    // Booking requests (as rider)
    const bookingRequests = await prisma.bookingRequest.findMany({
      where: { riderUserId: userId },
      select: {
        availabilityId: true,
        message: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMITS.BOOKING_REQUESTS,
    });

    if (bookingRequests.length > 0) {
      exportData.bookingRequests = bookingRequests.map((req: BookingRequestSummary) => ({
        availabilityId: req.availabilityId,
        message: req.message,
        status: req.status,
        createdAt: req.createdAt.toISOString(),
      }));
    }

    // Bookings (as rider)
    const bookings = await prisma.booking.findMany({
      where: { riderUserId: userId },
      select: {
        availabilityId: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMITS.BOOKINGS,
    });

    if (bookings.length > 0) {
      exportData.bookings = bookings.map((booking: BookingSummary) => ({
        availabilityId: booking.availabilityId,
        status: booking.status,
        createdAt: booking.createdAt.toISOString(),
      }));
    }
  }

  private async addProData(userId: string, exportData: ExportedData): Promise<void> {
    // Pro profile
    const proProfile = await prisma.proProfile.findUnique({
      where: { userId },
    });

    if (proProfile) {
      exportData.profile = {
        businessName: proProfile.businessName,
        bio: proProfile.bio,
        pricePerHour: proProfile.pricePerHour,
        emailNotif: proProfile.emailNotif,
        photoUrl: proProfile.photoUrl,
        lat: proProfile.lat,
        lng: proProfile.lng,
        verified: proProfile.verified,
        createdAt: proProfile.createdAt.toISOString(),
        updatedAt: proProfile.updatedAt.toISOString(),
      };

      // Pro offers
      const offers = await prisma.proOffer.findMany({
        where: { proProfileId: proProfile.id },
        orderBy: { createdAt: 'desc' },
        take: EXPORT_LIMITS.PRO_OFFERS,
      });

      if (offers.length > 0) {
        exportData.proOffers = offers.map((offer: ProOfferSummary) => ({
          sport: offer.sport,
          level: offer.level,
          title: offer.title,
          description: offer.description,
          hourlyRate: offer.hourlyRate.toString(),
          isActive: offer.isActive,
          createdAt: offer.createdAt.toISOString(),
        }));
      }
    }

    // Pro availabilities
    const availabilities = await prisma.proAvailability.findMany({
      where: { proUserId: userId },
      orderBy: { startAt: 'desc' },
      take: EXPORT_LIMITS.PRO_AVAILABILITIES,
    });

    if (availabilities.length > 0) {
      exportData.proAvailabilities = availabilities.map((avail: ProAvailabilitySummary) => ({
        sport: avail.sport,
        levels: avail.levels,
        startAt: avail.startAt.toISOString(),
        endAt: avail.endAt.toISOString(),
        capacity: avail.capacity,
        bookedCount: avail.bookedCount,
        status: avail.status,
        price: avail.price?.toString() ?? null,
      }));
    }

    // Contact requests (as pro)
    const contactRequests = await prisma.contactRequest.findMany({
      where: { proUserId: userId },
      select: {
        conversationId: true,
        message: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMITS.CONTACT_REQUESTS,
    });

    if (contactRequests.length > 0) {
      exportData.contactRequests = contactRequests.map((req: ContactRequestSummary) => ({
        conversationId: req.conversationId,
        message: req.message,
        status: req.status,
        createdAt: req.createdAt.toISOString(),
      }));
    }
  }

  private async addAdminData(userId: string, exportData: ExportedData): Promise<void> {
    const adminProfile = await prisma.adminProfile.findUnique({
      where: { userId },
    });

    if (adminProfile) {
      exportData.profile = {
        displayName: adminProfile.displayName,
        permissions: adminProfile.permissions,
        lastLoginAt: adminProfile.lastLoginAt?.toISOString() ?? null,
        createdAt: adminProfile.createdAt.toISOString(),
        updatedAt: adminProfile.updatedAt.toISOString(),
      };
    }
  }

  private async addCommonData(userId: string, exportData: ExportedData): Promise<void> {
    // Matches
    const matches = await prisma.match.findMany({
      where: {
        OR: [{ userOneId: userId }, { userTwoId: userId }],
      },
      include: {
        userOne: { select: { email: true } },
        userTwo: { select: { email: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMITS.MATCHES,
    });

    if (matches.length > 0) {
      exportData.matches = matches.map((match: MatchWithUsers) => {
        const isUserOne = match.userOneId === userId;
        const otherUserEmail = isUserOne ? match.userTwo?.email : match.userOne?.email;
        const otherUserId = isUserOne ? match.userTwoId : match.userOneId;

        let otherUserEmailHash: string;
        if (otherUserEmail) {
          otherUserEmailHash = pseudonymizeEmail(otherUserEmail);
        } else {
          secureLogger.warn('GDPR_EXPORT_MISSING_MATCH_EMAIL', {
            userId,
            matchId: match.id,
            otherUserId,
          });
          otherUserEmailHash = pseudonymizeIdentifier(otherUserId);
        }

        return {
          matchId: match.id,
          // Pseudonymize other user's email for privacy (GDPR Art. 5.1.c - Data minimization)
          // User doesn't need full email, only a unique identifier
          otherUserEmailHash,
          status: match.status,
          createdAt: match.createdAt.toISOString(),
          lastActivityAt: match.lastActivityAt.toISOString(),
        };
      });
    }

    // Conversations
    const conversationMembers = await prisma.conversationMember.findMany({
      where: { userId },
      include: {
        conversation: {
          select: {
            id: true,
            type: true,
            createdAt: true,
            _count: {
              select: { messages: true }, // Use COUNT(*) instead of loading all IDs
            },
          },
        },
      },
      orderBy: { conversation: { createdAt: 'desc' } },
      take: EXPORT_LIMITS.CONVERSATIONS, // P1: Limit to 1000 most recent conversations
    });

    if (conversationMembers.length > 0) {
      exportData.conversations = conversationMembers.map((member: ConversationMemberSummary) => ({
        conversationId: member.conversationId,
        type: member.conversation.type,
        createdAt: member.conversation.createdAt.toISOString(),
        messageCount: member.conversation._count.messages, // Use SQL COUNT from _count
        lastReadAt: member.lastReadAt?.toISOString() ?? null,
      }));
    }

    // Messages (ALL messages from user's conversations - sent AND received)
    // GDPR Article 20 requires complete export of personal data
    const userConversationIds = conversationMembers.map((m: ConversationMemberSummary) => m.conversationId);

    // Log metrics for monitoring and abuse detection
    secureLogger.info('GDPR_EXPORT_CONVERSATIONS', {
      userId,
      conversationCount: conversationMembers.length,
      isLimitReached: conversationMembers.length === EXPORT_LIMITS.CONVERSATIONS,
    });

    if (userConversationIds.length > 500) {
      secureLogger.warn('GDPR_EXPORT_HIGH_CONVERSATION_COUNT', {
        userId,
        count: userConversationIds.length,
      });
    }

    const messages = await prisma.message.findMany({
      where: {
        conversationId: { in: userConversationIds }
      },
      select: {
        conversationId: true,
        senderId: true,
        type: true,
        content: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: EXPORT_LIMITS.MESSAGES, // P1 DoS protection: limit to 10k most recent messages
    });

    // Log message export metrics
    secureLogger.info('GDPR_EXPORT_MESSAGES', {
      userId,
      messageCount: messages.length,
      isLimitReached: messages.length === EXPORT_LIMITS.MESSAGES,
    });

    if (messages.length > 0) {
      exportData.messages = messages.map((msg: MessageSummary) => {
        const isSentByMe = msg.senderId === userId;

        return {
          conversationId: msg.conversationId,
          type: msg.type,
          // RGPD Article 20: Only export full content of messages sent BY the user
          // Received messages are other users' personal data, not subject to portability
          content: isSentByMe
            ? msg.content
            : '[Message from other participant - content not included per GDPR Article 20]',
          createdAt: msg.createdAt.toISOString(),
          isSentByMe,
        };
      });
    }

    // Audit logs (last 100 entries for performance)
    const auditLogs = await prisma.auditLog.findMany({
      where: { userId },
      select: {
        action: true,
        resource: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    if (auditLogs.length > 0) {
      exportData.auditLogs = auditLogs.map((log: AuditLogSummary) => ({
        action: log.action,
        resource: log.resource,
        createdAt: log.createdAt.toISOString(),
      }));
    }
  }
}

export const gdprExportService = new GdprExportService();
