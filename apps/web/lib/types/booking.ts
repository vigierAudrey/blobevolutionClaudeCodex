export type AvailabilitySport = 'surf' | 'kitesurf';
export type AvailabilityLevel = 'beginner' | 'intermediate' | 'advanced';
export type AvailabilityStatus = 'OPEN' | 'CLOSED';

export interface BookingAvailability {
  id: string;
  sport: AvailabilitySport;
  levels: AvailabilityLevel[];
  startAt: string;
  endAt: string;
  capacity: number;
  bookedCount: number;
  status: AvailabilityStatus;
  spotName: string | null;
  spotLat?: number | null;
  spotLng?: number | null;
}

export type BookingRequestStatus = 'PENDING' | 'ACCEPTED' | 'REJECTED';

export interface BookingRequestInboxItem {
  id: string;
  status: BookingRequestStatus;
  riderName: string;
  riderEmail: string;
  riderAvatarUrl?: string | null;
  message?: string | null;
  createdAt: string;
  respondedAt?: string | null;
  availability: {
    id: string;
    startAt: string;
    endAt: string;
    spotName: string | null;
    sport: AvailabilitySport;
    levels: AvailabilityLevel[];
    capacity: number;
    bookedCount: number;
    status: AvailabilityStatus;
  };
}

export interface CreateBookingAvailabilityPayload {
  sport: AvailabilitySport;
  levels: AvailabilityLevel[];
  startAt: string;
  endAt: string;
  capacity?: number;
  spotName?: string | null;
  spotLat?: number | null;
  spotLng?: number | null;
  price?: number;
}

export interface RiderBookingRequest {
  id: string;
  status: BookingRequestStatus;
  message?: string | null;
  createdAt: string;
  respondedAt?: string | null;
  availability: {
    id: string;
    sport: AvailabilitySport;
    levels: AvailabilityLevel[];
    spotName: string | null;
    startAt: string;
    endAt: string;
    pro: {
      email: string;
      businessName: string | null;
    };
  };
}
