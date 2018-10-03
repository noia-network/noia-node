import EventEmitter from "events";
import fs from "fs";
import jsonfile from "jsonfile";

import { logger } from "./logger";

const DEBUG = false;

export enum StatisticsEnum {
    totalTimeConnected = "total.timeConnected",
    totalDownloaded = "total.downloaded",
    totalUploaded = "total.uploaded"
}

interface StatisticsOptions {
    [StatisticsEnum.totalTimeConnected]: number;
    [StatisticsEnum.totalDownloaded]: number;
    [StatisticsEnum.totalUploaded]: number;
}

export class Statistics extends EventEmitter {
    public readonly ready: boolean = false;
    public statistics: StatisticsOptions;

    constructor(public readonly filePath: string) {
        super();

        logger.info(`Loaded statistics filepath=${this.filePath}.`);

        if (!fs.existsSync(this.filePath)) {
            this._write({});
            this.statistics = this.read();
            this.statistics = this.read();
        } else {
            try {
                this.statistics = JSON.parse(JSON.stringify(this.read()));
            } catch (ex) {
                this._write({});
                this.statistics = this.read();
            }
        }

        this.update(StatisticsEnum.totalTimeConnected, this.statistics[StatisticsEnum.totalTimeConnected], 0);
        this.update(StatisticsEnum.totalDownloaded, this.statistics[StatisticsEnum.totalDownloaded], 0);
        this.update(StatisticsEnum.totalUploaded, this.statistics[StatisticsEnum.totalUploaded], 0);

        this.ready = true;
    }

    public update(key: StatisticsEnum, value: any, defaultValue?: any): void {
        const statistics = this.read();
        if (isMeaningful(value) && statistics[key] !== value) {
            statistics[key] = value;
            this._write(statistics);
        } else if (statistics[key] === null || typeof statistics[key] === "undefined") {
            if (typeof defaultValue === "function") {
                statistics[key] = defaultValue();
                this._write(statistics);
            } else {
                // FIXME
                statistics[key] = defaultValue;
                this._write(statistics);
            }
        }
    }

    public remove(key: StatisticsEnum): void {
        const statistics = this.read();
        delete statistics[key];
        this._write(statistics);
    }

    private _write(statistics: any): void {
        const checkChanged = (s1: any, s2: any, reverse: boolean = false, notified: string[] = []) => {
            if (typeof s1 === "undefined" || s1 === null) {
                return;
            }
            const keys: string[] = Object.keys(s1);
            keys.forEach((key: string) => {
                let isSame = true;
                if (Array.isArray(s1[key])) {
                    if (!s1[key] || !s2[key]) {
                        isSame = false;
                    } else {
                        isSame = s1[key].every((e: any) => s2[key].includes(e));
                    }
                } else {
                    isSame = s1[key] === s2[key];
                }
                if (!isSame) {
                    if (notified.includes(key)) {
                        return;
                    }
                    notified.push(key);
                    if (reverse) {
                        if (DEBUG) {
                            logger.info(`Statistics configuration key=${key} oldValue=${s1[key]} newValue=${s2[key]}.`);
                        }
                    } else {
                        if (DEBUG) {
                            logger.info(`Statistics configuration key=${key} oldValue=${s2[key]} newValue=${s1[key]}.`);
                        }
                    }
                    this.emit("changed", { key, value: s1[key] });
                }
            });
        };

        checkChanged(statistics, this.statistics);
        checkChanged(this.statistics, statistics, true);

        jsonfile.writeFileSync(this.filePath, statistics, { spaces: 2 });
        this.statistics = statistics;
    }

    private read(): StatisticsOptions {
        return jsonfile.readFileSync(this.filePath);
    }
}

function isMeaningful(value: any): boolean {
    if (value !== null && typeof value !== "undefined" && value !== "") {
        return true;
    } else {
        return false;
    }
}
