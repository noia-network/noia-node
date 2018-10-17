import * as path from "path";
import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import { ContentsClient } from "@noia-network/node-contents-client";
import { DeepPartial } from "@noia-network/node-settings/dist/contracts/types-helpers";
import { NodeSettings, NodeSettingsDto } from "@noia-network/node-settings";

import { ClientSockets } from "./client-sockets";
import { Helpers } from "./helpers";
import { Logger, logger } from "./logger";
import { Master } from "./master";
import { NodeController } from "./node-controller";
import { Statistics, StatisticsEnum } from "./statistics";
import { StorageSpace } from "./storage-space";
import { Wallet } from "./wallet";
import { WebSocketCloseEvent } from "./contracts";

export type NodeInterface = "cli" | "gui" | "unspecified";

interface NodeEvents {
    started: (this: Node) => this;
    stopped: (this: Node) => this;
    destroyed: (this: Node) => this;
    warning: (this: Node, msg: string) => this;
    error: (this: Node, error: Error) => this;
}
type NodeEmitter = StrictEventEmitter<EventEmitter, NodeEvents>;
export class Node extends (EventEmitter as { new (): NodeEmitter }) {
    private clientSockets?: ClientSockets;
    private contentsClient?: ContentsClient;
    private isRestarting: boolean = false;
    private master?: Master;
    private settings?: NodeSettings;
    private statistics?: Statistics;
    private storageSpace?: StorageSpace;
    private wallet?: Wallet;
    public logger: Logger = logger;
    public nodeController: undefined | NodeController;
    public readonly VERSION: string = "0.1.0";

    constructor(
        public readonly opts: {
            interface: NodeInterface;
            settingsPath?: string;
        } = { interface: "unspecified" }
    ) {
        super();
        this.opts.settingsPath = this.opts.settingsPath != null ? this.opts.settingsPath : NodeSettings.getDefaultSettingsPath();
    }

    public async init(): Promise<void> {
        // TODO: When initialized with defaults, I don't know where settings were saved to, would be nice not to do this check.
        logger.info(`Initializing NOIA node, settings-path=${this.opts.settingsPath}.`);
        this.settings = await NodeSettings.init(this.opts.settingsPath);
        this.settings.on("updated", updatedEvent => {
            logger.info(
                `Setting configuration updated: key=${updatedEvent.setting.key} prev-value=${updatedEvent.prevValue} value=${
                    updatedEvent.value
                }.`
            );
        });
        this.statistics = new Statistics(this.settings.getDefaultSettings().statisticsPath as string);
        this.master = new Master(this);
        this.clientSockets = new ClientSockets(this);
        const settingsStorageDir = this.getSettings()
            .getScope("storage")
            .get("dir");
        const storageDir = settingsStorageDir != null ? settingsStorageDir : path.join(this.getSettings().get("userDataPath"), "storage");
        this.storageSpace = new StorageSpace(storageDir, this.settings.getScope("storage").get("size"));
        this.contentsClient = new ContentsClient(this.getMaster(), storageDir);
        this.wallet = new Wallet(
            this,
            this.settings.getScope("blockchain").get("walletMnemonic"),
            this.settings.getScope("blockchain").get("walletProviderUrl")
        );
        if (this.settings.getScope("controller").get("isEnabled")) {
            this.nodeController = new NodeController(this);
        }
        this.getWallet().getBalance();
        const contentsClientSeedingListener = (infoHashes: string[]) => {
            this.getMaster().seeding(infoHashes);
            this.getStorageSpace()
                .stats()
                .then(info => {
                    this.getMaster().storage(info);
                });
        };

        // Register bandwidth reporting in 5 minutes interval.
        setInterval(async () => {
            const bandwidthData = await Helpers.getSpeedTest();
            this.getMaster().bandwidth(bandwidthData);
        }, 5 * 60 * 1000);

        this.getMaster().on("connected", async () => {
            this.logger.info(`Connected to master, master-address=${this.getMaster().address}.`);
            contentsClientSeedingListener(this.getContentsClient().getInfoHashes());
            this.getContentsClient().addListener("seeding", contentsClientSeedingListener);
            this.getMaster().addListener("workOrder", this.getWallet().onWorkOrder.bind(this.getWallet()));
            this.getMaster().addListener("signedRequest", async signedRequest => {
                try {
                    await this.getWallet().onReceivedSignedRequest(signedRequest);
                } catch (err) {
                    logger.error(`Received signed request contains an error='${err.message}'.`);
                    this.getSettings()
                        .getScope("blockchain")
                        .reset("workOrderAddress");
                    this.getMaster().error(err);
                }
            });
        });

        /**
         * Remove some registered listeners and restart or stop node.
         */
        this.getMaster().on("error", async err => {
            this.getMaster().removeAllListeners("workOrder");
            this.getMaster().removeAllListeners("signedRequest");
            this.getContentsClient().removeListener("seeding", contentsClientSeedingListener);
            if (
                this.getSettings()
                    .getScope("blockchain")
                    .get("isEnabled")
            ) {
                this.getWallet().cleanup();
                await this.restart(15);
            } else {
                this.stop();
                this.emit("error", err);
            }
        });
        this.getMaster().on("closed", closeEvent => {
            this.getMaster().removeAllListeners("workOrder");
            this.getMaster().removeAllListeners("signedRequest");
            this.getContentsClient().removeListener("seeding", contentsClientSeedingListener);
            if (closeEvent != null && closeEvent.code !== WebSocketCloseEvent.ServiceRestarting) {
                this.stop();
            }
        });
        this.clientSockets.on("error", (err: Error) => {
            this.stop();
            this.emit("error", err);
        });

        // Update total uploaded and uploaded statistics.
        this.getContentsClient().on("downloaded", (chunkSize: number) => {
            const totalDownloaded = this.getStatistics().statistics[StatisticsEnum.totalDownloaded];
            this.getStatistics().update(StatisticsEnum.totalDownloaded, totalDownloaded + chunkSize);
        });
        this.getContentsClient().on("uploaded", (chunkSize: number) => {
            const totalUploaded = this.getStatistics().statistics[StatisticsEnum.totalUploaded];
            this.getStatistics().update(StatisticsEnum.totalUploaded, totalUploaded + chunkSize);
        });
        logger.info("NOIA node initialized.");
    }

    public getContentsClient(): ContentsClient {
        if (this.contentsClient == null) {
            throw new Error("Node contents client is not initialized.");
        }
        return this.contentsClient;
    }

    public getSettings(): NodeSettings {
        if (this.settings == null) {
            throw new Error("Node settings are not initialized.");
        }
        return this.settings;
    }

    public getWallet(): Wallet {
        if (this.wallet == null) {
            throw new Error("Node wallet is not initialized.");
        }
        return this.wallet;
    }

    public getStatistics(): Statistics {
        if (this.statistics == null) {
            throw new Error("Node statistics is not initialized.");
        }
        return this.statistics;
    }

    public getStorageSpace(): StorageSpace {
        if (this.storageSpace == null) {
            throw new Error("Node storage space is not initialized.");
        }
        return this.storageSpace;
    }

    public getMaster(): Master {
        if (this.master == null) {
            throw new Error("Node master is not initialized.");
        }
        return this.master;
    }

    public getClientSockets(): ClientSockets {
        if (this.clientSockets == null) {
            throw new Error("Node client sockets is not initialized.");
        }
        return this.clientSockets;
    }

    public setAirdropAddress(airdropAddress: string): void {
        this.getSettings()
            .getScope("blockchain")
            .update("airdropAddress", airdropAddress);
    }

    public async getBalance(): Promise<number> {
        return this.getWallet().getBalance();
    }

    public async getEthBalance(): Promise<number> {
        return this.getWallet().getEthBalance();
    }

    public setStorageSpace(dir: string, allocated: number): void {
        if (dir) {
            this.getSettings()
                .getScope("storage")
                .update("dir", dir);
        }
        if (allocated) {
            this.getSettings()
                .getScope("storage")
                .update("size", allocated);
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

        this.getContentsClient().start();
        await this.clientSockets.listen();

        const skipBlockain = !this.getSettings()
            .getScope("blockchain")
            .get("isEnabled");
        if (skipBlockain) {
            const masterAddress = this.getSettings().get("masterAddress");
            logger.info(`Connecting to master (without blockchain), master-address=${masterAddress}.`);
            this.getMaster().connect(masterAddress);
        } else {
            if (
                await this.getWallet().lazyNodeRegistration(
                    this.getSettings()
                        .getScope("blockchain")
                        .get("clientAddress")
                )
            ) {
                try {
                    const jobData = await this.getWallet().findNextJob();
                    this.getSettings()
                        .getScope("blockchain")
                        .update("lastBlockPosition", jobData.blockPosition);
                    if (jobData.info.host == null || jobData.info.port == null) {
                        logger.warn("Job post info is missing host or port.");
                    }
                    const address = `ws://${jobData.info.host}:${jobData.info.port}`;
                    this.getMaster().connect(
                        address,
                        jobData
                    );
                } catch (err) {
                    this.logger.error("Could not find job and connect to master:", err);
                    // Restart and attempt again!
                    this.getWallet().cleanup();
                    await this.restart(15);
                }
            } else {
                this.logger.info("Node failed to register. Will try again.");
                await this.restart(15);
            }
        }

        process.nextTick(async () => {
            this.emit("started");
        });
    }

    public async stop(doRestart = false): Promise<void> {
        this.getMaster().disconnect(doRestart);
        await this.getClientSockets().close();
        this.getContentsClient().stop();
        this.emit("stopped");
    }

    public async restart(timeoutSec: number): Promise<void> {
        if (this.isRestarting) {
            return;
        }
        this.isRestarting = true;
        this.logger.warn(`Restarting node in ${timeoutSec} seconds...`);
        setTimeout(async () => {
            await this.stop(true);
            this.isRestarting = false;
            await this.start();
        }, timeoutSec * 1000);
    }

    public async destroy(): Promise<void> {
        await this.getMaster().close();
        await this.getClientSockets().close();
        this.getContentsClient().destroy();

        this.emit("destroyed");
    }
}
