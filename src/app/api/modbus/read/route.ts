import { NextRequest, NextResponse } from 'next/server';
import { modbusManager } from '@/lib/modbus-client';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { functionCode, address, quantity } = body;

    if (typeof functionCode !== 'number' || ![1, 2, 3, 4].includes(functionCode)) {
      return NextResponse.json(
        { success: false, error: 'functionCode must be 1, 2, 3, or 4' },
        { status: 400 }
      );
    }
    if (typeof address !== 'number' || address < 0 || address > 65535) {
      return NextResponse.json(
        { success: false, error: 'Valid address (0-65535) is required' },
        { status: 400 }
      );
    }
    if (typeof quantity !== 'number' || quantity < 1 || quantity > 125) {
      return NextResponse.json(
        { success: false, error: 'Valid quantity (1-125) is required' },
        { status: 400 }
      );
    }

    let result: { data: number[] | boolean[]; log: import('@/lib/modbus-client').ModbusLogEntry } | undefined;
    switch (functionCode) {
      case 1:
        result = await modbusManager.readCoils(address, quantity);
        break;
      case 2:
        result = await modbusManager.readDiscreteInputs(address, quantity);
        break;
      case 3:
        result = await modbusManager.readHoldingRegisters(address, quantity);
        break;
      case 4:
        result = await modbusManager.readInputRegisters(address, quantity);
        break;
    }

    if (!result) {
      return NextResponse.json({ success: false, error: 'Unsupported function code' }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      data: {
        functionCode,
        address,
        quantity,
        values: result.data,
        log: result.log,
      },
    });
  } catch (error) {
    const errObj = error as { type?: string; message?: string; success?: boolean; timestamp?: number; id?: string };
    if (errObj.type === 'error') {
      return NextResponse.json({ success: false, error: errObj.message, log: errObj }, { status: 502 });
    }
    const msg = error instanceof Error ? error.message : 'Read operation failed';
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
