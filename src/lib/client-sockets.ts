import EventEmitter from "events";

import ClientSocketHttp from "./client-socket-http";
import ClientSocketWrtc from "./client-socket-wrtc";
import { Node } from "../index";
import logger from "./logger";
import { ClientSocketWs, ClientSocketWsOptions } from "./client-socket-ws";
import { NatPmp, DEFAULT_TTL } from "./nat-pmp";

export interface ClientSocketsOptions {
    natPmp?: any;
    http?: any;
    ws: ClientSocketWsOptions | boolean;
    wrtc?: any;
}

export class ClientSockets extends EventEmitter {
    public opts: any;
    public _node: Node;
    public http: ClientSocketHttp;
    public ws: ClientSocketWs;
    public wrtc: ClientSocketWrtc;

    constructor(node: Node, opts: ClientSocketsOptions) {
        super();

        this.opts = opts || {};

        this._node = node;

        // TODO: Implement unregistering, since now ports will be unmaped when default TTL will expire.
        // TODO: Check epoch and remap is something goes wrong. See https://tools.ietf.org/html/rfc6886#section-3.6.
        if (opts.natPmp) {
            const natPmp = new NatPmp();
            const registerPorts = (): void => {
                const promises = [];
                if (this.opts.wrtc) {
                    promises.push(natPmp.register("tcp", this.opts.wrtc.controlPort));
                    promises.push(natPmp.register("udp", this.opts.wrtc.dataPort));
                }
                if (this.opts.ws) {
                    promises.push(natPmp.register("tcp", this.opts.ws.ip));
                }
                if (this.opts.http) {
                    promises.push(natPmp.register("tcp", this.opts.http.port));
                }

                // TODO: Use await Promise.all.
                Promise.all(promises)
                    .then(() => {
                        const timeoutSec = DEFAULT_TTL - 5;
                        if (timeoutSec <= 0) {
                            logger.warn("NAT-PMP rules refresh timeout cannot be <= 0, refreshing will be skipped!");
                            return;
                        }
                        logger.info(`NAT-PMP rules created for ${DEFAULT_TTL} seconds. Refresing rules in ${timeoutSec} seconds.`);
                        setTimeout(() => {
                            registerPorts();
                        }, timeoutSec * 1000);
                    })
                    .catch(err => {
                        logger.error("Failed to create NAT-PMP rules.");
                        this.emit("error", err);
                    });
            };
            registerPorts();
        }

        this.http = new ClientSocketHttp(this._node, this.opts.http.port, this.opts.http.ip);
        this.ws = new ClientSocketWs(this._node, this.opts.ws.port, this.opts.ws.ip, this.opts.ws);
        this.wrtc = new ClientSocketWrtc(
            this._node,
            this.opts.wrtc.controlPort,
            this.opts.wrtc.dataPort,
            this.opts.wrtc.controlIp,
            this.opts.wrtc.dataIp
        );

        if (this.opts.http) {
            this.http.on("listening", (info: any) => {
                this.emit("listening", info);
            });
            this.http.on("error", err => {
                this.emit("error", err);
            });
            this.http.on("resourceSent", (info: any) => {
                this.emit("resourceSent", info);
            });
        }
        if (this.opts.ws) {
            this.ws.on("listening", (info: any) => {
                this.emit("listening", info);
            });
            this.ws.on("error", err => {
                this.emit("error", err);
            });
            this.ws.on("resourceSent", (info: any) => {
                this.emit("resourceSent", info);
            });
        }
        if (this.opts.wrtc) {
            this.wrtc.on("listening", (info: any) => {
                this.emit("listening", info);
            });
            this.wrtc.on("error", (err: any) => {
                this.emit("error", err);
            });
            this.wrtc.on("resourceSent", (info: any) => {
                this.emit("resourceSent", info);
            });
        }
    }

    listen(): Promise<Promise<void>[][]> {
        const promises: Promise<void>[] = [];

        if (this.opts.http && !this.http.listening) {
            promises.push(this.http.listen());
        }

        if (this.opts.ws && !this.ws.server.listening) {
            promises.push(this.ws.listen());
        }

        if (this.opts.wrtc && !this.wrtc.wrtc.server.listening) {
            promises.push(this.wrtc.listen());
        }

        return Promise.all([promises]);
    }

    async close(): Promise<[any, any, any]> {
        const closeHttp = () => {
            return new Promise<any>(async (resolve, reject) => {
                if (this.http && this.http.listening) {
                    if (this.http.listening) {
                        const info = await this.http.close();
                        this.emit("closed", info);
                        resolve(info);
                    } else {
                        this.http.once("listening", async (info: any) => {
                            if (this.http) {
                                const info = await this.http.close();
                                this.emit("closed", info);
                                resolve(info);
                            }
                        });
                    }
                } else {
                    resolve();
                }
            });
        };

        const closeWs = () => {
            return new Promise<any>(async (resolve, reject) => {
                if (this.ws && this.ws.server.listening) {
                    if (this.ws.server.listening) {
                        const info = await this.ws.close();
                        this.emit("closed", info);
                        resolve(info);
                    } else {
                        this.ws.once("listening", async () => {
                            if (this.ws) {
                                const info = await this.ws.close();
                                this.emit("closed", info);
                                resolve(info);
                            }
                        });
                    }
                } else {
                    resolve();
                }
            });
        };

        const closeWrtc = () => {
            return new Promise<any>(async (resolve, reject) => {
                if (this.wrtc && this.wrtc.wrtc.server.listening) {
                    if (this.wrtc.wrtc.server.listening) {
                        const info = await this.wrtc.close();
                        this.emit("closed", info);
                        resolve(info);
                    } else {
                        this.wrtc.once("listening", async () => {
                            if (this.wrtc) {
                                const info = await this.wrtc.close();
                                this.emit("closed", info);
                                resolve(info);
                            }
                        });
                    }
                } else {
                    resolve();
                }
            });
        };

        return Promise.all([closeHttp(), closeWs(), closeWrtc()]);
    }
}
