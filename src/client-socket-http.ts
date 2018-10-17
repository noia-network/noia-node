import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import express from "express";
import fs from "fs";
import http from "http";
import mime from "mime-types";
import path from "path";
import { AddressInfo } from "net";
import { Express } from "express";
import { Server } from "http";

import { ClientSocketEvents, ResourceSent, SocketType, SocketListening } from "./contracts";
import { Node } from "./node";
import { logger } from "./logger";

const app = express();

export interface ClientSocketHttpOptions {
    ip: string;
    port: number;
}

type ClientSocketEmitter = StrictEventEmitter<EventEmitter, ClientSocketEvents>;

export class ClientSocketHttp extends (EventEmitter as { new (): ClientSocketEmitter }) {
    public app: Express = express();
    public server: Server = http.createServer(app);
    public type: SocketType = SocketType.Http;
    public queue: ResourceSent[] = [];
    public listening: boolean = false;
    private queueInterval: number = 3000;
    private staticDir?: string;

    constructor(public node: Node) {
        super();
        this.server.on("error", err => {
            this.emit("error", err);
        });
    }

    // TODO: remove deprecated route.
    public addStaticDirectory(directory: string): void {
        this.staticDir = directory;
        app.use(express.static(path.join(__dirname, directory)));
    }

    public async listen(): Promise<void> {
        // TODO: move to common.
        // Group resources to save network bandwith and don't spam master.
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
                            url: info.resource.url,
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
                const url = `url=${info.resource.url}`;
                const size = `size=${info.resource.size.toFixed(4)}`;
                const sizeMB = `size=${info.resource.size.toFixed(4 / 1000 / 1000)}`;
                logger.info(`HTTP sent to ${client} ${resource} ${sizeMB} ${url}`);
                this.emit("resourceSent", groups[key]);
            });
        }, this.queueInterval);

        if (this.staticDir) {
            this.app.get("/:hash/:postfix", (req, res) => {
                let sum = 0;
                const infoHash = req.params.hash;
                const postfix = req.params.postfix;
                const filePath = this.staticDir != null ? path.join(this.staticDir, infoHash, postfix) : path.join(infoHash, postfix);
                const stat = fs.statSync(filePath);
                const fileSize = stat.size;
                const range = req.headers.range;
                if (req.connection.remoteAddress == null) {
                    logger.error("Could not determine remote addresss!");
                    return;
                }
                const ip = req.connection.remoteAddress.replace(/^::ffff:/, "");

                if (range) {
                    const parts = (range as string).replace(/bytes=/, "").split("-");
                    const start = parseInt(parts[0], 10);
                    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

                    const chunksize = end - start + 1;
                    const file = fs.createReadStream(filePath, { start, end });
                    const head = {
                        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
                        "Accept-Ranges": "bytes",
                        "Content-Length": chunksize,
                        "Content-Type": "video/mp4",
                        "Cache-Control": "no-cache"
                    };

                    res.writeHead(206, head);
                    file.on("data", chunk => {
                        sum += chunk.length;
                        // logger.info(ip, infoHash, chunk.length, postfix, sum)
                        this.queueEvent(this, ip, infoHash, req.url, chunk.length);
                    })
                        .on("close", () => logger.info("close"))
                        .on("end", () => logger.info("end"))
                        .on("error", () => logger.info("error"))
                        .on("finish", () => logger.info("finish"))
                        .pipe(res);
                } else {
                    const head = {
                        "Content-Length": fileSize.toString(),
                        "Content-Type": mime.contentType(path.extname(filePath)).toString(),
                        "Cache-Control": "no-cache"
                    };
                    res.writeHead(200, head);
                    fs.createReadStream(filePath)
                        .on("data", chunk => {
                            sum += chunk.length;
                            // logger.info(ip, infoHash, chunk.length, postfix, sum)
                            this.queueEvent(this, ip, infoHash, req.url, chunk.length);
                        })
                        // .on("close", () => logger.info("else: close"))
                        // .on("end", () => logger.info("else: end"))
                        // .on("error", () => logger.info("else: error"))
                        // .on("finish", () => logger.info("else: finish"))
                        .pipe(res);
                }
            });
        }
        return new Promise<void>((resolve, reject) => {
            this.server.listen(
                this.node
                    .getSettings()
                    .getScope("sockets")
                    .getScope("http")
                    .get("port"),
                this.node
                    .getSettings()
                    .getScope("sockets")
                    .getScope("http")
                    .get("ip"),
                (err: Error) => {
                    if (err) {
                        reject(err);
                        return;
                    }

                    this.listening = true;
                    const addressInfo = this.server.address() as AddressInfo;
                    const listeningInfo: SocketListening = {
                        type: this.type,
                        port: addressInfo.port,
                        ip: addressInfo.address,
                        family: addressInfo.family
                    };
                    this.emit("listening", listeningInfo);
                    resolve();
                    logger.info("Listening for HTTP requests on port 7676:", listeningInfo);
                }
            );
        });
    }

    // TODO: move to common.
    private queueEvent(self: ClientSocketHttp, ip: string, infoHash: string, url: string, size: number): void {
        const info: ResourceSent = {
            type: SocketType.Http,
            ip: ip,
            resource: {
                infoHash,
                url,
                size
            }
        };
        self.queue.push(info);
    }

    public async close(): Promise<{ type: SocketType }> {
        return new Promise<{ type: SocketType }>(resolve => {
            if (this.listening) {
                this.server.close();
                const info = {
                    type: this.type
                };
                this.emit("closed", info);
                resolve(info);
            } else {
                this.on("listening", () => {
                    this.server.close();
                    const info = {
                        type: this.type
                    };
                    this.emit("closed", info);
                    resolve(info);
                });
            }
        });
    }
}
