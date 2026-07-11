"use client";

export const dynamic = 'force-dynamic';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BackBar } from '@/components/BackBar';
import { apiClient } from '@/lib/apiClient';
import { BlobAlert, BlobAuthLayout, BlobButton, BlobFormCard, BlobInput } from '@/components/blob';

export default function ForgotPasswordPage() {
  const t = useTranslations('auth.forgot');
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState<string>('');

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus('loading');
    setMessage('');
    try {
      await apiClient.requestPasswordReset(email);
      setStatus('done');
      setMessage(t('done'));
    } catch {
      setStatus('error');
      setMessage(t('error'));
    }
  };

  return (
    <BlobAuthLayout
      title={t('title')}
      subtitle={t('subtitle')}
    >
      <BackBar fallbackHref="/login" tone="blobDark" />

      <BlobFormCard>
        <header className="space-y-2">
          <h2 className="text-2xl font-black uppercase tracking-widest">{t('cardTitle')}</h2>
          <p className="text-sm leading-6 text-blob-black/70">{t('cardDesc')}</p>
        </header>
        <form onSubmit={onSubmit} className="space-y-4">
          <BlobInput
            id="email"
            label={t('emailLabel')}
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            placeholder={t('emailPlaceholder')}
          />
          <BlobButton
            type="submit"
            disabled={!email || status === 'loading'}
            loading={status === 'loading'}
            className="w-full"
            size="lg"
          >
            {status === 'loading' ? t('submitting') : t('submit')}
          </BlobButton>
          {message && (
            <BlobAlert variant={status === 'error' ? 'error' : 'success'}>
              {message}
            </BlobAlert>
          )}
        </form>
      </BlobFormCard>
    </BlobAuthLayout>
  );
}
