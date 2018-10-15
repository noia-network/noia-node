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
    BandwidthData
} from "@noia-network/protocol";

import { Helpers } from "./helpers";
import { Node } from "./node";
import { SettingsEnum } from "./settings";
import { StatisticsEnum } from "./statistics";
import { logger } from "./logger";
import { ProtocolEvent, Handshake, ClosedData, Clear, Seed, Response, NodeMetadata } from "@noia-network/protocol";
import { ContentTransferer, ContentTransfererEvents } from "@noia-network/node-contents-client";
import { JobPostDescription } from "./wallet";
import { WebSocketCloseEvent } from "./contracts";

const config = Helpers.getConfig();

interface MasterEvents extends ContentTransfererEvents {
    clear: (data: ProtocolEvent<Clear>) => this;
    closed: (data: ClosedData | undefined) => this;
    connected: (data: ProtocolEvent<Handshake>) => this;
    error: (error: Error) => this;
    response: (data: ProtocolEvent<Response>) => this;
    seed: (data: ProtocolEvent<Seed>) => this;
    workOrder: (data: ProtocolEvent<WorkOrder>) => this;
    signedRequest: (data: ProtocolEvent<SignedRequest>) => this;
}

const MasterEmitter: { new (): StrictEventEmitter<EventEmitter, MasterEvents> } = EventEmitter;

export class Master extends MasterEmitter implements ContentTransferer {
    public address?: string | WebSocket;
    public jobPostDesc?: JobPostDescription;
    public connected: boolean = false;
    public destroyed: boolean = false;
    public connecting: boolean = false;
    public canReconnect: boolean = false;
    private wire: undefined | Wire<NodeBlockchainMetadata, MasterBlockchainMetadata> | Wire<NodeMetadata, MasterMetadata>;

    constructor(private readonly node: Node) {
        super();

        setInterval(() => {
            const totalTimeConnected = this.node.statistics.statistics[StatisticsEnum.totalTimeConnected];
            if (this.connected) {
                this.node.statistics.update(StatisticsEnum.totalTimeConnected, totalTimeConnected + 1);
            }
        }, 1 * 1000);
    }

    public setAddress(address: string): void {
        if (this.connecting) {
            this.emit("error", new Error("cannot change address while connecting to master"));
        }
        if (this.connected) {
            this.emit("error", new Error("cannot change address while connected to master"));
        }
        if (this.destroyed) {
            return;
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

    public async connect(address: string | WebSocket, jobPostDesc?: JobPostDescription): Promise<void> {
        const skipBlockchain = this.node.settings.options[SettingsEnum.skipBlockchain];

        if (!address) {
            throw new Error("master address null or undefined");
        }

        if (this.connected || this.destroyed || this.connecting) {
            return;
        }
        this.canReconnect = true;
        this.connecting = true;
        this.address = address;

        const msg = config.MSG ? config.MSG : randombytes(4).toString("hex");

        const listeners = (): void => {
            this.getWire().on("warning", info => {
                logger.warn(info.data.message);
            });
            this.getWire().once("closed", info => {
                this._onClosed(info);
            });
            this.getWire().once("error", err => {
                logger.error("Could not connect to master", err);
                this.connecting = false;
                this.emit("error", err);
            });

            this.getWire()
                .handshakeResult()
                .then(info => {
                    if (!this.connecting) {
                        return;
                    }
                    this.connecting = false;
                    this.registerEvents();
                    this.connected = true;
                    process.nextTick(() => {
                        this.emit("connected", info);
                    });
                })
                .catch(info => {
                    if (!this.connecting) {
                        return;
                    }
                    this.connecting = false;
                });
        };

        const isSsl = this.node.settings.options[SettingsEnum.ssl];
        const nodeMetadata: NodeMetadata = {
            nodeId: this.node.settings.options[SettingsEnum.nodeId],
            interface: this.node.settings.options[SettingsEnum.isHeadless] ? "cli" : "gui",
            connections: {
                ws:
                    isSsl === false && this.node.settings.options[SettingsEnum.ws] === true
                        ? this.node.settings.options[SettingsEnum.wsPort]
                        : null,
                wss:
                    isSsl === true && this.node.settings.options[SettingsEnum.ws] === true
                        ? this.node.settings.options[SettingsEnum.wsPort]
                        : null,
                webrtc:
                    this.node.settings.options[SettingsEnum.wrtc] === true ? this.node.settings.options[SettingsEnum.wrtcControlPort] : null
            },
            domain: this.node.settings.options[SettingsEnum.domain],
            version: this.node.VERSION,
            walletAddress: this.node.settings.options[SettingsEnum.walletAddress]
        };

        if (!skipBlockchain) {
            if (!jobPostDesc) {
                throw new Error("Value of 'jobPostDescription' is invalid.");
            }
            this.jobPostDesc = jobPostDesc;
            const signedMsg = await this.node.wallet.signMessage(msg);
            const blockchainMetadata: NodeBlockchainMetadata = {
                msg: msg,
                msgSigned: signedMsg,
                ...nodeMetadata,
                jobPostAddress: this.jobPostDesc.jobPostAddress,
                workOrderAddress: this.node.settings.options[SettingsEnum.workOrder]
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
                    const recoveredAddress = this.node.wallet.recoverAddress(receivedMetadata.msg, receivedMetadata.msgSigned);
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
        this.connected = false;
        this.connecting = false;
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
        if (this.destroyed) {
            throw new Error("master connection is already destroyed");
        }
        this.destroyed = true;

        return new Promise<void>((resolve, reject) => {
            if (this.connected) {
                this.getWire().close(1000, "Normal disconnect.");
                this._onClosed({
                    code: 100,
                    wasClean: true,
                    reason: "Normal disconnect."
                });
                resolve();
            } else if (this.connecting) {
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

    public uploaded(infoHash: string, bandwidth: number, ip: string): void {
        if (!this.getWire().isReady()) {
            logger.warn("uploaded() called when not connected to master...");
            return;
        }
        this.getWire().uploaded(infoHash, bandwidth, ip);
    }

    public storage(params: StorageData): void {
        if (this.getWire().isReady()) {
            logger.info(`Notifying master on changed storage:`, params);
            this.getWire().storageData(params);
        }
    }

    public bandwidth(params: BandwidthData): void {
        if (this.wire == null) {
            // Ignore since we have set interval inside node.ts.
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
        return this.connected;
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
            this.getWire().on("clear", info => {
                this.emit("clear", info);
                // Clear everything if info resolves to false.
                const infoHashes: string[] =
                    info.data.infoHashes.length === 0 ? this.node.contentsClient.getInfoHashes() : info.data.infoHashes;
                infoHashes.forEach(infoHash => this.node.contentsClient.remove(infoHash));
                this.getWire().cleared(infoHashes);
            });
            this.getWire().on("seed", info => {
                this.emit("seed", info);
                const metadata = info.data.metadata;
                if (this.node && this.node.contentsClient) {
                    if (!metadata || !metadata.infoHash || !metadata.pieces) {
                        return logger.warn("Cannot add to metadata store invalid metadadata, info = ", info);
                    }
                    logger.info(`metadata add: infoHash = ${metadata.infoHash}, pieces = ${metadata.pieces}`);
                    // TODO: move log to metadata store
                    this.node.contentsClient.add(metadata);
                } else {
                    logger.info("node or contentsClient undefined");
                }
            });
            this.getWire().on("response", info => {
                this.emit("response", info);
            });
            if (this.node && this.node.clientSockets) {
                this.node.clientSockets.on("resourceSent", info => {
                    try {
                        this.getWire().uploaded(info.resource.infoHash, info.resource.size, info.ip);
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
