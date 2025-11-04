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
    CreditTransaction,
    EmailVerificationToken,
    LastSearch,
    Match,
    MatchDecision,
    Message,
    PasswordResetToken,
    ProAvailability,
    ProOffer,
    ProProfile,
    RefreshToken,
    RiderDiscipline,
    RiderProfile,
    Session,
    User,
    UserWallet,
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
    CreditTransactionType,
    DecisionKind,
    Level,
    MatchStatus,
    MessageType,
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
    CreditTransaction,
    EmailVerificationToken,
    LastSearch,
    Match,
    MatchDecision,
    Message,
    PasswordResetToken,
    ProAvailability,
    ProOffer,
    ProProfile,
    RefreshToken,
    RiderDiscipline,
    RiderProfile,
    Session,
    User,
    UserWallet,
    spatial_ref_sys,
    UserConsent
  };
}
