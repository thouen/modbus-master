import { NextResponse } from 'next/server';
import { modbusManager } from '@/lib/modbus-client';

export async function POST() {
  const log = await modbusManager.disconnect();
  return NextResponse.json({ success: true, data: log });
}
