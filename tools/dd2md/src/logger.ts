let verboseEnabled = false;

export const logger = {
  setVerbose(v: boolean): void {
    verboseEnabled = v;
  },
  info(msg: string): void {
    console.log(`[dd2md] ${msg}`);
  },
  verbose(msg: string): void {
    if (verboseEnabled) console.log(`[dd2md:verbose] ${msg}`);
  },
  warn(msg: string): void {
    console.warn(`[dd2md:warn] ${msg}`);
  },
  error(msg: string): void {
    console.error(`[dd2md:error] ${msg}`);
  },
};
