import { redirect } from 'next/navigation';

export default function AdminReportHistoryRedirectPage() {
  redirect('/admin/reports?tab=history');
}
