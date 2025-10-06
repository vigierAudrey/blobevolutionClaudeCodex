/**
 * Skeleton showcase component for development and design system
 * Shows all available skeleton components
 */

import {
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
} from './skeleton';

export default function SkeletonShowcase() {
  return (
    <div className="p-8 space-y-8 max-w-4xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold mb-2">Skeleton Components Showcase</h1>
        <p className="text-muted-foreground">
          Preview of all available skeleton loading components with shimmer animations
        </p>
      </div>

      <div className="grid gap-8">
        {/* Basic Skeleton */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Basic Skeleton</h2>
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        </section>

        {/* Page Header */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Page Header</h2>
          <PageHeaderSkeleton />
        </section>

        {/* Cards */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Dashboard Cards</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <CardSkeleton />
            <CardSkeleton />
            <CardSkeleton />
          </div>
        </section>

        {/* Profile Card */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Profile Card (Matching)</h2>
          <div className="max-w-md">
            <ProfileCardSkeleton />
          </div>
        </section>

        {/* List Items */}
        <section>
          <h2 className="text-xl font-semibold mb-4">List Items</h2>
          <div className="border rounded-lg divide-y">
            <ListItemSkeleton />
            <ListItemSkeleton />
            <ListItemSkeleton />
          </div>
        </section>

        {/* Table */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Table</h2>
          <div className="border rounded-lg">
            <TableSkeleton rows={4} />
          </div>
        </section>

        {/* Chart */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Chart/Analytics</h2>
          <div className="border rounded-lg p-4">
            <ChartSkeleton />
          </div>
        </section>

        {/* Map */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Interactive Map</h2>
          <MapSkeleton />
        </section>

        {/* Messages */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Message Conversation</h2>
          <div className="border rounded-lg">
            <MessageSkeleton />
          </div>
        </section>

        {/* Form */}
        <section>
          <h2 className="text-xl font-semibold mb-4">Form</h2>
          <div className="max-w-md border rounded-lg p-4">
            <FormSkeleton />
          </div>
        </section>
      </div>

      {/* Performance Tips */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
        <h3 className="font-semibold text-blue-900 mb-2">💡 Performance Tips</h3>
        <ul className="text-sm text-blue-800 space-y-1">
          <li>• Skeletons prevent layout shift and improve perceived performance</li>
          <li>• Use minimum display times to avoid flicker on fast responses</li>
          <li>• Grace periods prevent skeleton flash for instant cache hits</li>
          <li>• Shimmer animations make loading feel more responsive</li>
          <li>• Match skeleton structure to actual content for smooth transitions</li>
        </ul>
      </div>

      {/* Usage Examples */}
      <div className="bg-green-50 border border-green-200 rounded-lg p-6">
        <h3 className="font-semibold text-green-900 mb-2">🚀 Usage Examples</h3>
        <div className="text-sm text-green-800 space-y-2">
          <p><strong>Matching Cards:</strong> ProfileCardSkeleton for user profiles</p>
          <p><strong>Dashboards:</strong> CardSkeleton for dashboard widgets</p>
          <p><strong>Lists:</strong> ListItemSkeleton for request/booking lists</p>
          <p><strong>Maps:</strong> MapSkeleton with fake markers and controls</p>
          <p><strong>Tables:</strong> TableSkeleton for admin panels</p>
        </div>
      </div>
    </div>
  );
}