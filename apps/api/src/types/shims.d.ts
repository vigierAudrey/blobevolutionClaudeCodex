declare module '@blobinfini/database' {
  import type {
    PrismaClient,
    AdminProfile,
    AuditLog,
    Booking,
    BookingRequest,
    ContactRequest,
    ContactRequestResponse,
    Conversation,
    ConversationMember,
    AnalyticsDailyAgg,
    AnalyticsEvent,
    EmailVerificationToken,
    LastSearch,
    Match,
    MatchDecision,
    Message,
    PasswordResetToken,
    ProAvailability,
    ProProfile,
    RefreshToken,
    RiderDiscipline,
    RiderProfile,
    Session,
    User,
    spatial_ref_sys,
    UserConsent
  } from '@prisma/client';

  export const clientPrisma: PrismaClient;
  export default clientPrisma;

  export {
    Prisma,
    AvailabilityStatus,
    BookingRequestStatus,
    BookingStatus,
    ContactRequestStatus,
    ContactResponse,
    ConsentLevel,
    ConsentSignal,
    ConversationType,
    DecisionKind,
    Level,
    MatchStatus,
    MessageType,
    AnalyticsActorType,
    AnalyticsEventType,
    Role,
    Sex,
    Sport
  } from '@prisma/client';

  export type {
    PrismaClient,
    AdminProfile,
    AuditLog,
    Booking,
    BookingRequest,
    ContactRequest,
    ContactRequestResponse,
    Conversation,
    ConversationMember,
    AnalyticsDailyAgg,
    AnalyticsEvent,
    EmailVerificationToken,
    LastSearch,
    Match,
    MatchDecision,
    Message,
    PasswordResetToken,
    ProAvailability,
    ProProfile,
    RefreshToken,
    RiderDiscipline,
    RiderProfile,
    Session,
    User,
    spatial_ref_sys,
    UserConsent
  };
}
