import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import WebSocket from "ws";
import randombytes from "randombytes";
import {
    Wire,
    NodeBlockchainMetadata,
    MasterBlockchainMetadata,
    MasterMetadata,
    WorkOrder,
    SignedRequest,
    StorageData,
    BandwidthData,
    Statistics,
    NodeInfoData,
    ProtocolEvent,
    Handshake,
    ClosedData,
    Clear,
    Seed,
    Response,
    NodeMetadata,
    PingData,
    NodesFromMaster
} from "@noia-network/protocol";
import { ContentTransferer, ContentTransfererEvents } from "@noia-network/node-contents-client";

import { Helpers } from "./helpers";
import { Node } from "./node";
import { logger } from "./logger";
// import { JobPostDescription } from "./wallet";
import { WebSocketCloseEvent } from "./contracts";
import tcpp from "tcp-ping";
import { NodeInfo } from "./node-information";

const config = Helpers.getConfig();

export enum MasterConnectionState {
    Connected = "connected",
    Connecting = "connecting",
    Disconnected = "disconnected"
}

interface MasterEvents extends ContentTransfererEvents {
    clear: (data: ProtocolEvent<Clear>) => this;
    closed: (data: ClosedData | undefined) => this;
    connected: (data: ProtocolEvent<Handshake>) => this;
    error: (error: Error, timeoutSec?: number) => this;
    response: (data: ProtocolEvent<Response>) => this;
    seed: (data: ProtocolEvent<Seed>) => this;
    workOrder: (data: ProtocolEvent<WorkOrder>) => this;
    signedRequest: (data: ProtocolEvent<SignedRequest>) => this;
    statistics: (data: Statistics) => this;
    connectionStateChange: (connectionState: MasterConnectionState) => this;
    reconnecting: (seconds: number) => this;
    nodesFromMaster: (data: NodesFromMaster) => this;
}

const MasterEmitter: { new (): StrictEventEmitter<EventEmitter, MasterEvents> } = EventEmitter;

export class Master extends MasterEmitter implements ContentTransferer {
    constructor(private readonly node: Node) {
        super();
    }

    private wire: undefined | Wire<NodeBlockchainMetadata, MasterBlockchainMetadata> | Wire<NodeMetadata, MasterMetadata>;

    /**
     * Node connection to master node state.
     */
    public connectionState: MasterConnectionState = MasterConnectionState.Disconnected;
    public address?: string | WebSocket;
    public jobPostDesc?: any;
    public canReconnect: boolean = false;
    public isReconnecting: boolean = false;

    public getExternalIp(): string | undefined {
        return this.node
            .getSettings()
            .getScope("sockets")
            .getScope("wrtc")
            .get("dataIp");
    }

    public setAddress(address: string): void {
        if (this.connectionState === MasterConnectionState.Connecting) {
            this.emit("error", new Error("Cannot change master address while connecting."));
        }
        if (this.connectionState === MasterConnectionState.Connected) {
            this.emit("error", new Error("Cannot change master address while connected to master."));
        }
        this.address = address;
    }

    public reconnect(timeoutSec: number = 0): void {
        if (!this.address) {
            logger.warn("...address unspecified, reconnect aborted");
            return;
        }
        if (!this.canReconnect) {
            logger.info("...reconnect to master skipped.");
            return;
        }

        logger.info(`Reconnecting to master in ${timeoutSec} second(s)...`);
        this.emit("reconnecting", timeoutSec);
        this.isReconnecting = true;
        setTimeout(
            (address, jobPostDesc) => {
                this.connect(address, jobPostDesc);
            },
            timeoutSec * 1000,
            this.address,
            this.jobPostDesc
        );
    }

    public async connect(address: string | WebSocket | null | undefined, jobPostDesc?: any): Promise<void> {
        if (address == null) {
            logger.error(`Master address=${address} is invalid. Specify master address in settings if connecting directly.`);
            return;
        }

        if (this.connectionState === MasterConnectionState.Connected || this.connectionState === MasterConnectionState.Connecting) {
            return;
        }

        this.isReconnecting = false;
        this.canReconnect = true;
        this.changeConnectionState(MasterConnectionState.Connecting);
        this.address = address;

        const msg = config.MSG ? config.MSG : randombytes(4).toString("hex");

        const listeners = (): void => {
            this.getWire().on("warning", info => {
                logger.warn(info.data.message);
                this.node.emit("warning", info.data.message);
            });
            this.getWire().on("statistics", info => {
                logger.info(
                    // tslint:disable-next-line:max-line-length
                    `Received statistics: downloaded=${info.data.downloaded}, uploaded=${info.data.uploaded}, online for ${info.data.time.hours} hours, ${info.data.time.minutes} minutes, ${info.data.time.seconds} second(s).`
                );
                this.node.getStatistics().sync(info.data);
            });
            this.getWire().once("closed", info => {
                this._onClosed(info);
            });
            this.getWire().on("nodesFromMaster", async info => {
                // logger.info(`Received nodes data: node-ipv4=${info.data.ipv4}, node-ipv6=${info.data.ipv6}.`);

                const nodeInfo = new NodeInfo();

                const [externalIpv4, externalIpv6] = await Promise.all([nodeInfo.externalIpv4(), nodeInfo.externalIpv6()]);

                if (info.data.ipv4 === externalIpv4 || info.data.ipv6 === externalIpv6) {
                    return;
                } else {
                    for (const host of [info.data.ipv4, info.data.ipv6]) {
                        if (host !== undefined && host !== "") {
                            tcpp.ping({ address: host, attempts: 10, port: info.data.port ? info.data.port : 80 }, (err: any, res: any) => {
                                try {
                                    // ping time
                                    const sum = res.results.reduce((acc: number, curr: { time: number }) => acc + curr.time, 0);
                                    const avgTime = sum / res.results.length;

                                    this.node.getMaster().ping({
                                        host: host,
                                        time: Math.round(avgTime * 1e2) / 1e2,
                                        min: res.min.toFixed(4),
                                        max: res.max.toFixed(4),
                                        avg: res.avg.toFixed(4)
                                    });
                                } catch (err) {
                                    return;
                                }
                            });
                        }
                    }
                }
            });
            this.getWire().once("error", err => {
                logger.error("Could not connect to master", err);
                this.changeConnectionState(MasterConnectionState.Connecting);
                this.emit("error", err);
            });
            this.getWire()
                .handshakeResult()
                .then(info => {
                    if (this.connectionState !== MasterConnectionState.Connecting) {
                        return;
                    }
                    this.registerEvents();
                    this.changeConnectionState(MasterConnectionState.Connected);
                    process.nextTick(() => {
                        this.emit("connected", info);
                    });
                })
                .catch(info => {
                    if (this.connectionState !== MasterConnectionState.Connecting) {
                        return;
                    }
                    this.changeConnectionState(MasterConnectionState.Disconnected);
                });
        };
        const isSsl = this.node
            .getSettings()
            .getScope("ssl")
            .get("isEnabled");
        const domain = this.node.getSettings().get("domain");
        const airdropAddress = this.node
            .getSettings()
            .getScope("blockchain")
            .get("airdropAddress");
        const nodeMetadata: NodeMetadata = {
            nodeId: this.node.getSettings().get("nodeId"),
            interface: this.node.opts.interface,
            connections: {
                ws:
                    isSsl === false &&
                    this.node
                        .getSettings()
                        .getScope("sockets")
                        .getScope("ws")
                        .get("isEnabled")
                        ? this.node
                              .getSettings()
                              .getScope("sockets")
                              .getScope("ws")
                              .get("port")
                        : null,
                wss:
                    isSsl === true &&
                    this.node
                        .getSettings()
                        .getScope("sockets")
                        .getScope("ws")
                        .get("isEnabled")
                        ? this.node
                              .getSettings()
                              .getScope("sockets")
                              .getScope("ws")
                              .get("port")
                        : null,
                webrtc:
                    this.node
                        .getSettings()
                        .getScope("sockets")
                        .getScope("wrtc")
                        .get("isEnabled") === true
                        ? this.node
                              .getSettings()
                              .getScope("sockets")
                              .getScope("wrtc")
                              .get("controlPort")
                        : null
            },
            domain: domain != null ? domain : undefined,
            version: Node.VERSION,
            // TODO: Wallet address is mandatory, unless user does not care about reward. Needs discussion.
            airdropAddress: airdropAddress
        };

        if (
            this.node
                .getSettings()
                .getScope("blockchain")
                .get("isEnabled")
        ) {
            if (!jobPostDesc) {
                throw new Error("Value of 'jobPostDescription' is invalid.");
            }
            this.jobPostDesc = jobPostDesc;
            const signedMsg = await this.node.getWallet().signMessage(msg);
            const workOrderAddress = this.node
                .getSettings()
                .getScope("blockchain")
                .get("workOrderAddress");
            const blockchainMetadata: NodeBlockchainMetadata = {
                msg: msg,
                msgSigned: signedMsg,
                ...nodeMetadata,
                jobPostAddress: this.jobPostDesc.jobPostAddress,
                workOrderAddress: workOrderAddress,
                walletAddress: this.node.getWallet().getOwnerAddress()
            };
            logger.info("Sending metadata:", blockchainMetadata);
            this.wire = new Wire<NodeBlockchainMetadata, MasterBlockchainMetadata>(
                // TODO: Inspect this "as".
                this.address as string,
                blockchainMetadata,
                async receivedMetadata => {
                    if (!this.jobPostDesc) {
                        throw new Error("Value of 'jobPostDescription' is invalid.");
                    }
                    logger.info(`Received metadata`, receivedMetadata);
                    const recoveredAddress = this.node.getWallet().recoverAddress(receivedMetadata.msg, receivedMetadata.msgSigned);
                    return this.jobPostDesc.employerWalletAddress === recoveredAddress;
                }
            );
            listeners();
        } else {
            logger.info("Skip blockchain, connect straight to master...");
            logger.info("Sending node metadata:", nodeMetadata);
            this.wire = new Wire<NodeMetadata, MasterMetadata>(
                this.address as string,
                nodeMetadata,
                async () =>
                    new Promise<boolean>(resolve => {
                        resolve(true);
                    })
            );
            listeners();
        }
    }

    public nodeSystem(params: NodeInfoData): void {
        if (this.getWire().isReady()) {
            // logger.info(`Notifying master on changed system information:`, params);
            this.getWire().nodeSystemData(params);
        }
    }

    public ping(params: PingData): void {
        if (this.getWire().isReady()) {
            // logger.info(`Ping:`, params);
            this.getWire().pingData(params);
        }
    }

    private _onClosed(info: ClosedData): void {
        this.changeConnectionState(MasterConnectionState.Disconnected);
        if (info.reason === "") {
            info.reason = Helpers.webSocketCloseCodeToReason(info.code);
        }
        logger.info("Connection with master closed", info);
        if (
            info.wasClean === false ||
            (info.code !== WebSocketCloseEvent.NormalClosure && info.code !== WebSocketCloseEvent.ServiceRestarting)
        ) {
            this.emit("error", new Error(info.reason), info.code === 1002 ? 60 : undefined);
        } else {
            this.emit("closed", info);
        }
    }

    public requested(missingPiece: number, infoHash: string): void {
        this.getWire().requested(missingPiece, infoHash);
    }

    public async disconnect(doRestart = false): Promise<void> {
        this.canReconnect = false;
        if (this.wire == null) {
            return;
        }
        if (!this.getWire().isReady()) {
            return;
        }
        if (doRestart) {
            this.getWire().close(1012, "The server is terminating the connection because it is restarting.");
        } else {
            this.getWire().close(1000, "Normal closure.");
        }
    }

    public async close(): Promise<void> {
        if (this.connectionState === MasterConnectionState.Disconnected) {
            logger.warn("Node is not connected to master.");
            return;
        }
        this.changeConnectionState(MasterConnectionState.Disconnected);

        return new Promise<void>((resolve, reject) => {
            if (this.connectionState === MasterConnectionState.Connected) {
                this.getWire().close(1000, "Normal disconnect.");
                this._onClosed({
                    code: 100,
                    wasClean: true,
                    reason: "Normal disconnect."
                });
                resolve();
            } else if (this.connectionState === MasterConnectionState.Connecting) {
                this.on("connected", () => {
                    this.getWire().close(1000, "Normal disconnect.");
                    this._onClosed({
                        code: 100,
                        wasClean: true,
                        reason: "Normal disconnect."
                    });
                    resolve();
                });
            } else {
                // throw new Error("called close on not connected or connecting wire")
                resolve();
            }
        });
    }

    public uploaded(infoHash: string, ip: string, bandwidth: number): void {
        if (!this.getWire().isReady()) {
            logger.warn("uploaded() called when not connected to master...");
            return;
        }
        logger.debug(`Uploaded info-hash=${infoHash}, ip=${ip}, bandwidth=${bandwidth}.`);
        this.getWire().uploaded(infoHash, ip, bandwidth);
    }

    public downloaded(infoHash: string, ip: string, bandwidth: number): void {
        if (!this.getWire().isReady()) {
            logger.warn("downloaded() called when not connected to master...");
            return;
        }
        logger.debug(`Downloaded info-hash=${infoHash}, ip=${ip}, bandwidth=${bandwidth}.`);
        this.getWire().downloaded(infoHash, ip, bandwidth);
    }

    public storage(params: StorageData): void {
        if (this.getWire().isReady()) {
            logger.info(`Notifying master on changed storage:`, params);
            this.getWire().storageData(params);
        }
    }

    /**
     * Send bandwidth statistics. Since bandwidth collection can take time and wire can be gone, make it skippable if not ensured.
     */
    public bandwidth(params: BandwidthData, skippable = false): void {
        if (skippable && (this.wire == null || this.wire.isReady() === false)) {
            return;
        }

        if (this.getWire().isReady()) {
            logger.info(`Notifying master on changed bandwidth:`, params);
            this.getWire().bandwidthData(params);
        }
    }

    public seeding(infoHashes: string[]): void {
        if (this.getWire().isReady()) {
            logger.info(`Notifying master that delivering ${infoHashes.length} content(s)=${infoHashes}.`);
            this.getWire().seeding(infoHashes);
        }
    }

    public isConnected(): boolean {
        return this.connectionState === MasterConnectionState.Connected;
    }

    public signedRequest(params: SignedRequest): void {
        logger.info(`Notifying master on signed request:`, params);
        this.getWire().signedRequest(params);
    }

    private registerEvents(): void {
        try {
            this.getWire().on("signedRequest", info => {
                logger.info(`Master sent signed-request:`, info.data);
                this.emit("signedRequest", info);
            });
            this.getWire().on("workOrder", info => {
                logger.info(`Master sent work-order-address=${info.data.address}.`);
                this.emit("workOrder", info);
            });
            this.getWire().on("clear", async info => {
                this.emit("clear", info);
                // Clear everything if info resolves to false.
                const infoHashes: string[] =
                    info.data.infoHashes.length === 0 ? this.node.getContentsClient().getInfoHashes() : info.data.infoHashes;
                for (const infoHash of infoHashes) {
                    await this.node.getContentsClient().remove(infoHash);
                }
                this.getWire().cleared(infoHashes);
            });
            this.getWire().on("seed", async info => {
                this.emit("seed", info);
                const metadata = info.data.metadata;
                if (this.node) {
                    if (!metadata || !metadata.infoHash || !metadata.pieces) {
                        return logger.warn("Cannot add to metadata store invalid metadadata, info = ", info);
                    }
                    logger.info(`metadata add: infoHash = ${metadata.infoHash}, pieces = ${metadata.pieces}`);
                    // TODO: move log to metadata store
                    await this.node.getContentsClient().add(metadata);
                } else {
                    logger.info("Node or contents client is undefined.");
                }
            });
            this.getWire().on("response", info => {
                this.emit("response", info);
            });
            if (this.node != null && this.node.getClientSockets() != null) {
                this.node.getClientSockets().on("resourceSent", info => {
                    try {
                        logger.debug(`Client sockets 'uploaded' event, chunk-size=${info.resource.size}.`);
                        this.getWire().uploaded(info.resource.infoHash, info.ip, info.resource.size);
                    } catch (err) {
                        logger.warn("Could not send uploaded stats to master", err);
                    }
                });
            }
        } catch (er) {
            logger.warn("Registered event failure", er);
        }
    }

    public getWire(): Wire<NodeBlockchainMetadata, MasterBlockchainMetadata> | Wire<NodeMetadata, MasterMetadata> {
        if (this.wire == null) {
            throw new Error("Wire is invalid.");
        }
        return this.wire;
    }

    public error(error: Error): void {
        this.emit("error", error);
    }

    private changeConnectionState(connectionState: MasterConnectionState): void {
        if (connectionState === this.connectionState) {
            return;
        }

        this.connectionState = connectionState;
        this.emit("connectionStateChange", this.connectionState);
    }
}
