import EventEmitter from "events";
import fs from "fs";
import jsonfile from "jsonfile";
import path from "path";

import { logger } from "./logger";
import { Helpers } from "./helpers";
import { NodeOptions } from "./node";

export enum SettingsEnum {
    client = "client",
    controller = "controller",
    controllerIp = "controller.ip",
    controllerPort = "controller.port",
    doCreateClient = "doCreateClient",
    domain = "domain",
    http = "sockets.http",
    httpIp = "sockets.http.ip",
    httpPort = "sockets.http.port",
    isHeadless = "isHeadless",
    lastBlockPosition = "lastBlockPosition",
    masterAddress = "masterAddress",
    natPmp = "natPmp",
    nodeId = "nodeId",
    publicIp = "publicIp",
    // TODO: review settingsPath option.
    settingsPath = "settingsPath",
    skipBlockchain = "skipBlockchain",
    ssl = "ssl",
    sslCrtBundlePath = "ssl.crtBundlePath",
    sslCrtPath = "ssl.crtPath",
    sslPrivateKeyPath = "ssl.privateKeyPath",
    statisticsPath = "statisticsPath",
    storageDir = "storage.dir",
    storageSize = "storage.size",
    // TODO: review userDataPath option.
    userDataPath = "userDataPath",
    walletAddress = "wallet.address",
    walletMnemonic = "wallet.mnemonic",
    walletProviderUrl = "wallet.providerUrl",
    whitelistMasters = "whitelist.masters",
    workOrder = "workOrder",
    wrtc = "sockets.wrtc",
    wrtcControlIp = "sockets.wrtc.control.ip",
    wrtcControlPort = "sockets.wrtc.control.port",
    wrtcDataIp = "sockets.wrtc.data.ip",
    wrtcDataPort = "sockets.wrtc.data.port",
    ws = "sockets.ws",
    wsIp = "sockets.ws.ip",
    wsPort = "sockets.ws.port"
}

export interface SettingsOptions {
    [SettingsEnum.client]: string;
    [SettingsEnum.controllerIp]: string;
    [SettingsEnum.controllerPort]: number;
    [SettingsEnum.controller]: boolean;
    [SettingsEnum.doCreateClient]: boolean;
    [SettingsEnum.domain]: string;
    [SettingsEnum.httpIp]: string;
    [SettingsEnum.httpPort]: number;
    [SettingsEnum.http]: boolean;
    [SettingsEnum.isHeadless]: boolean;
    [SettingsEnum.lastBlockPosition]: string;
    [SettingsEnum.masterAddress]: string;
    [SettingsEnum.natPmp]: boolean;
    [SettingsEnum.nodeId]: string;
    [SettingsEnum.publicIp]: string;
    [SettingsEnum.settingsPath]: string;
    [SettingsEnum.skipBlockchain]: boolean;
    [SettingsEnum.sslCrtBundlePath]: string;
    [SettingsEnum.sslCrtPath]: string;
    [SettingsEnum.sslPrivateKeyPath]: string;
    [SettingsEnum.ssl]: boolean;
    [SettingsEnum.statisticsPath]: string;
    [SettingsEnum.storageDir]: string;
    [SettingsEnum.storageSize]: number;
    [SettingsEnum.userDataPath]: string;
    [SettingsEnum.walletAddress]: string;
    [SettingsEnum.walletMnemonic]: string;
    [SettingsEnum.walletProviderUrl]: string;
    [SettingsEnum.whitelistMasters]: string[];
    [SettingsEnum.workOrder]: string;
    [SettingsEnum.wrtcControlIp]: string;
    [SettingsEnum.wrtcControlPort]: number;
    [SettingsEnum.wrtcDataIp]: string;
    [SettingsEnum.wrtcDataPort]: number;
    [SettingsEnum.wrtc]: boolean;
    [SettingsEnum.wsIp]: string;
    [SettingsEnum.wsPort]: number;
    [SettingsEnum.ws]: boolean;
}

export class Settings extends EventEmitter {
    private userDataPath: string;
    public readonly ready: boolean = false;
    public options: SettingsOptions;
    public file: string;

    constructor(public readonly opts: NodeOptions) {
        super();
        // FIXME: Better way to use enums as interfaces?
        const userDataPath = this.opts[SettingsEnum.userDataPath];
        this.userDataPath = typeof userDataPath !== "string" ? "" : userDataPath;
        this.opts[SettingsEnum.userDataPath] = userDataPath;
        this.file = path.resolve(this.opts.settingsPath ? this.opts.settingsPath : path.join(this.userDataPath, "settings.json"));

        logger.info(`Configuration filepath=${this.file}.`);

        if (!fs.existsSync(this.file)) {
            this._write({});
        } else {
            try {
                const savedSettings = JSON.parse(JSON.stringify(this._read()));
            } catch (ex) {
                this._write({});
            }
        }

        this.options = this._read();

        const idPrefix = this.opts.isHeadless ? "cli" : "gui";
        this.update(SettingsEnum.isHeadless, this.opts.isHeadless, false);
        this.update(SettingsEnum.skipBlockchain, this.opts.skipBlockchain, true);
        const skipBlockchain = this.options[SettingsEnum.skipBlockchain];
        this.update(SettingsEnum.statisticsPath, this.opts.statisticsPath, path.resolve(path.join(this.userDataPath, "statistics.json")));
        this.update(SettingsEnum.storageDir, this.opts[SettingsEnum.storageDir], path.resolve(this.userDataPath, "./storage"));
        this.update(SettingsEnum.storageSize, this.opts[SettingsEnum.storageSize], 104857600);
        this.update(SettingsEnum.domain, this.opts.domain, "");
        this.options[SettingsEnum.ssl] === true && this.sslPathsExist() === false
            ? this.update(SettingsEnum.ssl, false)
            : this.update(SettingsEnum.ssl, this.opts.ssl, false);
        this.update(SettingsEnum.sslPrivateKeyPath, this.opts[SettingsEnum.sslPrivateKeyPath], "");
        this.update(SettingsEnum.client, this.opts.client);
        this.update(SettingsEnum.controller, this.opts.controller, false);
        this.update(SettingsEnum.controllerIp, this.opts[SettingsEnum.controllerIp], "127.0.0.1");
        this.update(SettingsEnum.controllerPort, this.opts[SettingsEnum.controllerPort], 9000);
        this.update(SettingsEnum.doCreateClient, this.opts.doCreateClient, false);
        this.update(SettingsEnum.http, this.opts[SettingsEnum.http], false);
        this.update(SettingsEnum.httpIp, this.opts[SettingsEnum.httpIp], "0.0.0.0");
        this.update(SettingsEnum.httpPort, this.opts[SettingsEnum.httpPort], 6767);
        this.update(SettingsEnum.lastBlockPosition, this.opts.lastBlockPosition, undefined);
        this.update(SettingsEnum.masterAddress, this.opts.masterAddress, skipBlockchain ? "" : undefined);
        this.update(SettingsEnum.natPmp, this.opts.natPmp, false);
        this.update(SettingsEnum.nodeId, this.opts.nodeId, () => Helpers.randomString(40));
        this.update(SettingsEnum.publicIp, this.opts.publicIp, "");
        this.update(SettingsEnum.sslCrtBundlePath, this.opts[SettingsEnum.sslCrtBundlePath], "");
        this.update(SettingsEnum.sslCrtPath, this.opts[SettingsEnum.sslCrtPath], "");
        this.update(SettingsEnum.walletAddress, this.opts[SettingsEnum.walletAddress], skipBlockchain ? "" : undefined);
        this.update(SettingsEnum.walletMnemonic, this.opts[SettingsEnum.walletMnemonic], () => Helpers.randomString(20));
        this.update(SettingsEnum.walletProviderUrl, this.opts[SettingsEnum.walletProviderUrl], skipBlockchain ? undefined : "");
        this.update(SettingsEnum.whitelistMasters, this.opts[SettingsEnum.whitelistMasters], []);
        this.update(SettingsEnum.wrtc, this.opts[SettingsEnum.wrtc], true);
        this.update(SettingsEnum.wrtcControlIp, this.opts[SettingsEnum.wrtcControlIp], "0.0.0.0");
        this.update(SettingsEnum.wrtcControlPort, this.opts[SettingsEnum.wrtcControlPort], 8048);
        this.update(SettingsEnum.wrtcDataIp, this.opts[SettingsEnum.wrtcDataIp], undefined);
        this.update(SettingsEnum.workOrder, this.opts[SettingsEnum.workOrder], undefined);
        this.update(SettingsEnum.wrtcDataPort, this.opts[SettingsEnum.wrtcDataPort], 8058);
        this.update(SettingsEnum.ws, this.opts[SettingsEnum.ws], false);
        this.update(SettingsEnum.wsIp, this.opts[SettingsEnum.wsIp], "0.0.0.0");
        this.update(SettingsEnum.wsPort, this.opts[SettingsEnum.wsPort], 7676);

        // resolve to full paths
        const storageDir = this.options[SettingsEnum.storageDir];
        if (typeof storageDir === "string") {
            this.update(SettingsEnum.storageDir, path.resolve(storageDir));
        }

        const sslPrivateKeyPath = this.options[SettingsEnum.sslPrivateKeyPath];
        if (typeof sslPrivateKeyPath === "string") {
            this.update(SettingsEnum.sslPrivateKeyPath, path.resolve(sslPrivateKeyPath));
        }

        const sslCrtPath = this.options[SettingsEnum.sslCrtPath];
        if (typeof sslCrtPath === "string") {
            this.update(SettingsEnum.sslCrtPath, path.resolve(sslCrtPath));
        }

        const sslCrtBundlePath = this.options[SettingsEnum.sslCrtBundlePath];
        if (typeof sslCrtBundlePath === "string") {
            this.update(SettingsEnum.sslCrtBundlePath, path.resolve(sslCrtBundlePath));
        }

        logger.info(`NOIA node has node-id=${this.options[SettingsEnum.nodeId]}.`);

        this.ready = true;
    }

    public update(key: SettingsEnum, value: any, defaultValue?: any): void {
        const settings = this._read();
        if (isMeaningful(value) && settings[key] !== value) {
            settings[key] = value;
            this._write(settings);
        } else if (settings[key] === null || typeof settings[key] === "undefined") {
            if (typeof defaultValue === "function") {
                settings[key] = defaultValue();
                this._write(settings);
            } else {
                settings[key] = defaultValue;
                this._write(settings);
            }
        }
    }

    public remove(key: SettingsEnum): void {
        const settings = this._read();
        delete settings[key];
        this._write(settings);
    }

    private _write(settings: any): void {
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
                        logger.info(`Setting configuration key=${key} oldValue=${s1[key]} newValue=${s2[key]}.`);
                    } else {
                        logger.info(`Setting configuration key=${key} oldValue=${s2[key]} newValue=${s1[key]}.`);
                    }
                    this.emit("changed", { key, value: s1[key] });
                }
            });
        };

        const checklist: string[] = [];
        checkChanged(settings, this.options, false, checklist);
        checkChanged(this.options, settings, true, checklist);

        jsonfile.writeFileSync(this.file, settings, { spaces: 2 });
        this.options = settings;
    }

    private _read(): SettingsOptions {
        return jsonfile.readFileSync(this.file);
    }

    private sslPathsExist(): boolean {
        let ssl = true;
        if (this.options[SettingsEnum.ssl] === true) {
            const sslPrivateKeyPath = this.options[SettingsEnum.sslPrivateKeyPath];
            const sslCrtPath = this.options[SettingsEnum.sslCrtPath];
            const sslCrtBundlePath = this.options[SettingsEnum.sslCrtBundlePath];
            if (typeof sslPrivateKeyPath !== "string" || (typeof sslPrivateKeyPath === "string" && !fs.existsSync(sslPrivateKeyPath))) {
                ssl = false;
                logger.warn(`No such file: ${sslPrivateKeyPath}, fallback ssl=${ssl}.`);
            }
            if (typeof sslCrtPath !== "string" || (typeof sslCrtPath === "string" && !fs.existsSync(sslCrtPath))) {
                ssl = false;
                logger.warn(`No such file: ${sslCrtPath}, fallback ssl=${ssl}.`);
            }
            if (typeof sslCrtBundlePath !== "string" || (typeof sslCrtBundlePath === "string" && !fs.existsSync(sslCrtBundlePath))) {
                ssl = false;
                logger.warn(`No such file: ${sslCrtBundlePath}, fallback ssl=${ssl}.`);
            }
        }
        return ssl;
    }
}

function isMeaningful(value: any): boolean {
    if (value !== null && typeof value !== "undefined" && value !== "") {
        return true;
    } else {
        return false;
    }
}
