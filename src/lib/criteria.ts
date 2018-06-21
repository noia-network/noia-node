import dns from "dns";

import logger from "./logger";

export function geodns(hostname: string, ip: string): Promise<boolean> {
    return new Promise((resolve, reject) => {
        dns.lookup(hostname, (err: NodeJS.ErrnoException, address: string, family: number) => {
            if (err) {
                logger.warn("Could not resolve geodns criteria check", { code: err.code });
                resolve(false);
            }
            resolve(ip === address);
        });
    });
}
