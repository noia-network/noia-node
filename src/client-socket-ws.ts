import * as protobuf from "protobufjs";
import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import WebSocket from "ws";
import fs from "fs";
import http from "http";
import https from "https";
import randombytes from "randombytes";
import { AddressInfo } from "net";
import { Server as HttpServer } from "http";
import { Server as HttpsServer } from "https";

import { ClientSocketEvents, ResourceSent, SocketType, ClientRequestData } from "./contracts";
import { Content } from "@noia-network/node-contents-client/dist/content";
import { Node } from "./node";
import { Wire } from "@noia-network/protocol";
import { logger } from "./logger";

type ClientSocketEmitter = StrictEventEmitter<EventEmitter, ClientSocketEvents>;

export class ClientSocketWs extends (EventEmitter as { new (): ClientSocketEmitter }) {
    private contentResponseType?: protobuf.Type;
    private queueInterval: number = 3000;
    private readonly protocolPrefix: string;
    public queue: ResourceSent[] = [];
    public server: HttpServer | HttpsServer;
    public ssl: boolean;
    public type: SocketType = SocketType.Ws;
    public wss: WebSocket.Server;

    constructor(private readonly node: Node) {
        super();
        this.ssl = this.node
            .getSettings()
            .getScope("ssl")
            .get("isEnabled");
        this.protocolPrefix = this.ssl === true ? "WebSocket (secure)" : "WebSocket";

        // TODO: Refactor.
        protobuf.load(Wire.getProtoFilePath(), (err, root) => {
            if (err) {
                logger.error("Error has occured while loading protobuf:", err);
                return;
            }
            if (root == null) {
                logger.error("Error has occured while loading protobuf:", err);
                return;
            }
            this.contentResponseType = root.lookupType("ContentResponse");
        });

        const sslSettings = this.node.getSettings().getScope("ssl");
        const privateKeyPath = sslSettings.get("privateKeyPath");
        const crtPath = sslSettings.get("crtPath");
        const caBundlePath = sslSettings.get("caBundlePath");
        this.server =
            this.ssl === true && privateKeyPath != null && crtPath != null && caBundlePath != null
                ? https.createServer({
                      key: fs.readFileSync(privateKeyPath),
                      cert: fs.readFileSync(crtPath),
                      ca: fs.readFileSync(caBundlePath)
                  })
                : (this.server = http.createServer());

        this.server.on("error", err => {
            if (err.code === "EADDRINUSE") {
                // Do nothing.
            } else {
                // To be discovered.
                throw new Error(err.message);
            }
        });

        this.wss = new WebSocket.Server({ server: this.server });

        this.wss.on("connection", (ws, req) => {
            const debugId: string = randombytes(4).toString("hex");
            if (req.connection.remoteAddress == null) {
                logger.error("Could not determine remote address!");
                return;
            }
            const clientIp: string = req.connection.remoteAddress.replace(/^::ffff:/, "");
            logger.info(
                `${this.protocolPrefix} client client-id=${debugId} ip=${clientIp} connected, connected-clients=${this.wss.clients.size}.`
            );
            this.emit("connections", this.wss.clients.size);
            ws.on("message", (params: any) => {
                try {
                    params = JSON.parse(params);
                    // const piece = params.piece;
                    // const offset = params.offset;
                    // const length = params.length;
                    // const infoHash = params.infoHash;
                    // logger.info(`[${debugId}] request infoHash=${infoHash} index=${piece} offset=${offset} length=${length}`)
                    this.handleMessage(ws, params, clientIp, debugId);
                } catch (err) {
                    logger.info(`${this.protocolPrefix} client client-id=${debugId} bad request:`, err);
                }
            });
            ws.on("error", error => {
                logger.info(
                    `${this.protocolPrefix} client client-id=${debugId} disconnected (error), connected-clients=${this.wss.clients.size}.`
                );
                logger.error(`${this.protocolPrefix} client client-id=${debugId}:`, error);
                this.emit("connections", this.wss.clients.size);
                this.handleError(error);
            });
            ws.on("close", error => {
                logger.info(`${this.protocolPrefix} client client-id=${debugId} disconnected, connected-clients=${this.wss.clients.size}.`);
                this.emit("connections", this.wss.clients.size);
            });
        });
        this.wss.on("error", err => {
            logger.error("Coult not create WebSocket server", err);
            this.emit("error", err);
        });

        // TODO: move to common.
        // group resources to save network bandwith and don"t spam master
        setInterval(() => {
            const queue = this.queue.slice();
            this.queue = [];
            const groups: { [key: string]: ResourceSent } = {};
            if (queue.length === 0) {
                return;
            }
            queue.forEach(info => {
                const key = `${info.resource.infoHash}:${info.ip}`;
                if (!groups[key]) {
                    groups[key] = {
                        type: info.type,
                        ip: info.ip,
                        resource: {
                            infoHash: info.resource.infoHash,
                            size: 0
                        }
                    };
                }
                groups[key].resource.size += info.resource.size;
            });
            Object.keys(groups).forEach(key => {
                const info = groups[key];
                const client = `client-ip=${info.ip}`;
                const resource = `resource=${info.resource.infoHash}`;
                const size = `size=${info.resource.size.toFixed(4)}`;
                const sizeMB = `size=${info.resource.size.toFixed(4 / 1e6)}`;
                logger.info(`WS sent to ${client} ${resource} ${sizeMB}`);
                this.emit("resourceSent", groups[key]);
            });
        }, this.queueInterval);
    }

    public async listen(): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            this.server.listen(
                this.node
                    .getSettings()
                    .getScope("sockets")
                    .getScope("ws")
                    .get("port"),
                this.node
                    .getSettings()
                    .getScope("sockets")
                    .getScope("ws")
                    .get("ip"),
                (err: Error) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    const addressInfo = this.server.address() as AddressInfo;
                    this.emit("listening", {
                        type: this.type,
                        port: addressInfo.port,
                        ip: addressInfo.address,
                        family: addressInfo.family,
                        ssl: this.ssl
                    });
                    logger.info(
                        `Listening for type=${this.ssl === true ? "wss" : "ws"} clients connections: ip=${addressInfo.address} port=${
                            addressInfo.port
                        } family=${addressInfo.family}.`
                    );
                    resolve();
                }
            );
        });
    }

    private async handleMessage(ws: WebSocket, params: Partial<ClientRequestData>, ip: string, debugId: string): Promise<void> {
        if (this.contentResponseType == null) {
            logger.error("Property 'contentResponseType' is invalid.");
            return;
        }

        // const errMsg = this.contentResponseType.verify(payload);
        // if (errMsg) {
        //     throw Error(errMsg);
        // }

        if (params.index == null || params.offset == null || params.contentId == null) {
            const responseMsg = `${this.protocolPrefix} client client-id=${debugId} bad request content-id=${params.contentId} index=${
                params.index
            } offset=${params.offset} length=${0}.`;
            const msg = this.contentResponseType.create({
                status: 400,
                error: responseMsg
            });
            logger.error(responseMsg);
            this.response(ws, this.contentResponseType.encode(msg).finish());
            return;
        }

        const content = this.node.getContentsClient().get(params.contentId) as Content;
        if (content == null) {
            const responseMsg = `${this.protocolPrefix} client client-id=${debugId} 404 response content-id=${params.contentId}.`;
            const msg = this.contentResponseType.create({
                status: 404,
                error: responseMsg
            });
            logger.error(responseMsg);
            this.response(ws, this.contentResponseType.encode(msg).finish());
            return;
        }

        try {
            const response = await content.getContentData(params.index, params.offset, 0);
            // debug(`[${debugId}] response infoHash=${infoHash} index=${piece} offset=${offset} length=${dataBuf.length}`)
            queueEvent(this, ip, params.contentId, response.buffer.length);
            const msg = this.contentResponseType.create({
                data: {
                    contentId: params.contentId,
                    offset: params.offset,
                    index: params.index,
                    buffer: response.buffer
                },
                status: 200
            });
            this.response(ws, this.contentResponseType.encode(msg).finish());
            content.emit("uploaded", response.buffer.length);
        } catch (e) {
            // TODO: log property or just ignore.
            logger.warn("Error while sending content:", e);
        }

        // TODO: move to common.
        function queueEvent(self: ClientSocketWs, clientIp: string, infoHash: string, size: number): void {
            const info: ResourceSent = {
                type: SocketType.Ws,
                ip: clientIp,
                resource: {
                    infoHash,
                    size
                }
            };
            self.queue.push(info);
        }
    }

    public response(ws: WebSocket, typedArray: Uint8Array): void {
        try {
            ws.send(typedArray);
        } catch (e) {
            // TODO: log property or just ignore.
            logger.warn("Send content", e);
        }
    }

    private handleError(err: Error): never {
        throw new Error(err.message);
    }

    public async close(): Promise<{ type: SocketType }> {
        const closeServer = async (resolve: (value: { type: SocketType }) => void) => {
            this.wss.clients.forEach(ws => ws.close());
            this.server.close(() => {
                const info = {
                    type: this.type
                };
                this.emit("closed", info);
                resolve(info);
            });
        };

        return new Promise<{ type: SocketType }>((resolve, reject) => {
            if (this.server.listening) {
                closeServer(resolve);
            } else {
                this.on("listening", () => {
                    closeServer(resolve);
                });
            }
        });
    }
}
