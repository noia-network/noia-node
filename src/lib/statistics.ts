import EventEmitter from "events";
import fs from "fs";
import jsonfile from "jsonfile";
import path from "path";

import logger from "./logger";

const DEBUG = false;

export enum StatisticsOptions {
    totalTimeConnected = "total.timeConnected",
    totalDownloaded = "total.downloaded",
    totalUploaded = "total.uploaded"
}

interface StatisticsOpts {
    totalTimeConnected: number;
    totalDownloaded: number;
    totalUploaded: number;
}

export class Statistics extends EventEmitter {
    public opts: {
        statisticsPath: string;
    };
    public filePath: string;
    public statistics: any;
    public ready: boolean;
    public Options = StatisticsOptions;

    constructor(opts: any) {
        super();
        this.opts = opts || {};

        this.filePath = this.opts.statisticsPath;

        logger.info(`Statistics filepath=${this.filePath}`);

        if (!fs.existsSync(this.filePath)) {
            this._write({});
        } else {
            try {
                const savedStatistics = JSON.parse(JSON.stringify(this._read()));
            } catch (ex) {
                this._write({});
            }
        }

        this.statistics = this._read();

        this.update(StatisticsOptions.totalTimeConnected, this.statistics[StatisticsOptions.totalTimeConnected], 0);
        this.update(StatisticsOptions.totalDownloaded, this.statistics[StatisticsOptions.totalDownloaded], 0);
        this.update(StatisticsOptions.totalUploaded, this.statistics[StatisticsOptions.totalUploaded], 0);

        this.ready = true;
    }

    get(key: StatisticsOptions) {
        if (key) {
            return this.statistics[key];
        } else {
            return this.statistics;
        }
    }

    update(key: StatisticsOptions, value: any, defaultValue?: any) {
        const statistics = this._read();
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

    remove(key: StatisticsOptions) {
        const statistics = this._read();
        delete statistics[key];
        this._write(statistics);
    }

    _write(statistics: any) {
        const self = this;
        const notified: string[] = [];
        const checkChanged = (s1: any, s2: any, notified: string[], reverse: boolean = false) => {
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
                    if (notified.includes(key)) return;
                    notified.push(key);
                    if (reverse) {
                        if (DEBUG) logger.info(`Statistics configuration key=${key} oldValue=${s1[key]} newValue=${s2[key]}`);
                    } else {
                        if (DEBUG) logger.info(`Statistics configuration key=${key} oldValue=${s2[key]} newValue=${s1[key]}`);
                    }
                    self.emit("changed", { key, value: s1[key] });
                }
            });
        };

        checkChanged(statistics, this.statistics, notified, false);
        checkChanged(this.statistics, statistics, notified, true);

        jsonfile.writeFileSync(this.filePath, statistics, { spaces: 2 });
        this.statistics = statistics;
    }

    _read() {
        return jsonfile.readFileSync(this.filePath);
    }
}

function isMeaningful(value: any) {
    if (value !== null && typeof value !== "undefined" && value !== "") {
        return true;
    } else {
        return false;
    }
}
