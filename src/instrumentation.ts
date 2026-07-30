export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Suppress url.parse() deprecation warning (DEP0169) from Next.js / third-party deps
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalEmit = (process as any).emit;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process as any).emit = function (event: string, ...rest: any[]) {
      if (event === 'warning') {
        const w = rest[0];
        if (w && (w.code === 'DEP0169' || (typeof w.message === 'string' && w.message.includes('url.parse')))) {
          return false;
        }
      }
      return originalEmit.call(process, event, ...rest);
    };
  }
}
