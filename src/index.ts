import EventEmitter from "events";
import { ContentsClient } from "@noia-network/node-contents-client";
import { LoggerInstance } from "winston";

import Master from "./lib/master";
import NodeController from "./lib/node-controller";
import StorageSpace from "./lib/storage-space";
import Wallet from "./lib/wallet";
import localLogger from "./lib/logger";
import { ClientSockets, ClientSocketsOptions } from "./lib/client-sockets";
import { Helpers } from "./lib/helpers";
import { Options, Settings } from "./lib/settings";
import { Statistics } from "./lib/statistics";

export class Node extends EventEmitter {
    private opts: any;
    public logger: LoggerInstance = localLogger;
    public settings: Settings;
    public id: any;
    public storageSpace: StorageSpace;
    public master: Master;
    public clientSockets: ClientSockets;
    public contentsClient: ContentsClient;
    public wallet: Wallet;
    public nodeController: undefined | NodeController;
    public statistics: Statistics;
    public VERSION: string = "0.1.0"; // TODO

    constructor(opts: any) {
        super();
        this.opts = opts || {};
        this.settings = new Settings(opts);
        this.statistics = new Statistics(this.settings.get(Options.statisticsPath));

        this.master = new Master(this);
        this.clientSockets = new ClientSockets(this, this.getClientSocketsOptions(this.settings.get.bind(this.settings)));
        this.contentsClient = new ContentsClient(this.master, this.settings.get(Options.storageDir));
        this.storageSpace = new StorageSpace(this.settings.get(Options.storageDir), this.settings.get(Options.storageSize));
        this.wallet = new Wallet(this, this.settings.get(Options.walletMnemonic), this.settings.get(Options.walletProviderUrl));
        if (this.settings.get(Options.controller)) {
            this.nodeController = new NodeController(this);
        }

        const contentsClientSeedingListener = (infoHashes: string[]) => {
            this.master.seeding(infoHashes);
            this.storageSpace.stats().then(info => {
                this.master.metadata({ storage: info });
            });
        };

        this.master.on("connected", () => {
            this.master.seeding(this.contentsClient.getInfoHashes());
            this.contentsClient.addListener("seeding", contentsClientSeedingListener);
            Promise.all([this.storageSpace.stats(), Helpers.getSpeedTest()])
                .then(results => {
                    this.master.metadata({ storage: results[0], speedTest: results[1] });
                })
                .catch(err => {
                    this.logger.error(err);
                });
        });
        this.master.on("error", err => {
            this.stop();
            this.emit("error", err);
        });
        this.master.on("closed", info => {
            this.contentsClient.removeListener("seeding", contentsClientSeedingListener);
            this.stop();
        });
        this.clientSockets.on("error", (err: any) => {
            this.stop();
            this.emit("error", err);
        });

        // update total uploaded and uploaded statistics
        this.contentsClient.on("downloaded", (chunkSize: number) => {
            const totalDownloaded = this.statistics.get(this.statistics.Options.totalDownloaded);
            this.statistics.update(this.statistics.Options.totalDownloaded, totalDownloaded + chunkSize);
        });
        this.contentsClient.on("uploaded", (chunkSize: number) => {
            const totalUploaded = this.statistics.get(this.statistics.Options.totalUploaded);
            this.statistics.update(this.statistics.Options.totalUploaded, totalUploaded + chunkSize);
        });
    }

    public setWallet(walletAddress: string): void {
        this.settings.update(this.settings.Options.walletAddress, walletAddress);
    }

    public getBalance(): Promise<number> {
        return this.wallet.getBalance();
    }

    public getEthBalance(): Promise<number> {
        return this.wallet.getEthBalance();
    }

    public setStorageSpace(dir: any, allocated: any) {
        if (dir) this.settings.update(Options.storageDir, dir);
        if (allocated) this.settings.update(Options.storageSize, allocated);
    }

    public async start(opts?: any) {
        opts = opts || {};

        if (!this.storageSpace) return this.emit("error", new Error("storageSpace not set"));
        if (!this.clientSockets) return this.emit("error", new Error("clientSockets not set"));

        this.contentsClient.start();
        await this.clientSockets.listen();

        const skipBlockain = this.settings.get(Options.skipBlockchain);
        if (skipBlockain) {
            console.info("calling start() master.connect");
            this.master.connect(
                this.settings.get(Options.masterAddress),
                null
            );
        } else {
            this.wallet.lazyNodeRegistration(this.settings.get(Options.client)).then(isRegistered => {
                if (isRegistered) {
                    this.wallet
                        .findFirstJob()
                        .then((jobData: any) => {
                            const address = `ws://${jobData.info.host}:${jobData.info.port}`;
                            this.master.connect(
                                address,
                                jobData.employerAddress
                            );
                        })
                        .catch((err: Error) => {
                            this.logger.error("Could not find job and connect to master", err);
                            throw new Error(err.message);
                        });
                } else {
                    this.logger.info("Node failed to register. Will try again.");
                    setTimeout(() => {
                        this.restart();
                    }, 15000);
                }
            });
        }

        process.nextTick(async () => {
            this.emit("started");
        });
    }

    public async stop(cb?: any): Promise<void> {
        this.master.disconnect();
        await this.clientSockets.close();
        this.contentsClient.stop();

        this.emit("stopped");
        if (typeof cb === "function") {
            cb();
        }
    }

    public async restart(): Promise<void> {
        this.logger.warn("Restarting node...");
        await this.stop();
        await this.start();
    }

    public async destroy(cb: any): Promise<void> {
        await this.master.close();
        await this.clientSockets.close();
        await this.contentsClient.destroy();

        this.emit("destroyed");
        if (typeof cb === "function") {
            cb();
        }
    }

    private getClientSocketsOptions(options: any) {
        const clientSocketsOpts: ClientSocketsOptions = {
            natPmp: options(Options.natPmp),
            http: options(Options.http)
                ? {
                      ip: options(Options.httpIp),
                      port: options(Options.httpPort)
                  }
                : false,
            ws: options(Options.ws)
                ? {
                      ip: options(Options.wsIp),
                      port: options(Options.wsPort),
                      ssl: options(Options.ssl),
                      ssl_key: options(Options.sslPrivateKeyPath),
                      ssl_cert: options(Options.sslCrtPath),
                      ssl_ca: options(Options.sslCrtBundlePath)
                  }
                : false,
            wrtc: options(Options.wrtc)
                ? {
                      controlPort: options(Options.wrtcControlPort),
                      controlIp: options(Options.wrtcControlIp),
                      dataPort: options(Options.wrtcDataPort),
                      dataIp: options(Options.wrtcDataIp)
                  }
                : false
        };
        return clientSocketsOpts;
    }
}
