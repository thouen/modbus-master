import { NextResponse } from 'next/server';
import { modbusManager } from '@/lib/modbus-client';

export async function GET() {
  const status = modbusManager.getStatus();
  return NextResponse.json({ success: true, data: status });
}
