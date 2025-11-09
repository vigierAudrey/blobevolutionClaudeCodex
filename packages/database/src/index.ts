export { clientPrisma } from './client';
export { default } from './client';
export {
  Prisma,
  PrismaClient,
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
  Role,
  Sex,
  Sport
} from '@prisma/client';

// Réexporte toutes les définitions de types Prisma pour les consommateurs du package
export type * from '@prisma/client';
