import { redirect } from 'next/navigation';

export default function GDPRExportsRedirectPage() {
  redirect('/admin/gdpr');
}
