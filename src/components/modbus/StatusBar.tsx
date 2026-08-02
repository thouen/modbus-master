'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ByteOrder } from '@/types/modbus';

interface StatusBarProps {
  onSettingsChange: (byteOrder: ByteOrder, signed: boolean) => void;
}

export default function StatusBar({ onSettingsChange }: StatusBarProps) {
  const { t, i18n } = useTranslation();
  const [showSettings, setShowSettings] = useState(false);
  const [byteOrder, setByteOrder] = useState<ByteOrder>(() => {
    if (typeof window !== 'undefined') {
      return (localStorage.getItem('modbus-byte-order') as ByteOrder) || 'LE';
    }
    return 'LE';
  });
  const [signed, setSigned] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('modbus-signed');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });

  const toggleLanguage = () => {
    const newLang = i18n.language === 'zh' ? 'en' : 'zh';
    i18n.changeLanguage(newLang);
    localStorage.setItem('modbus-lang', newLang);
  };

  const handleByteOrderChange = (value: ByteOrder) => {
    setByteOrder(value);
    localStorage.setItem('modbus-byte-order', value);
    onSettingsChange(value, signed);
  };

  const handleSignedChange = (value: boolean) => {
    setSigned(value);
    localStorage.setItem('modbus-signed', String(value));
    onSettingsChange(byteOrder, value);
  };

  return (
    <>
      <div className="flex items-center gap-3">
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 rounded hover:bg-accent transition-colors"
          title={t('settings.title')}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
        <button
          onClick={toggleLanguage}
          className="px-2 py-1 text-xs rounded border border-border hover:bg-accent transition-colors"
        >
          {i18n.language === 'zh' ? 'EN' : '中文'}
        </button>
      </div>

      {showSettings && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowSettings(false)}>
          <div className="bg-card border border-border rounded-lg p-6 min-w-[320px]" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-4">{t('settings.title')}</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.byteOrder')}</label>
                <select
                  value={byteOrder}
                  onChange={(e) => handleByteOrderChange(e.target.value as ByteOrder)}
                  className="w-full px-3 py-2 bg-background border border-border rounded text-sm"
                >
                  <option value="ABCD">ABCD (Big Endian)</option>
                  <option value="DCBA">DCBA (Little Endian)</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">{t('settings.signed')}</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="signed"
                      checked={signed}
                      onChange={() => handleSignedChange(true)}
                      className="radio"
                    />
                    <span className="text-sm">S - {t('settings.signedLabel')}</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="signed"
                      checked={!signed}
                      onChange={() => handleSignedChange(false)}
                      className="radio"
                    />
                    <span className="text-sm">U - {t('settings.unsignedLabel')}</span>
                  </label>
                </div>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowSettings(false)}
                className="px-4 py-2 bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              >
                {t('common.close')}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
