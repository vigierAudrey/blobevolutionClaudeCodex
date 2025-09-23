/**
 * Push Notification Permission Prompt Component
 * Shows a beautiful, non-intrusive prompt for enabling push notifications
 */

'use client';

import { useState, useEffect } from 'react';
import { usePushPermissionPrompt } from '../hooks/usePushNotifications';

export default function PushNotificationPrompt() {
  const { isVisible, handleAccept, handleDismiss } = usePushPermissionPrompt();
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    if (isVisible) {
      // Add entrance animation delay
      const timer = setTimeout(() => setIsAnimating(true), 100);
      return () => clearTimeout(timer);
    } else {
      setIsAnimating(false);
    }
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div className={`fixed bottom-4 left-4 right-4 md:left-auto md:max-w-md z-50 transition-all duration-500 ease-in-out ${
      isAnimating ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0'
    }`}>
      <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <span className="text-lg">🔔</span>
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-gray-900">
              Activer les notifications ?
            </h3>
            <p className="text-xs text-gray-600 mt-1">
              Reçois des alertes pour tes cours et messages importants
            </p>
          </div>
          <button
            onClick={handleDismiss}
            className="flex-shrink-0 text-gray-400 hover:text-gray-600 transition-colors"
            aria-label="Fermer"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Benefits */}
        <div className="space-y-1">
          <div className="flex items-center text-xs text-gray-600">
            <span className="mr-2">🏄</span>
            <span>Confirmations de cours</span>
          </div>
          <div className="flex items-center text-xs text-gray-600">
            <span className="mr-2">💬</span>
            <span>Nouveaux messages</span>
          </div>
          <div className="flex items-center text-xs text-gray-600">
            <span className="mr-2">⏰</span>
            <span>Rappels avant les cours</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex space-x-2 pt-2">
          <button
            onClick={handleDismiss}
            className="flex-1 px-3 py-2 text-xs text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50 transition-colors"
          >
            Pas maintenant
          </button>
          <button
            onClick={handleAccept}
            className="flex-1 px-3 py-2 text-xs bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
          >
            Activer
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact notification prompt for specific actions
 */
export function CompactPushPrompt({
  message,
  onAccept,
  onDismiss,
  className = ""
}: {
  message: string;
  onAccept: () => void;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div className={`bg-blue-50 border border-blue-200 rounded-lg p-3 ${className}`}>
      <div className="flex items-center space-x-2">
        <span className="text-blue-600">🔔</span>
        <p className="text-sm text-blue-800 flex-1">{message}</p>
        <button
          onClick={onAccept}
          className="text-xs bg-blue-600 text-white px-3 py-1 rounded-md hover:bg-blue-700 transition-colors"
        >
          Activer
        </button>
        <button
          onClick={onDismiss}
          className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
        >
          ✕
        </button>
      </div>
    </div>
  );
}

/**
 * Settings toggle for push notifications
 */
export function PushNotificationToggle() {
  const [isEnabled, setIsEnabled] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // You would connect this to your push notification hook
  // const { isSubscribed, subscribe, unsubscribe } = usePushNotifications();

  const handleToggle = async () => {
    setIsLoading(true);
    try {
      if (isEnabled) {
        // await unsubscribe();
        setIsEnabled(false);
      } else {
        // await subscribe();
        setIsEnabled(true);
      }
    } catch (error) {
      console.error('Error toggling notifications:', error);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between p-4 border border-gray-200 rounded-lg">
      <div className="flex items-start space-x-3">
        <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
          <span className="text-sm">🔔</span>
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900">
            Notifications push
          </h3>
          <p className="text-xs text-gray-600">
            Reçois des alertes pour tes cours et messages
          </p>
        </div>
      </div>
      <button
        onClick={handleToggle}
        disabled={isLoading}
        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
          isEnabled ? 'bg-blue-600' : 'bg-gray-200'
        } ${isLoading ? 'opacity-50' : ''}`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
            isEnabled ? 'translate-x-6' : 'translate-x-1'
          }`}
        />
      </button>
    </div>
  );
}