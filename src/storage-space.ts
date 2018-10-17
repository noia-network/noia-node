import fs, { PathLike } from "fs";
import path from "path";
import rimraf from "rimraf";

import { logger } from "./logger";

interface StorageStatistics {
    total: number;
    available: number;
    used: number;
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

    public total(): number {
        return this.allocated;
    }

    public async used(): Promise<number> {
        return getSize(this.storageDir);
    }

    // based on https://stackoverflow.com/a/34017887
    public async stats(): Promise<StorageStatistics> {
        return new Promise<StorageStatistics>(resolve => {
            getSize(this.storageDir).then(size => {
                const used = size - fs.statSync(this.metadataPath).size;
                const leftBytes = this.allocated - used;
                const available = leftBytes > 0 ? leftBytes : 0;
                const total = this.allocated;
                return resolve({
                    total,
                    available,
                    used
                });
            });
        });
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
