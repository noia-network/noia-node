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
    Statistics
} from "@noia-network/protocol";
import { ContentTransferer, ContentTransfererEvents } from "@noia-network/node-contents-client";
import { ProtocolEvent, Handshake, ClosedData, Clear, Seed, Response, NodeMetadata } from "@noia-network/protocol";

import { Helpers } from "./helpers";
import { Node } from "./node";
import { logger } from "./logger";
import { JobPostDescription } from "./wallet";
import { WebSocketCloseEvent } from "./contracts";

const config = Helpers.getConfig();

export enum MasterState {
    /**
     * Node is connect to master node.
     */
    Connected = "connected",
    /**
     * Node is connecting from master node.
     */
    Connecting = "connecting",
    /**
     * Node is connecting to master node.
     */
    Disconnected = "disconnected"
}

interface MasterEvents extends ContentTransfererEvents {
    clear: (data: ProtocolEvent<Clear>) => this;
    closed: (data: ClosedData | undefined) => this;
    connected: (data: ProtocolEvent<Handshake>) => this;
    error: (error: Error) => this;
    response: (data: ProtocolEvent<Response>) => this;
    seed: (data: ProtocolEvent<Seed>) => this;
    workOrder: (data: ProtocolEvent<WorkOrder>) => this;
    signedRequest: (data: ProtocolEvent<SignedRequest>) => this;
    statistics: (data: ProtocolEvent<Statistics>) => this;
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
    public state: MasterState = MasterState.Disconnected;
    public address?: string | WebSocket;
    public jobPostDesc?: JobPostDescription;
    public canReconnect: boolean = false;

    public setAddress(address: string): void {
        if (this.state === MasterState.Connecting) {
            this.emit("error", new Error("Cannot change master address while connecting."));
        }
        if (this.state === MasterState.Connected) {
            this.emit("error", new Error("Cannot change master address while connected to master."));
        }
        this.address = address;
    }

    public reconnect(): void {
        if (!this.address) {
            logger.warn("...address unspecified, reconnect aborted");
            return;
        }
        if (!this.canReconnect) {
            logger.info("...reconnect to master skipped.");
            return;
        }

        this.connect(
            this.address,
            this.jobPostDesc
        );
    }

    public async connect(address: string | WebSocket | null, jobPostDesc?: JobPostDescription): Promise<void> {
        if (address == null) {
            logger.error(`Master address=${address} is invalid. Specify master address in settings if connecting directly.`);
            return;
        }

        if (this.state === MasterState.Connected || this.state === MasterState.Connecting) {
            return;
        }

        this.canReconnect = true;
        this.state = MasterState.Connecting;
        this.address = address;

        const msg = config.MSG ? config.MSG : randombytes(4).toString("hex");

        const listeners = (): void => {
            this.getWire().on("warning", info => {
                logger.warn(info.data.message);
                this.node.emit("warning", info.data.message);
            });
            this.getWire().once("closed", info => {
                this._onClosed(info);
            });
            this.getWire().once("error", err => {
                logger.error("Could not connect to master", err);
                this.state = MasterState.Connecting;
                this.emit("error", err);
            });

            this.getWire()
                .handshakeResult()
                .then(info => {
                    if (this.state !== MasterState.Connecting) {
                        return;
                    }
                    this.registerEvents();
                    this.state = MasterState.Connected;
                    process.nextTick(() => {
                        this.emit("connected", info);
                    });
                })
                .catch(info => {
                    if (this.state !== MasterState.Connecting) {
                        return;
                    }
                    this.state = MasterState.Disconnected;
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

    private _onClosed(info: ClosedData): void {
        this.state = MasterState.Disconnected;
        logger.info("Connection with master closed", info);
        if (
            info.wasClean === false ||
            (info.code !== WebSocketCloseEvent.NormalClosure && info.code !== WebSocketCloseEvent.ServiceRestarting)
        ) {
            this.emit("error", new Error(info.code.toString()));
        } else {
            this.emit("closed", info);
        }
    }

    public requested(missingPiece: number, infoHash: string): void {
        this.getWire().requested(missingPiece, infoHash);
    }

    public disconnect(doRestart = false): void {
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
        if (this.state === MasterState.Disconnected) {
            logger.warn("Node is not connected to master.");
            return;
        }
        this.state = MasterState.Disconnected;

        return new Promise<void>((resolve, reject) => {
            if (this.state === MasterState.Connected) {
                this.getWire().close(1000, "Normal disconnect.");
                this._onClosed({
                    code: 100,
                    wasClean: true,
                    reason: "Normal disconnect."
                });
                resolve();
            } else if (this.state === MasterState.Connecting) {
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

    public uploaded(infoHash: string, bandwidth: number): void {
        if (!this.getWire().isReady()) {
            logger.warn("uploaded() called when not connected to master...");
            return;
        }
        this.getWire().uploaded(infoHash, bandwidth);
    }

    public downloaded(infoHash: string, bandwidth: number): void {
        if (!this.getWire().isReady()) {
            logger.warn("downloaded() called when not connected to master...");
            return;
        }
        this.getWire().downloaded(infoHash, bandwidth);
    }

    public storage(params: StorageData): void {
        if (this.getWire().isReady()) {
            logger.info(`Notifying master on changed storage:`, params);
            this.getWire().storageData(params);
        }
    }

    public bandwidth(params: BandwidthData): void {
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
        return this.state === MasterState.Connected;
    }

    public signedRequest(params: SignedRequest): void {
        logger.info(`Notifying master on signed request:`, params);
        this.getWire().signedRequest(params);
    }

    private registerEvents(): void {
        try {
            this.getWire().on("statistics", info => {
                logger.info(
                    `Master send statistics: time=${info.data.time}, downloaded=${info.data.downloaded}, uploaded=${info.data.uploaded}.`
                );
                this.emit("statistics", info);
            });
            this.getWire().on("signedRequest", info => {
                logger.info(`Master sent signed-request:`, info.data);
                this.emit("signedRequest", info);
            });
            this.getWire().on("workOrder", info => {
                logger.info(`Master sent work-order-address=${info.data.address}.`);
                this.emit("workOrder", info);
            });
            this.getWire().on("clear", info => {
                this.emit("clear", info);
                // Clear everything if info resolves to false.
                const infoHashes: string[] =
                    info.data.infoHashes.length === 0 ? this.node.getContentsClient().getInfoHashes() : info.data.infoHashes;
                infoHashes.forEach(infoHash => this.node.getContentsClient().remove(infoHash));
                this.getWire().cleared(infoHashes);
            });
            this.getWire().on("seed", info => {
                this.emit("seed", info);
                const metadata = info.data.metadata;
                if (this.node) {
                    if (!metadata || !metadata.infoHash || !metadata.pieces) {
                        return logger.warn("Cannot add to metadata store invalid metadadata, info = ", info);
                    }
                    logger.info(`metadata add: infoHash = ${metadata.infoHash}, pieces = ${metadata.pieces}`);
                    // TODO: move log to metadata store
                    this.node.getContentsClient().add(metadata);
                } else {
                    logger.info("Node or contents client is undefined.");
                }
            });
            this.getWire().on("response", info => {
                this.emit("response", info);
            });
            if (this.node && this.node.getClientSockets()) {
                this.node.getClientSockets().on("resourceSent", info => {
                    try {
                        logger.debug(`Client sockets 'uploaded' event, chunk-size=${info.resource.size}.`);
                        this.getWire().uploaded(info.resource.infoHash, info.resource.size);
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
}
