import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";

import { ClientSocketEvents } from "./contracts";
import { ClientSocketHttp, ClientSocketHttpOptions } from "./client-socket-http";
import { ClientSocketWrtc } from "./client-socket-wrtc";
import { ClientSocketWrtcOptions } from "./client-socket-wrtc";
import { ClientSocketWs, ClientSocketWsOptions } from "./client-socket-ws";
import { NatPmp, DEFAULT_TTL } from "./nat-pmp";
import { Node } from "./node";
import { logger } from "./logger";

type ProtocolEmitter = StrictEventEmitter<EventEmitter, ClientSocketEvents>;

export interface ClientSocketsOptions {
    natPmp?: boolean;
    http?: ClientSocketHttpOptions;
    ws?: ClientSocketWsOptions;
    wrtc?: ClientSocketWrtcOptions;
}

export class ClientSockets extends (EventEmitter as { new (): ProtocolEmitter }) {
    public http?: ClientSocketHttp;
    public ws?: ClientSocketWs;
    public wrtc?: ClientSocketWrtc;

    constructor(private readonly node: Node, public opts: ClientSocketsOptions) {
        super();

        // TODO: Implement unregistering, since now ports will be unmaped when default TTL will expire.
        // TODO: Check epoch and remap is something goes wrong. See https://tools.ietf.org/html/rfc6886#section-3.6.
        if (opts.natPmp) {
            const natPmp = new NatPmp();
            const registerPorts = (): void => {
                const promises = [];
                if (this.opts.wrtc != null) {
                    promises.push(natPmp.register("tcp", this.opts.wrtc.controlPort));
                    promises.push(natPmp.register("udp", this.opts.wrtc.dataPort));
                }
                if (this.opts.ws) {
                    promises.push(natPmp.register("tcp", this.opts.ws.port));
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

        if (this.opts.http) {
            this.http = new ClientSocketHttp(this.node, this.opts.http.port, this.opts.http.ip);
            this.http.on("listening", info => {
                this.emit("listening", info);
            });
            this.http.on("error", err => {
                this.emit("error", err);
            });
            this.http.on("resourceSent", info => {
                this.emit("resourceSent", info);
            });
        }
        if (this.opts.ws) {
            this.ws = new ClientSocketWs(this.node, this.opts.ws.port, this.opts.ws.ip, this.opts.ws);
            this.ws.on("listening", info => {
                this.emit("listening", info);
            });
            this.ws.on("error", err => {
                this.emit("error", err);
            });
            this.ws.on("resourceSent", info => {
                this.emit("resourceSent", info);
            });
        }
        if (this.opts.wrtc) {
            this.wrtc = new ClientSocketWrtc(
                this.node,
                this.opts.wrtc.controlPort,
                this.opts.wrtc.dataPort,
                this.opts.wrtc.controlIp,
                this.opts.wrtc.dataIp
            );
            this.wrtc.on("listening", info => {
                this.emit("listening", info);
            });
            this.wrtc.on("error", err => {
                this.emit("error", err);
            });
            this.wrtc.on("resourceSent", info => {
                this.emit("resourceSent", info);
            });
        }
    }

    public async listen(): Promise<Array<Array<Promise<void>>>> {
        const promises: Array<Promise<void>> = [];

        if (this.http != null && !this.http.listening) {
            promises.push(this.http.listen());
        }

        if (this.ws != null && !this.ws.server.listening) {
            promises.push(this.ws.listen());
        }

        if (this.wrtc != null && !this.wrtc.wrtc.server.listening) {
            promises.push(this.wrtc.listen());
        }

        return Promise.all([promises]);
    }

    public async close(): Promise<[any, any, any]> {
        const closeHttp = async () =>
            new Promise<any>(async (resolve, reject) => {
                if (this.http && this.http.listening) {
                    if (this.http.listening) {
                        const info = await this.http.close();
                        this.emit("closed", info);
                        resolve(info);
                    } else {
                        this.http.once("listening", async () => {
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
        const closeWs = async () =>
            new Promise<any>(async (resolve, reject) => {
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
        const closeWrtc = async () =>
            new Promise<any>(async (resolve, reject) => {
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
        return Promise.all([closeHttp(), closeWs(), closeWrtc()]);
    }
}
