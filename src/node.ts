import * as os from "os";
import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import { ContentsClient } from "@noia-network/node-contents-client";
import { NodeSettings } from "@noia-network/node-settings";

import { ClientSockets } from "./client-sockets";
import { Helpers } from "./helpers";
import { Logger, logger } from "./logger";
import { Master, MasterConnectionState } from "./master";
import { NodeController } from "./node-controller";
import { StorageSpace } from "./storage-space";
// import { Wallet } from "./wallet";
import { WebSocketCloseEvent } from "./contracts";
import { Statistics } from "./statistics";
import ping from "ping";
import { NodeInfo } from "./node-information";
import { URL } from "url";

export type NodeInterface = "cli" | "gui" | "unspecified";

export interface NodeOptions {
    interface: NodeInterface;
}

export enum NodeState {
    None = "none",
    Initialized = "initialized",
    Started = "started",
    Stopped = "stopped",
    Destroyed = "destroyed",
    Error = "error"
}

interface NodeEvents {
    started: (this: Node) => this;
    stopped: (this: Node) => this;
    destroyed: (this: Node) => this;
    warning: (this: Node, msg: string) => this;
    restarting: (this: Node, seconds: number) => this;
    error: (this: Node, error: Error) => this;
}
type NodeEmitter = StrictEventEmitter<EventEmitter, NodeEvents>;

export class Node extends (EventEmitter as { new (): NodeEmitter }) {
    constructor(public readonly opts: NodeOptions = { interface: "unspecified" }) {
        super();
    }

    /**
     * Client sockets.
     */
    private clientSockets?: ClientSockets;
    /**
     * Contents client.
     */
    private contentsClient?: ContentsClient;
    /**
     * Flag to indicate if node is restarting.
     */
    private isRestarting: boolean = false;
    /**
     * Master.
     */
    private master?: Master;
    /**
     * Settings.
     */
    private settings?: NodeSettings;
    /**
     * Statistics.
     */
    private statistics?: Statistics;
    /**
     * Storage space.
     */
    private storageSpace?: StorageSpace;
    /**
     * Wallet.
     */
    private wallet?: any;
    /**
     * Used to track how long Node should wait before trying to reconnect.
     */
    private timesReconnected: number = 0;
    /**
     * State
     */
    public state: NodeState = NodeState.None;
    /**
     * Logger.
     */
    public logger: Logger = logger;
    /**
     * Node controller.
     */
    public nodeController: undefined | NodeController;
    /**
     * NOIA Node version.
     */
    //TODO __APPVERSION__: JSON.stringify(require(path.resolve(__dirname, "../package.json")).version)
    public static readonly VERSION: string = "1.0.0";

    /**
     * Initialize NOIA Node.
     */
    public async init(nodeSettings?: NodeSettings): Promise<void> {
        if (nodeSettings != null) {
            this.settings = nodeSettings;
        } else {
            this.settings = await NodeSettings.init();
        }
        logger.info(`Initializing NOIA node, settings-path=${this.settings.filePath}.`);
        this.settings.on("updated", updatedEvent => {
            logger.info(
                // tslint:disable-next-line:max-line-length
                `Setting configuration updated: key=${updatedEvent.setting.key} prev-value=${updatedEvent.prevValue} value=${updatedEvent.value}.`
            );
        });

        // Master.
        this.master = new Master(this);

        // Statistics.
        this.statistics = new Statistics(this);

        // Client sockets.
        this.clientSockets = new ClientSockets(this);

        const storageDir = Helpers.getStorageDir(this.getSettings());

        // Storage space.
        this.storageSpace = new StorageSpace(storageDir, this.settings.getScope("storage").get("size"));
        await this.storageSpace.ensureFilesAndDirectories();

        // Contents client.
        this.contentsClient = new ContentsClient(this.getMaster(), storageDir, this.getStorageSpace().stats.bind(this.storageSpace));

        // Wallet.
        // if (this.settings.getScope("blockchain").get("isEnabled")) {
        //     this.wallet = new Wallet(this);
        // }

        // Controller.
        if (this.settings.getScope("controller").get("isEnabled")) {
            this.nodeController = new NodeController(this);
        }

        // this.getWallet().getBalance();
        const contentsClientSeedingListener = async (infoHashes: string[]) => {
            this.getMaster().seeding(infoHashes);
            const storageStats = await this.getStorageSpace().stats();
            this.getMaster().storage({
                ...storageStats
            });
        };

        // Register bandwidth reporting in 5 minutes interval.
        setInterval(async () => {
            if (this.master != null && this.master.connectionState === MasterConnectionState.Connected) {
                const bandwidthData = await Helpers.getSpeedTest();
                if (this.master != null) {
                    this.master.bandwidth(bandwidthData, true);
                }
            }
        }, 60 * 60 * 1000);

        // Handle connection to master.
        this.getMaster().on("connected", async () => {
            this.timesReconnected = 0;
            this.logger.info(`Connected to master, master-address=${this.getMaster().address}.`);
            contentsClientSeedingListener(this.getContentsClient().getInfoHashes());
            this.getContentsClient().addListener("seeding", contentsClientSeedingListener);
            // Gathering node system and network information
            //TODO: Send pingIpv6 one time
            const systemInformation = await NodeInfo.prototype.nodeInfo();
            const networkInterfaces = await NodeInfo.prototype.allNetworkInterfaces();
            try {
                if (networkInterfaces != null && this.settings != null) {
                    const pingIpv6 = (await ping.promise.probe(new URL(this.settings.get("masterAddress")!).hostname, {
                        extra: ["-6"],
                        min_reply: 1
                    })).alive;
                    for (const networkInterface of networkInterfaces) {
                        this.getMaster().nodeSystem({
                            deviceType: os.type(),
                            settingsVersion: this.settings.get("version"),
                            pingIpv6: pingIpv6,
                            interfacesLength: networkInterfaces.length,
                            ...systemInformation,
                            ...networkInterface
                        });
                    }
                }
            } catch (err) {
                logger.error(err);
            }
            if (
                this.getSettings()
                    .getScope("blockchain")
                    .get("isEnabled")
            ) {
                // TODO: Investigate types compatibility.
                // @ts-ignore
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
            }
        });
        // Remove some registered listeners and restart or stop node.
        this.getMaster().on("error", async (err, timeoutSec) => {
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
                if (this.getSettings().get("autoReconnect")) {
                    if (this.getMaster().isReconnecting) {
                        return;
                    }
                    let seconds = Math.pow(2, this.timesReconnected);
                    if (timeoutSec != null) {
                        seconds = timeoutSec;
                    }
                    this.timesReconnected++;
                    this.getMaster().reconnect(seconds);
                } else {
                    this.stop();
                    this.emitError(err);
                }
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

        this.getClientSockets().on("error", (err: Error) => {
            this.stop();
            this.emitError(err);
        });

        // Update total uploaded and uploaded statistics.
        this.getContentsClient().on("downloaded", (chunkSize: number) => {
            logger.debug(`Contents client 'downloaded' event, chunk-size=${chunkSize}.`);
            // TODO: Update contents client so contentId and IP is known.
            this.getMaster().downloaded("", "", chunkSize);
        });
        // this.getContentsClient().on("uploaded", (chunkSize: number) => {
        //     logger.debug(`Contents client 'uploaded' event, chunk-size=${chunkSize}.`);
        //     // TODO: Update contents client so contentId is known.
        //     this.getMaster().uploaded("", chunkSize);
        // });
        logger.info("NOIA node initialized.");
        this.state = NodeState.Initialized;
    }

    /**
     * Start node.
     */
    public async start(): Promise<void> {
        await this.getContentsClient().start();
        await this.getClientSockets().listen();

        const blockchainIsEnabled = this.getSettings()
            .getScope("blockchain")
            .get("isEnabled");
        if (blockchainIsEnabled) {
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
                    this.getMaster().connect(address, jobData);
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
        } else {
            const masterAddress = this.getSettings().get("masterAddress");
            logger.info(`Connecting to master (without blockchain), master-address=${masterAddress}.`);
            this.getMaster().connect(masterAddress);
        }

        process.nextTick(async () => {
            this.state = NodeState.Started;
            this.emit("started");
        });
    }

    /**
     * Stop node.
     */
    public async stop(doRestart = false): Promise<void> {
        this.getMaster().disconnect(doRestart);
        await this.getClientSockets().close();
        this.getContentsClient().stop();
        this.state = NodeState.Stopped;
        this.emit("stopped");
    }

    /**
     * Restart node.
     */
    public async restart(timeoutSec: number): Promise<void> {
        if (this.isRestarting) {
            logger.warn("Restart is already in progress..");
            return;
        }
        this.emit("restarting", timeoutSec);
        this.isRestarting = true;
        this.logger.warn(`Restarting node in ${timeoutSec} seconds...`);
        setTimeout(async () => {
            await this.stop(true);
            this.isRestarting = false;
            await this.start();
        }, timeoutSec * 1000);
    }

    /**
     * Destroy node.
     */
    public async destroy(): Promise<void> {
        await this.getMaster().close();
        await this.getClientSockets().close();
        this.getContentsClient().destroy();

        this.state = NodeState.Destroyed;
        this.emit("destroyed");
    }

    /**
     * Get contents client.
     */
    public getContentsClient(): ContentsClient {
        if (this.contentsClient == null) {
            throw new Error("Node contents client is not initialized.");
        }
        return this.contentsClient;
    }

    /**
     * Get settings.
     */
    public getSettings(): NodeSettings {
        if (this.settings == null) {
            throw new Error("Node settings are not initialized.");
        }
        return this.settings;
    }

    /**
     * Get wallet.
     */
    public getWallet(): any {
        if (this.wallet == null) {
            throw new Error("Node wallet is not initialized.");
        }
        return this.wallet;
    }

    /**
     * Get storage space.
     */
    public getStorageSpace(): StorageSpace {
        if (this.storageSpace == null) {
            throw new Error("Node storage space is not initialized.");
        }
        return this.storageSpace;
    }

    /**
     * Get master.
     */
    public getMaster(): Master {
        if (this.master == null) {
            throw new Error("Node master is not initialized.");
        }
        return this.master;
    }

    /**
     * Get statistics.
     */
    public getStatistics(): Statistics {
        if (this.statistics == null) {
            throw new Error("Node statistics is not initialized.");
        }
        return this.statistics;
    }

    /**
     * Get client sockets.
     */
    public getClientSockets(): ClientSockets {
        if (this.clientSockets == null) {
            throw new Error("Node client sockets are not initialized.");
        }
        return this.clientSockets;
    }

    private emitError(err: Error): void {
        if (this.state !== NodeState.Error) {
            this.emit("error", err);
            this.state = NodeState.Error;
        }
    }

    // TODO: Remove deprecated methods.
    /**
     * Set airdrop address.
     */
    // public setAirdropAddress(airdropAddress: string): void {
    //     this.getSettings()
    //         .getScope("blockchain")
    //         .update("airdropAddress", airdropAddress);
    // }

    // public async getBalance(): Promise<number> {
    //     return this.getWallet().getBalance();
    // }

    // public async getEthBalance(): Promise<number> {
    //     return this.getWallet().getEthBalance();
    // }

    // public setStorageSpace(dir: string, allocated: number): void {
    //     if (dir) {
    //         this.getSettings()
    //             .getScope("storage")
    //             .update("dir", dir);
    //     }
    //     if (allocated) {
    //         this.getSettings()
    //             .getScope("storage")
    //             .update("size", allocated);
    //     }
    // }
}
