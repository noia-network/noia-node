import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import { ContentsClient } from "@noia-network/node-contents-client";

import { ClientSockets, ClientSocketsOptions } from "./client-sockets";
import { Helpers } from "./helpers";
import { Logger, logger } from "./logger";
import { Master } from "./master";
import { NodeController } from "./node-controller";
import { SettingsOptions, Settings, SettingsEnum } from "./settings";
import { Statistics, StatisticsEnum } from "./statistics";
import { StorageSpace } from "./storage-space";
import { Wallet } from "./wallet";

interface NodeEvents {
    started: (this: Node) => this;
    stopped: (this: Node) => this;
    destroyed: (this: Node) => this;
    error: (this: Node, error: Error) => this;
}

type NodeEmitter = StrictEventEmitter<EventEmitter, NodeEvents>;

export type NodeOptions = Partial<SettingsOptions>;

export class Node extends (EventEmitter as { new (): NodeEmitter }) {
    public readonly VERSION: string = "0.1.0";
    public clientSockets: ClientSockets;
    public contentsClient: ContentsClient;
    public logger: Logger = logger;
    public master: Master;
    public nodeController: undefined | NodeController;
    public settings: Settings;
    public statistics: Statistics;
    public storageSpace: StorageSpace;
    public wallet: Wallet;

    constructor(public readonly opts: NodeOptions) {
        super();
        this.settings = new Settings(opts);
        this.statistics = new Statistics(this.settings.options[SettingsEnum.statisticsPath]);

        this.master = new Master(this);
        this.clientSockets = new ClientSockets(this, this.getClientSocketsOptions());
        this.storageSpace = new StorageSpace(
            this.settings.options[SettingsEnum.storageDir],
            this.settings.options[SettingsEnum.storageSize]
        );
        this.contentsClient = new ContentsClient(this.master, this.settings.options[SettingsEnum.storageDir]);
        this.wallet = new Wallet(
            this,
            this.settings.options[SettingsEnum.walletMnemonic],
            this.settings.options[SettingsEnum.walletProviderUrl]
        );
        if (this.settings.options[SettingsEnum.controller]) {
            this.nodeController = new NodeController(this);
        }
        this.wallet.getBalance();
        const contentsClientSeedingListener = (infoHashes: string[]) => {
            this.master.seeding(infoHashes);
            this.storageSpace.stats().then(info => {
                this.master.storage(info);
            });
        };

        // Register bandwidth reporting in 5 minutes interval.
        setInterval(async () => {
            const bandwidthData = await Helpers.getSpeedTest();
            this.master.bandwidth(bandwidthData);
        }, 5 * 60 * 1000);

        this.master.on("connected", async () => {
            this.logger.info(`Connected to master, master-address=${this.master.address}.`);
            contentsClientSeedingListener(this.contentsClient.getInfoHashes());
            this.contentsClient.addListener("seeding", contentsClientSeedingListener);
            this.master.addListener("workOrder", this.wallet.onWorkOrder.bind(this.wallet));
            this.master.addListener("signedRequest", this.wallet.onReceivedSignedRequest.bind(this.wallet));
        });

        this.master.on("error", err => {
            this.master.removeAllListeners("workOrder");
            this.master.removeAllListeners("signedRequest");
            this.contentsClient.removeListener("seeding", contentsClientSeedingListener);
            if (!this.settings.options[SettingsEnum.skipBlockchain]) {
                setTimeout(() => {
                    this.restart();
                }, 5000);
            } else {
                this.stop();
            }
            this.emit("error", err);
        });
        this.master.on("closed", _ => {
            this.master.removeAllListeners("workOrder");
            this.master.removeAllListeners("signedRequest");
            this.contentsClient.removeListener("seeding", contentsClientSeedingListener);
            this.stop();
        });
        this.clientSockets.on("error", (err: Error) => {
            this.stop();
            this.emit("error", err);
        });

        // Update total uploaded and uploaded statistics.
        this.contentsClient.on("downloaded", (chunkSize: number) => {
            const totalDownloaded = this.statistics.statistics[StatisticsEnum.totalDownloaded];
            this.statistics.update(StatisticsEnum.totalDownloaded, totalDownloaded + chunkSize);
        });
        this.contentsClient.on("uploaded", (chunkSize: number) => {
            const totalUploaded = this.statistics.statistics[StatisticsEnum.totalUploaded];
            this.statistics.update(StatisticsEnum.totalUploaded, totalUploaded + chunkSize);
        });
    }

    public setWallet(walletAddress: string): void {
        this.settings.update(SettingsEnum.walletAddress, walletAddress);
    }

    public async getBalance(): Promise<number> {
        return this.wallet.getBalance();
    }

    public async getEthBalance(): Promise<number> {
        return this.wallet.getEthBalance();
    }

    public setStorageSpace(dir: string, allocated: number): void {
        if (dir) {
            this.settings.update(SettingsEnum.storageDir, dir);
        }
        if (allocated) {
            this.settings.update(SettingsEnum.storageSize, allocated);
        }
    }

    public async start(): Promise<void> {
        if (!this.storageSpace) {
            const msg = "storageSpace not set";
            this.emit("error", new Error(msg));
            throw new Error(msg);
        }
        if (!this.clientSockets) {
            const msg = "clientSockets not set";
            this.emit("error", new Error("clientSockets not set"));
            throw new Error(msg);
        }

        this.contentsClient.start();
        await this.clientSockets.listen();

        const skipBlockain = this.settings.options[SettingsEnum.skipBlockchain];
        if (skipBlockain) {
            this.master.connect(this.settings.options[SettingsEnum.masterAddress]);
        } else {
            if (await this.wallet.lazyNodeRegistration(this.settings.options[SettingsEnum.client])) {
                try {
                    const jobData = await this.wallet.findNextJob();
                    this.settings.update(SettingsEnum.lastBlockPosition, jobData.blockPosition);
                    if (jobData.info.host == null || jobData.info.port == null) {
                        logger.warn("Job post info is missing host or port.");
                    }
                    const address = `ws://${jobData.info.host}:${jobData.info.port}`;
                    this.master.connect(
                        address,
                        jobData
                    );
                } catch (err) {
                    this.logger.error("Could not find job and connect to master:", err);
                    throw new Error(err.message);
                }
            } else {
                this.logger.info("Node failed to register. Will try again.");
                setTimeout(() => {
                    this.restart();
                }, 15000);
            }
        }

        process.nextTick(async () => {
            this.emit("started");
        });
    }

    public async stop(): Promise<void> {
        this.master.disconnect();
        await this.clientSockets.close();
        this.contentsClient.stop();

        this.emit("stopped");
    }

    public async restart(): Promise<void> {
        this.logger.warn("Restarting node...");
        await this.stop();
        await this.start();
    }

    public async destroy(): Promise<void> {
        await this.master.close();
        await this.clientSockets.close();
        this.contentsClient.destroy();

        this.emit("destroyed");
    }

    private getClientSocketsOptions(): ClientSocketsOptions {
        const clientSocketsOpts: ClientSocketsOptions = {
            natPmp: this.settings.options[SettingsEnum.natPmp],
            http: this.settings.options[SettingsEnum.http]
                ? {
                      ip: this.settings.options[SettingsEnum.httpIp],
                      port: this.settings.options[SettingsEnum.httpPort]
                  }
                : undefined,
            ws: this.settings.options[SettingsEnum.ws]
                ? {
                      ip: this.settings.options[SettingsEnum.wsIp],
                      port: this.settings.options[SettingsEnum.wsPort],
                      ssl: this.settings.options[SettingsEnum.ssl],
                      ssl_key: this.settings.options[SettingsEnum.sslPrivateKeyPath],
                      ssl_cert: this.settings.options[SettingsEnum.sslCrtPath],
                      ssl_ca: this.settings.options[SettingsEnum.sslCrtBundlePath]
                  }
                : undefined,
            wrtc: this.settings.options[SettingsEnum.wrtc]
                ? {
                      controlPort: this.settings.options[SettingsEnum.wrtcControlPort],
                      controlIp: this.settings.options[SettingsEnum.wrtcControlIp],
                      dataPort: this.settings.options[SettingsEnum.wrtcDataPort],
                      dataIp: this.settings.options[SettingsEnum.wrtcDataIp]
                  }
                : undefined
        };
        return clientSocketsOpts;
    }
}
