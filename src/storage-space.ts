import fs from "fs-extra";
import path from "path";
import rimraf from "rimraf";

import { logger } from "./logger";
import * as si from "systeminformation";
import publicIp from "public-ip";
import { NetworkInterfaces } from "@noia-network/protocol";
import { Systeminformation } from "systeminformation";

interface StorageStatistics {
    total: number;
    available: number;
    used: number;
    distro?: string;
    arch?: string;
    platform?: string;
    release?: string;
    ipv4?: string;
    ipv6?: string;
    iface?: string;
    ifaceName?: string;
    ip4?: string;
    ip6?: string;
    mac?: string;
    internal?: boolean;
    virtual?: boolean;
    operstate?: string;
    type?: string;
    duplex?: string;
    mtu?: number;
    speed?: number;
    carrier_changes?: number;
    interfacesLength: number;
}

interface SystemInformation extends Systeminformation.OsData {
    distro: string;
}

export class StorageSpace {
    // TODO: investigate how clear is used with dataDir.
    public dataDir: any;
    public metadataPath: string;

    constructor(public storageDir: string, public allocated: number) {
        logger.info(`Storage dir=${storageDir}, allocated=${allocated}.`);
        this.storageDir = path.resolve(storageDir);
        this.metadataPath = path.join(storageDir, "metadata.json");
    }

    public async ensureFilesAndDirectories(): Promise<void> {
        await fs.ensureDir(this.storageDir);
        if (!(await fs.pathExists(this.metadataPath))) {
            await fs.writeJson(this.metadataPath, {});
        }
    }

    public total(): number {
        return this.allocated;
    }

    public async used(): Promise<number> {
        return getSize(this.storageDir);
    }

    // based on https://stackoverflow.com/a/34017887
    public async stats(): Promise<StorageStatistics> {
        const size = await getSize(this.storageDir);
        const used = size - fs.statSync(this.metadataPath).size;
        const leftBytes = this.allocated - used;
        const total = this.allocated;

        const storageStats: StorageStatistics = {
            total,
            available: leftBytes > 0 ? leftBytes : 0,
            used,
            interfacesLength: 0
        };

        const dataInfo = await Promise.all([this.osInfo(), this.externalIpv4(), this.externalIpv6(), this.networkInterfaces()]);

        const systemInfo = dataInfo[0];
        const externalIp4 = dataInfo[1];
        const externalIp6 = dataInfo[2];
        const networkInterfaces = dataInfo[3];

        if (systemInfo != null) {
            storageStats.distro = systemInfo.distro;
            storageStats.arch = systemInfo.arch;
            storageStats.release = systemInfo.release;
            storageStats.platform = systemInfo.platform;
        }
        if (externalIp4 != null) {
            storageStats.ipv4 = externalIp4;
        }
        if (externalIp6 != null) {
            storageStats.ipv6 = externalIp6;
        }
        if (networkInterfaces !== undefined) {
            storageStats.iface = networkInterfaces.iface;
            storageStats.ifaceName = networkInterfaces.ifaceName;
            storageStats.mac = networkInterfaces.mac;
            storageStats.internal = networkInterfaces.internal;
            storageStats.virtual = networkInterfaces.virtual;
            storageStats.operstate = networkInterfaces.operstate;
            storageStats.type = networkInterfaces.type;
            storageStats.duplex = networkInterfaces.duplex;
            storageStats.mtu = networkInterfaces.mtu;
            storageStats.speed = networkInterfaces.speed;
            storageStats.interfacesLength = networkInterfaces.interfacesLength;
        }

        return storageStats;
    }

    public async externalIpv4(): Promise<string | null> {
        try {
            const ipv4 = await publicIp.v4({ timeout: 3000 });
            return ipv4;
        } catch (err) {
            return null;
        }
    }

    public async externalIpv6(): Promise<string | null> {
        try {
            const ipv6 = await publicIp.v6({ timeout: 3000 });
            return ipv6;
        } catch (err) {
            return null;
        }
    }

    public async osInfo(): Promise<SystemInformation | null> {
        try {
            const data = await si.osInfo();
            return data;
        } catch (err) {
            return null;
        }
    }

    public async networkInterfaces(): Promise<NetworkInterfaces | undefined> {
        try {
            const data = await si.networkInterfaces();
            const interfaces = data.find(interf => !interf.virtual && interf.operstate === "up" && !interf.internal);

            if (interfaces == null) {
                return undefined;
            }

            return { interfacesLength: data.length, ...interfaces };
        } catch (err) {
            return undefined;
        }
    }

    public async allNetworkInterfaces(): Promise<Systeminformation.NetworkInterfacesData[]> {
        const data = await si.networkInterfaces();
        return data;
    }

    public clear(): void {
        const dirs = [this.dataDir];
        function clearDir(directory: string): void {
            fs.readdir(directory, (err: Error, files) => {
                if (err) {
                    throw err;
                }
                for (const file of files) {
                    rimraf.sync(path.join(directory, file));
                }
                logger.info(`Removed from ${directory}`, files);
            });
        }
        dirs.forEach(dir => {
            clearDir(path.join(this.storageDir, dir));
        });
    }
}

async function getSize(dirPath: string): Promise<number> {
    return lstatP(dirPath).then(stat => {
        if (stat.isFile()) {
            // if file return size directly
            return stat.size;
        } else {
            return readdirP(dirPath)
                .then(async files => {
                    // getting list of inner files (recursively getting size of each file)
                    const promises = files.map(file => path.join(dirPath, file)).map(getSize);
                    return Promise.all(promises);
                })
                .then(childElementSizes => {
                    // success callback once all the promise are fullfiled i. e size is collected
                    let dirSize = 0;
                    childElementSizes.forEach(size => {
                        // iterate through array and sum things
                        dirSize += size;
                    });
                    return dirSize;
                });
        }
    });
}

async function lstatP(filePath: string): Promise<fs.Stats> {
    return new Promise<fs.Stats>((resolve, reject) => {
        fs.lstat(filePath, (err: Error, stat) => {
            if (err) {
                return reject(err);
            }
            resolve(stat);
        });
    });
}

async function readdirP(dir: string): Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        fs.readdir(dir, (err, stat) => {
            if (err) {
                return reject(err);
            }
            resolve(stat);
        });
    });
}
