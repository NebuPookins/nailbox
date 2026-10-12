declare module 'nebulog' {
  interface Logger {
    info(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    debug(message: string, ...args: unknown[]): void;
  }
  export function make(options: { filename: string; level?: string }): Logger;
  const nebulog: { make: typeof make };
  export default nebulog;
}
