'use client';

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface WritePanelProps {
  connected: boolean;
  onWrite: (functionCode: number, address: number, values: number[] | boolean[]) => Promise<boolean>;
}

const WRITE_FUNCTION_CODES = [
  { value: '5', label: 'FC05 - Write Single Coil' },
  { value: '6', label: 'FC06 - Write Single Register' },
  { value: '15', label: 'FC15 - Write Multiple Coils' },
  { value: '16', label: 'FC16 - Write Multiple Registers' },
];

export function WritePanel({ connected, onWrite }: WritePanelProps) {
  const { t } = useTranslation();
  const [functionCode, setFunctionCode] = useState('6');
  const [address, setAddress] = useState('0');
  const [value, setValue] = useState('0');
  const [multiValues, setMultiValues] = useState('');
  const [writing, setWriting] = useState(false);

  const isCoil = functionCode === '5' || functionCode === '15';
  const isMultiple = functionCode === '15' || functionCode === '16';

  const handleWrite = async () => {
    setWriting(true);
    try {
      const fc = parseInt(functionCode, 10);
      const addr = parseInt(address, 10);

      let values: number[] | boolean[];
      if (isMultiple) {
        if (isCoil) {
          values = multiValues.split(',').map((v) => v.trim().toLowerCase() === 'true' || v.trim() === '1');
        } else {
          values = multiValues.split(',')
            .map((v) => v.trim())
            .filter((v) => v !== '')
            .map((v) => parseInt(v, 10))
            .filter((v) => !isNaN(v));
        }
      } else {
        if (isCoil) {
          values = [value.toLowerCase() === 'true' || value === '1'];
        } else {
          values = [parseInt(value, 10)];
        }
      }

      await onWrite(fc, addr, values);
    } finally {
      setWriting(false);
    }
  };

  return (
    <div className="industrial-panel p-4">
      <div className="flex items-center gap-2 mb-4">
        <svg className="w-4 h-4 text-amber-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
          <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
        </svg>
        <h2 className="industrial-header">{t('write.title')}</h2>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm font-mono font-medium text-foreground/70 w-28 block">{t('write.functionCode') || 'Function Code'}</label>
          <Select value={functionCode} onValueChange={setFunctionCode} disabled={!connected}>
            <SelectTrigger className="font-mono text-sm bg-secondary/50 border-border flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WRITE_FUNCTION_CODES.map((fc) => (
                <SelectItem key={fc.value} value={fc.value} className="font-mono text-sm">
                  {fc.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-5">
          <div className="flex items-center gap-3">
            <label className="text-sm font-mono font-medium text-foreground/70 w-28 block">{t('write.address')}</label>
            <Input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="0"
              disabled={!connected}
              className="font-mono bg-secondary/50 border-border text-base flex-1"
              type="number"
              min="0"
              max="65535"
            />
          </div>

          {isMultiple ? (
            <div className="flex items-center gap-3">
              <label className="text-sm font-mono font-medium text-foreground/70 w-20 block">
                {t('write.value')}s
              </label>
              <Input
                value={multiValues}
                onChange={(e) => setMultiValues(e.target.value)}
                placeholder={isCoil ? 'comma-separated: true,false,1,0' : 'comma-separated: 0-65535'}
                disabled={!connected}
                className="font-mono bg-secondary/50 border-border text-base flex-1"
              />
            </div>
          ) : isCoil ? (
            <div className="flex items-center gap-3">
              <label className="text-sm font-mono font-medium text-foreground/70 w-20 block">{t('write.value')}</label>
              <Select value={value} onValueChange={setValue} disabled={!connected}>
                <SelectTrigger className="font-mono text-sm bg-secondary/50 border-border flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="true">TRUE (ON)</SelectItem>
                  <SelectItem value="false">FALSE (OFF)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <label className="text-sm font-mono font-medium text-foreground/70 w-20 block">{t('write.value')}</label>
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="0-65535"
                disabled={!connected}
                className="font-mono bg-secondary/50 border-border text-base flex-1"
                type="number"
                min="0"
                max="65535"
              />
            </div>
          )}
        </div>

        <Button
          onClick={handleWrite}
          disabled={!connected || writing}
          className="w-full font-mono text-sm font-medium uppercase tracking-wider bg-amber-600 hover:bg-amber-700 text-white"
        >
          {writing ? (
            <svg className="w-4 h-4 mr-2 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 12a9 9 0 11-6.219-8.56" />
            </svg>
          ) : (
            <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
          )}
          {t('write.write')}
        </Button>
      </div>
    </div>
  );
}
