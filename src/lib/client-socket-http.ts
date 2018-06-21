import EventEmitter from "events";
import express from "express";
import fs from "fs";
import http from "http";
// import { Transform } from "stream";
import mime from "mime-types";
import path from "path";

import logger from "./logger";
import Node from "../index";

const app = express();

// const test = new Transform({
//     transform(chunk: any, encoding: any, callback: any) {
//         console.log("chunk", chunk.length);
//         this.push(chunk);
//         callback();
//     }
// });

class ClientSocketHttp extends EventEmitter {
    public port: any;
    public ip: any;
    public app: any;
    public server: any;
    public type: any;
    public info: any;
    public queue: any;
    public listening: any;
    public static: any;
    public _queueInterval: any;
    public _staticDir: any;

    constructor(node: Node, port: any, ip: any) {
        super();

        this.port = port || node.settings.get(node.settings.Options.httpPort);
        this.ip = ip || "0.0.0.0";
        this.app = app;
        this.server = http.createServer(app);
        this.type = "http";
        this.info = null;
        this.queue = [];

        this.listening = false;

        this.static = null;

        this._queueInterval = 3000;

        this.server.on("error", (err: any) => {
            this.emit("error", err);
        });
    }

    // TODO: remove deprecated route.
    addStaticDirectory(directory: any) {
        this._staticDir = directory;
        app.use(express.static(path.join(__dirname, directory)));
    }

    listen() {
        // let sum = 0
        const self = this;

        // TODO: move to common.
        // group resources to save network bandwith and don't spam master
        setInterval(() => {
            const _queue = this.queue.slice();
            this.queue = [];
            const groups: any = {};
            if (_queue.length === 0) return;
            _queue.forEach((info: any) => {
                const key = `${info.resource.infoHash}:${info.ip}`;
                if (!groups[key])
                    groups[key] = {
                        ip: info.ip,
                        resource: {
                            infoHash: info.resource.infoHash,
                            url: info.resource.url,
                            size: 0
                        }
                    };
                groups[key].resource.size += parseFloat(info.resource.size);
            });
            Object.keys(groups).forEach(key => {
                const info = groups[key];
                const client = `client-ip=${info.ip}`;
                const resource = `resource=${info.resource.infoHash}`;
                const url = `url=${info.resource.url}`;
                const size = `size=${info.resource.size.toFixed(4)}`;
                const sizeMB = `size=${info.resource.size.toFixed(4) / 1000 / 1000}`;
                logger.info(`HTTP sent to ${client} ${resource} ${sizeMB} ${url}`);
                this.emit("resourceSent", groups[key]);
            });
        }, this._queueInterval);

        if (this._staticDir) {
            this.app.get("/:hash/:postfix", (req: any, res: any) => {
                let sum = 0;
                const infoHash = req.params.hash;
                const postfix = req.params.postfix;
                const filePath = path.join(this._staticDir, infoHash, postfix);
                const stat = fs.statSync(filePath);
                const fileSize = stat.size;
                const range = req.headers.range;
                const ip = req.connection.remoteAddress.replace(/^::ffff:/, "");

                if (range) {
                    const parts = range.replace(/bytes=/, "").split("-");
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
                    file.on("data", (chunk: any) => {
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
                        "Content-Length": fileSize,
                        "Content-Type": mime.contentType(path.extname(filePath)),
                        "Cache-Control": "no-cache"
                    };
                    res.writeHead(200, head);
                    fs.createReadStream(filePath)
                        .on("data", (chunk: any) => {
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

        this.server.listen(this.port, this.ip, () => {
            this.listening = true;
            this.info = this.server.address();
            const listeningInfo = {
                type: this.type,
                port: this.info.port,
                ip: this.info.address,
                family: this.info.family
            };
            this.emit("listening", listeningInfo);
            logger.info("Listening for HTTP requests on port 7676", listeningInfo);
        });
    }

    // TODO: move to common.
    queueEvent(self: any, ip: any, infoHash: any, url: any, size: any) {
        const info = {
            ip: ip,
            resource: {
                infoHash,
                url,
                size
            }
        };
        self.queue.push(info);
    }

    close() {
        return new Promise((resolve, reject) => {
            if (this.listening) {
                this.server.close();
                const info = {
                    type: this.type,
                    port: this.info.port,
                    ip: this.info.address,
                    family: this.info.family
                };
                this.emit("closed", info);
                resolve(info);
            } else {
                this.on("listening", () => {
                    this.server.close();
                    const info = {
                        type: this.type,
                        port: this.info.port,
                        ip: this.info.address,
                        family: this.info.family
                    };
                    this.emit("closed", info);
                    resolve(info);
                });
            }
        });
    }
}

export = ClientSocketHttp;
