import { redirect } from 'next/navigation';

export default function AdminConversationHistoryRedirectPage() {
  redirect('/admin/conversations/blocked?tab=history');
}
