/**
 * Skeleton loading components for better perceived performance
 * Based on modern skeleton patterns with shimmer animation
 */

import { cn } from "../../lib/utils";

// Base skeleton component with shimmer animation
function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-md bg-muted relative overflow-hidden",
        "before:absolute before:inset-0 before:-translate-x-full before:animate-[shimmer_2s_infinite] before:bg-gradient-to-r before:from-transparent before:via-white/60 before:to-transparent",
        className
      )}
      {...props}
    />
  );
}

// Card skeleton for dashboard cards
function CardSkeleton() {
  return (
    <div className="rounded-lg border p-6 space-y-4">
      <div className="flex items-center space-x-2">
        <Skeleton className="h-5 w-5 rounded-full" />
        <Skeleton className="h-4 w-24" />
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
      <Skeleton className="h-9 w-full rounded-md" />
    </div>
  );
}

// Profile card skeleton for matching
function ProfileCardSkeleton() {
  return (
    <div className="rounded-md border p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="space-y-1">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-3 w-36" />
      </div>
      <div className="flex items-center gap-2 mt-3">
        <Skeleton className="h-9 w-20" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-9 w-16" />
          <Skeleton className="h-9 w-20" />
        </div>
      </div>
    </div>
  );
}

// List item skeleton
function ListItemSkeleton() {
  return (
    <div className="flex items-center space-x-4 p-4">
      <Skeleton className="h-12 w-12 rounded-full" />
      <div className="space-y-2 flex-1">
        <Skeleton className="h-4 w-[250px]" />
        <Skeleton className="h-4 w-[200px]" />
      </div>
      <Skeleton className="h-8 w-16 rounded-md" />
    </div>
  );
}

// Table skeleton
function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="w-full">
      {/* Header */}
      <div className="flex items-center space-x-4 p-4 border-b">
        <Skeleton className="h-4 w-[100px]" />
        <Skeleton className="h-4 w-[150px]" />
        <Skeleton className="h-4 w-[120px]" />
        <Skeleton className="h-4 w-[80px]" />
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center space-x-4 p-4 border-b">
          <Skeleton className="h-4 w-[100px]" />
          <Skeleton className="h-4 w-[150px]" />
          <Skeleton className="h-4 w-[120px]" />
          <Skeleton className="h-4 w-[80px]" />
        </div>
      ))}
    </div>
  );
}

// Chart/analytics skeleton
function ChartSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-end space-x-2">
            <Skeleton className={`w-8 h-${12 + (i * 4)} bg-muted`} />
            <Skeleton className={`w-8 h-${8 + (i * 2)} bg-muted`} />
            <Skeleton className={`w-8 h-${16 + (i * 3)} bg-muted`} />
            <Skeleton className={`w-8 h-${10 + (i * 5)} bg-muted`} />
          </div>
        ))}
      </div>
    </div>
  );
}

// Map skeleton
function MapSkeleton() {
  return (
    <div className="relative w-full h-[50vh] bg-muted rounded-md overflow-hidden">
      {/* Map base */}
      <div className="absolute inset-0 bg-gradient-to-br from-slate-100 to-slate-200" />

      {/* Fake markers */}
      <div className="absolute top-1/4 left-1/3">
        <Skeleton className="h-6 w-6 rounded-full bg-blue-300" />
      </div>
      <div className="absolute top-1/2 right-1/4">
        <Skeleton className="h-6 w-6 rounded-full bg-green-300" />
      </div>
      <div className="absolute bottom-1/3 left-1/2">
        <Skeleton className="h-6 w-6 rounded-full bg-orange-300" />
      </div>

      {/* Controls */}
      <div className="absolute top-4 right-4 space-y-2">
        <Skeleton className="h-8 w-8 rounded" />
        <Skeleton className="h-8 w-8 rounded" />
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 bg-white/90 p-3 rounded space-y-2">
        <Skeleton className="h-3 w-20" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-3 rounded-full" />
          <Skeleton className="h-3 w-16" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-3 w-3 rounded-full" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>

      {/* Shimmer overlay */}
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_2s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
    </div>
  );
}

// Message conversation skeleton
function MessageSkeleton() {
  return (
    <div className="space-y-4 p-4">
      {/* Received message */}
      <div className="flex gap-3">
        <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-10 w-48 rounded-2xl" />
          <Skeleton className="h-3 w-16" />
        </div>
      </div>

      {/* Sent message */}
      <div className="flex gap-3 justify-end">
        <div className="space-y-2 flex-1 flex flex-col items-end">
          <Skeleton className="h-8 w-32 rounded-2xl bg-primary/20" />
          <Skeleton className="h-3 w-12" />
        </div>
      </div>

      {/* Received message */}
      <div className="flex gap-3">
        <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
        <div className="space-y-2 flex-1">
          <Skeleton className="h-16 w-64 rounded-2xl" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    </div>
  );
}

// Form skeleton
function FormSkeleton() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-20 w-full rounded-md" />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-10 w-full rounded-md" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-10 w-20 rounded-md" />
        <Skeleton className="h-10 w-24 rounded-md" />
      </div>
    </div>
  );
}

// Page header skeleton
function PageHeaderSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-32" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-20 rounded-md" />
          <Skeleton className="h-9 w-24 rounded-md" />
        </div>
      </div>
    </div>
  );
}

export {
  Skeleton,
  CardSkeleton,
  ProfileCardSkeleton,
  ListItemSkeleton,
  TableSkeleton,
  ChartSkeleton,
  MapSkeleton,
  MessageSkeleton,
  FormSkeleton,
  PageHeaderSkeleton,
};