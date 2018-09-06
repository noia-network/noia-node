import EventEmitter from "events";
import { WebRtcDirect, Channel } from "@noia-network/webrtc-direct-server";

import logger from "./logger";
import { Node } from "../index";

class ClientSocketWrtc extends EventEmitter {
    public controlPort: number;
    public dataPort: number;
    public controlIp: string;
    public dataIp: string;
    public _node: Node;
    public type: string = "wrtc";
    public wrtc: WebRtcDirect;
    public queue: Array<any>;
    public _queueInterval: any;

    constructor(node: Node, controlPort: number, dataPort: number, controlIp: string, dataIp: string) {
        super();
        this.controlPort = controlPort || node.settings.get(node.settings.Options.wrtcControlPort);
        this.dataPort = dataPort || node.settings.get(node.settings.Options.wrtcDataPort);
        this.controlIp = controlIp || "0.0.0.0";
        this.dataIp = dataIp;
        this._node = node;
        this.queue = [];

        this.wrtc = new WebRtcDirect(this.controlPort, this.dataPort, this.controlIp, this.dataIp);

        this.wrtc.on("connection", (channel: Channel) => {
            logger.info(`[${channel.id}] ip=${this.filterIp(channel)}, clients=${this.countChannels(this.wrtc.channels)}`);
            this.emit("connections", this.countChannels(this.wrtc.channels));
            channel.on("data", (params: any) => {
                try {
                    params = JSON.parse(params);
                    const piece = params.piece;
                    const offset = params.offset;
                    const length = params.length;
                    const infoHash = params.infoHash;
                    logger.info(`[${channel.id}] request infoHash=${infoHash} index=${piece} offset=${offset} length=${length}`);
                    this.handleMessage(channel, params);
                } catch (e) {
                    logger.info(`[${channel.id}] bad request`, e);
                }
            });
            channel.on("error", (error: any) => {
                logger.info(`[${channel.id}] disconnected (error), clients=${this.countChannels(this.wrtc.channels)}`);
                logger.error(`[${channel.id}]`, error);
                this.emit("connections", this.countChannels(this.wrtc.channels));
                this.handleError(error);
            });
            channel.on("closed", (error: any) => {
                logger.info(`[${channel.id}] disconnected, clients=${this.countChannels(this.wrtc.channels)}`);
                logger.info(`[${channel.id}] closed`);
                this.emit("connections", this.countChannels(this.wrtc.channels));
            });
        });
        this.wrtc.on("error", (err: Error) => {
            logger.error("Coult not create WebRtc server", err);
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
                        type: "webrtc",
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
                logger.info(`WebRTC sent to ${client} ${resource} ${sizeMB}`);
                this.emit("resourceSent", groups[key]);
            });
        }, this._queueInterval);
    }

    public async listen(): Promise<void> {
        await this.wrtc.listen();
        this.emit("listening", {
            type: this.type
        });
        logger.info(
            `Listening for clients connections type=${this.type} control-port=${this.controlPort} control-ip=${this.controlIp} data-port=${
                this.dataPort
            }`
        );
    }

    private handleMessage(channel: Channel, params: any): void {
        const piece = params.piece;
        const offset = params.offset;
        const length = params.length;
        const infoHash = params.infoHash;

        if (typeof piece === "undefined" || typeof offset === "undefined" || typeof infoHash === "undefined") {
            logger.error(`[${channel.id}] bad request infoHash=${infoHash} index=${piece} offset=${offset} length=${length}`);
            return;
        }

        if (this._node == null || this._node.contentsClient == null) return;

        const content = this._node.contentsClient.get(infoHash);

        if (typeof content === "undefined") {
            logger.error(`[${channel.id}] bad request (404) infoHash=${infoHash} index=${piece} offset=${offset} length=${length}`);
            return;
        }

        content.getResponseBuffer(
            piece,
            offset,
            length,
            (resBuff: Buffer): void => {
                // TODO: write test so this debug info would never be required.
                // logger.info(`[${channel.id}] response infoHash=${infoHash} index=${piece} offset=${offset} length=${resBuff.length}`);
                queueEvent(this, this.filterIp(channel), infoHash, resBuff.length);
                try {
                    if (channel.dc == null) {
                        logger.warn("no data channel");
                        return;
                    }
                    channel.dc.send(resBuff);
                    content.emit("uploaded", resBuff.length);
                } catch (e) {
                    logger.warn("Send content", e); // TODO: log property or just ignore.
                }
            }
        );

        // TODO: move to common.
        function queueEvent(self: ClientSocketWrtc, ip: string, infoHash: string, size: number): void {
            const info = {
                ip: ip,
                resource: {
                    infoHash,
                    size
                }
            };
            self.queue.push(info);
        }
    }

    private handleError(err: Error): void {
        throw new Error(err.message);
    }

    // TODO: define info object as a type.
    public async close(): Promise<object> {
        const _close = async (resolve: any) => {
            await this.wrtc.close();
            const info = {
                type: this.type
            };
            this.emit("closed", info);
            resolve(info);
        };

        return new Promise((resolve, reject) => {
            if (this.wrtc.server.listening) {
                _close(resolve);
            } else {
                this.on("listening", () => {
                    _close(resolve);
                });
            }
        });
    }

    private filterIp(channel: Channel): string {
        if (channel.remoteAddress == null) {
            throw new Error("remoteAddress cannot be invalid.");
        }
        return channel.remoteAddress.split(":")[0];
    }

    private countChannels(channels: { [name: string]: Channel }): number {
        return Object.keys(channels).length;
    }
}

export = ClientSocketWrtc;
