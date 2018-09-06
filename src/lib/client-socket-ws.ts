import EventEmitter from "events";
import WebSocket from "ws";
import fs from "fs";
import http from "http";
import https from "https";
import randombytes from "randombytes";
import { Server as HttpServer } from "http";
import { Server as HttpsServer } from "https";

import logger from "./logger";
import { Node } from "../index";

export interface ClientSocketWsOptions {
    ip: string;
    port: number;
    ssl: boolean;
    ssl_key: string;
    ssl_cert: string;
    ssl_ca: string;
}

export class ClientSocketWs extends EventEmitter {
    public ssl: any;
    public port: any;
    public ip: any;
    public _node: Node;
    public server: HttpServer | HttpsServer;
    public type: string = "ws";
    public wss: WebSocket.Server;
    public info: any;
    public queue: Array<any>;
    public _queueInterval: any;
    public opts: ClientSocketWsOptions;

    constructor(node: Node, port: any, ip: any, opts: ClientSocketWsOptions) {
        super();
        this.ssl = opts != null && opts.ssl === true;
        this.opts = opts;
        this.port = port || node.settings.get(node.settings.Options.wsPort);
        this.ip = ip || "0.0.0.0";
        this._node = node;

        this.server =
            this.ssl === true
                ? https.createServer({
                      key: fs.readFileSync(opts.ssl_key),
                      cert: fs.readFileSync(opts.ssl_cert),
                      ca: fs.readFileSync(opts.ssl_ca)
                  })
                : (this.server = http.createServer());
        this.info = null;
        this.queue = [];

        this.server.on("error", (err: any) => {
            if (err.code === "EADDRINUSE") {
                // handles wss.on("error")
            } else {
                throw new err(); // to be discovered
            }
        });

        this.wss = new WebSocket.Server({ server: this.server });

        this.wss.on("connection", (ws: any, req: any) => {
            ws._debugId = randombytes(4).toString("hex");
            ws.ip = ws._socket.remoteAddress.replace(/^::ffff:/, "");
            logger.info(`[${ws._debugId}] ip=${ws.ip} connected, clients=${this.wss.clients.size}`);
            this.emit("connections", this.wss.clients.size);
            ws.on("message", (params: any) => {
                try {
                    params = JSON.parse(params);
                    const piece = params.piece;
                    const offset = params.offset;
                    const length = params.length;
                    const infoHash = params.infoHash;
                    // logger.info(`[${ws._debugId}] request infoHash=${infoHash} index=${piece} offset=${offset} length=${length}`)
                    this.handleMessage(ws, params);
                } catch (e) {
                    logger.info(`[${ws._debugId}] bad request`, e);
                }
            });
            ws.on("error", (error: any) => {
                logger.info(`[${ws._debugId}] disconnected (error), clients=${this.wss.clients.size}`);
                logger.error(`[${ws._debugId}]`, error);
                this.emit("connections", this.wss.clients.size);
                this.handleError(error);
            });
            ws.on("close", (error: any) => {
                logger.info(`[${ws._debugId}] disconnected, clients=${this.wss.clients.size}`);
                logger.info(`[${ws._debugId}] closed`);
                this.emit("connections", this.wss.clients.size);
            });
        });
        this.wss.on("error", err => {
            logger.error("Coult not create WebSocket server", err);
            this.emit("error", err);
        });

        this._queueInterval = 3000;

        // TODO: move to common.
        // group resources to save network bandwith and don"t spam master
        setInterval(() => {
            const _queue = this.queue.slice();
            this.queue = [];
            const groups: any = {};
            if (_queue.length === 0) return;
            _queue.forEach((info: any) => {
                const key = `${info.resource.infoHash}:${info.ip}`;
                if (!groups[key])
                    groups[key] = {
                        type: "ws",
                        ip: info.ip,
                        resource: {
                            infoHash: info.resource.infoHash,
                            size: 0
                        }
                    };
                groups[key].resource.size += parseFloat(info.resource.size);
            });
            Object.keys(groups).forEach(key => {
                const info = groups[key];
                const client = `client-ip=${info.ip}`;
                const resource = `resource=${info.resource.infoHash}`;
                const size = `size=${info.resource.size.toFixed(4)}`;
                const sizeMB = `size=${info.resource.size.toFixed(4) / 1e6}`;
                logger.info(`WS sent to ${client} ${resource} ${sizeMB}`);
                this.emit("resourceSent", groups[key]);
            });
        }, this._queueInterval);
    }

    listen() {
        return new Promise<void>((resolve, reject) => {
            this.server.listen(this.port, this.ip, (err: any) => {
                if (err) {
                    reject(err);
                    return;
                }

                this.info = this.server.address();
                this.emit("listening", {
                    type: this.type,
                    port: this.info.port,
                    ip: this.info.address,
                    family: this.info.family,
                    ssl: this.ssl
                });
                logger.info(
                    `Listening for clients connections type=${this.ssl === true ? "wss" : "ws"} ip=${this.info.address} port=${
                        this.info.port
                    } family=${this.info.family}`
                );
                resolve();
            });
        });
    }

    handleMessage(ws: any, params: any) {
        const piece = params.piece;
        const offset = params.offset;
        const length = params.length;
        const infoHash = params.infoHash;

        if (typeof piece === "undefined" || typeof offset === "undefined" || typeof infoHash === "undefined") {
            logger.error(`[${ws._debugId}] bad request infoHash=${infoHash} index=${piece} offset=${offset} length=${length}`);
            return;
        }

        if (!this._node || !this._node.contentsClient) return;

        const content = this._node.contentsClient.get(infoHash);

        if (typeof content === "undefined") {
            logger.error(`[${ws._debugId}] 404 response infoHash=${infoHash}`);
            return;
        }

        content.getResponseBuffer(piece, offset, length, (resBuff: any) => {
            // debug(`[${ws._debugId}] response infoHash=${infoHash} index=${piece} offset=${offset} length=${dataBuf.length}`)
            queueEvent(this, ws.ip, infoHash, resBuff.length);
            try {
                ws.send(resBuff);
                content.emit("uploaded", resBuff.length);
            } catch (e) {
                logger.warn("Send content", e); // TODO: log property or just ignore.
            }
        });

        // TODO: move to common.
        function queueEvent(self: any, ip: any, infoHash: any, size: any) {
            const info = {
                ip: ip,
                resource: {
                    infoHash,
                    size
                }
            };
            self.queue.push(info);
        }

        function responseBuffer(part: any, offset: any, infoHash: any, dataBuf: any) {
            const partBuf = Buffer.allocUnsafe(4);
            const offsetBuf = Buffer.allocUnsafe(4);
            partBuf.writeUInt32BE(part, 0);
            offsetBuf.writeUInt32BE(offset, 0);
            const infoHashBuf = Buffer.from(infoHash, "hex");
            const buf = Buffer.concat([partBuf, offsetBuf, infoHashBuf, dataBuf]);
            return buf;
        }
    }

    handleError(err: Error) {
        throw new Error(err.message);
    }

    public close(): Promise<any> {
        const _close = (resolve: any) => {
            this.wss.clients.forEach((ws: any) => ws.close());
            this.server.close(() => {
                const info = {
                    type: this.type,
                    port: this.info.port,
                    ip: this.info.address,
                    family: this.info.family
                };
                this.emit("closed", info);
                resolve(info);
            });
        };

        return new Promise((resolve, reject) => {
            if (this.server.listening) {
                _close(resolve);
            } else {
                this.on("listening", () => {
                    _close(resolve);
                });
            }
        });
    }
}
