import EventEmitter from "events";
import WebSocket from "ws";
import Wire from "@noia-network/protocol";
import path from "path";
import randombytes from "randombytes";

const dotenv = require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });
import Node from "../index";
import logger from "./logger";
const config = dotenv.error ? {} : dotenv.parsed;

class Master extends EventEmitter {
    public address: undefined | null | string | WebSocket;
    public employerAddress: undefined | null | string;
    public connected: boolean = false;
    public destroyed: boolean = false;
    public connecting: boolean = false;
    public canReconnect: boolean = false;
    public _wire: any;
    public _node: Node;

    constructor(node: any) {
        super();

        this.address = null;

        this._wire = null;
        this._node = node;

        setInterval(() => {
            const totalTimeConnected = this._node.statistics.get(this._node.statistics.Options.totalTimeConnected);
            if (this.connected) {
                this._node.statistics.update(this._node.statistics.Options.totalTimeConnected, totalTimeConnected + 1);
            }
        }, 1 * 1000);
    }

    setAddress(address: any) {
        if (this.connecting) this.emit("error", new Error("cannot change address while connecting to master"));
        if (this.connected) this.emit("error", new Error("cannot change address while connected to master"));
        if (this.destroyed) return;

        this.address = address;
    }

    reconnect() {
        const self = this;

        if (!self.address) {
            logger.warn("...address unspecified, reconnect aborted");
            return;
        }
        if (!self.canReconnect) {
            logger.info("...reconnect to master skipped.");
            return;
        }

        self.connect(
            self.address,
            self.employerAddress
        );
    }

    connect(address: string | WebSocket, employerAddress: undefined | null | string) {
        const self = this;
        const skipBlockchain = this._node.settings.get(this._node.settings.Options.skipBlockchain);

        if (!address) {
            throw new Error("master address null or undefined");
        }
        if (!employerAddress && !skipBlockchain) {
            throw new Error("employerAddress null or undefined");
        }
        if (self.connected || self.destroyed || self.connecting) return;
        self.canReconnect = true;
        self.connecting = true;
        self.address = address;
        self.employerAddress;

        logger.info("Connecting to master", self.address);
        const msg = config.MSG ? config.MSG : randombytes(4).toString("hex");
        if (!skipBlockchain) {
            this._node.wallet.signMessage(msg).then((signedMsg: string) => {
                self._wire = new Wire(
                    // TODO: Inspect this "as".
                    self.address as string | WebSocket,
                    msg,
                    signedMsg,
                    (fromMsg: string, fromMsgSigned: string) => {
                        logger.info(`Received signed message`, { fromMsg, fromMsgSigned });
                        return new Promise(resolve => {
                            const recoveredAddress = this._node.wallet.recoverAddress(fromMsg, fromMsgSigned);
                            logger.info(`Comparing signatures`, {
                                employerAddress,
                                recoveredAddress,
                                result: employerAddress === recoveredAddress
                            });
                            const skipSignatureCheck = true; // TODO: add to options or fix it
                            if (skipSignatureCheck) {
                                resolve(true);
                            } else {
                                resolve(employerAddress === recoveredAddress);
                            }
                        });
                    },
                    this._node.settings.get(this._node.settings.Options.client),
                    this._node.VERSION
                );
                _listeners();
            });
        } else {
            logger.info("Skip blockchain, connect straight to master...");
            let nodeClientData: any = {};
            nodeClientData.info = {};
            if (this._node && this._node.settings) {
                nodeClientData.info["interface"] = this._node.settings.get(this._node.settings.Options.isHeadless) ? "terminal" : "gui";
                // If node public IP is empty or invalid, master should resolve it on its own
                nodeClientData.info["node_ip"] = this._node.settings.get(this._node.settings.Options.publicIp);
                // TODO: deprecate node_ws_port with next version.
                nodeClientData.info["node_ws_port"] = this._node.settings.get(this._node.settings.Options.wsPort);
                nodeClientData.info["connections"] = {
                    ws: this._node.settings.Options.ws != null ? this._node.settings.get(this._node.settings.Options.wsPort) : null,
                    webrtc:
                        this._node.settings.Options.wrtc != null
                            ? this._node.settings.get(this._node.settings.Options.wrtcControlPort)
                            : null
                };
                nodeClientData.info["node_domain"] = this._node.settings.get(this._node.settings.Options.domain);
                // TODO: should wallet address be send if blockchain is used?
                nodeClientData.info["node_wallet_address"] = this._node.settings.get(this._node.settings.Options.walletAddress);
            }
            logger.info("Creating wire...", nodeClientData);
            // TODO: handshake given public IP address?
            self._wire = new Wire(
                self.address,
                msg,
                nodeClientData,
                (fromMsg: string, fromMsgSigned: string) => {
                    return new Promise(resolve => {
                        resolve(true);
                    });
                },
                this._node.settings.get(this._node.settings.Options.nodeId),
                this._node.VERSION
            );
            _listeners();
        }

        function _listeners() {
            self._wire.once("warning", (info: any) => {
                logger.error(info.message);
            });
            self._wire.once("closed", (info: any) => {
                self._onClosed(info);
            });
            self._wire.once("error", (err: any) => {
                logger.error("Could not connect to master", err);
                self.emit("error", err);
            });
            self._wire
                .handshakeResult()
                .then((info: any) => {
                    if (!self.connecting) return;
                    self.connecting = false;
                    self._registerEvents();
                    self.connected = true;
                    process.nextTick(() => {
                        self.emit("connected", info);
                    });
                })
                .catch((info: any) => {
                    if (!self.connecting) return;
                    self.connecting = false;
                });
        }
    }

    _onClosed(info: any) {
        const self = this;

        self._wire = null;
        self.connected = false;
        self.connecting = false;
        logger.info("Connection with master closed", info);
        self.emit("closed", info);
    }

    disconnect() {
        const self = this;

        self.canReconnect = false;
        if (!self.connected) return;
        self._wire.close();
        self._wire = null;
    }

    close() {
        const self = this;

        if (self.destroyed) throw new Error("master connection is already destroyed");
        self.destroyed = true;

        return new Promise((resolve, reject) => {
            if (self.connected) {
                self._wire.close();
                self._onClosed(null);
                resolve();
            } else if (self.connecting) {
                self.on("connected", () => {
                    self._wire.close();
                    self._onClosed(null);
                    resolve();
                });
            } else {
                // throw new Error("called close on not connected or connecting wire")
                resolve();
            }
        });
    }

    uploaded(infoHash: any, bandwidth: any, host: any, port: any) {
        const self = this;
        self._wire.uploaded(infoHash, bandwidth, host, port);
    }

    seeding(infoHashes: any) {
        const self = this;
        logger.info(`Notifying master (${self._wire.address}) delivering ${infoHashes.length} content(s)=${infoHashes}`);
        self._wire.seeding(infoHashes);
    }

    _registerEvents() {
        try {
            const self = this;

            self._wire.on("clear", (info: any) => {
                self.emit("clear", info);
                const infoHashes = info.infoHashes.length === 0 ? Object.keys(self._node.contentsClient.getAll()) : info.infoHashes;
                infoHashes.forEach((infoHash: any) => self._node.contentsClient.remove(infoHash));
                self._wire.cleared(infoHashes);
            });
            self._wire.on("seed", (info: any) => {
                self.emit("seed", info);
                const metadata = info.metadata;
                if (self._node && self._node.contentsClient) {
                    if (!metadata || !metadata.infoHash || !metadata.pieces) {
                        return logger.warn("Cannot add to metadata store invalid metadadata, info = ", info);
                    }
                    logger.info(`metadata add: infoHash = ${metadata.infoHash}, pieces = ${metadata.pieces}`);
                    // TODO: move log to metadata store
                    self._node.contentsClient.metadataStore.add(metadata); // FIXME: mess
                } else {
                    logger.info("node or contentsClient undefined");
                }
            });
            self._wire.on("response", (info: any) => {
                self.emit("response", info);
            });

            if (self._node && self._node.clientSockets) {
                self._node.clientSockets.on("resourceSent", (info: any) => {
                    try {
                        self._wire.uploaded(info.resource.infoHash, info.resource.size, info.ip);
                    } catch (err) {
                        logger.warn("Could not send uploaded stats to master", err);
                    }
                });
            }
        } catch (er) {
            logger.warn("Registered event failure", er);
        }
    }
}

export = Master;
