import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import { WebRtcDirect, Channel } from "@noia-network/webrtc-direct-server";

import { Node } from "./node";
import { ClientSocketEvents, ResourceSent, SocketType, ClientRequestData } from "./contracts";
import { SettingsEnum } from "./settings";
import { logger } from "./logger";
import { Content } from "@noia-network/node-contents-client/dist/content";

export interface ClientSocketWrtcOptions {
    controlPort: number;
    controlIp: string;
    dataPort: number;
    dataIp: string;
}

type ClientSocketEmitter = StrictEventEmitter<EventEmitter, ClientSocketEvents>;

export class ClientSocketWrtc extends (EventEmitter as { new (): ClientSocketEmitter }) {
    public type: SocketType = SocketType.WebRtc;
    public wrtc: WebRtcDirect;
    public queue: ResourceSent[] = [];
    private queueInterval: number = 3000;

    constructor(
        private readonly node: Node,
        public controlPort: number,
        public dataPort: number,
        public controlIp: string = "0.0.0.0",
        public dataIp: string
    ) {
        super();
        this.controlPort = controlPort || node.settings.options[SettingsEnum.wrtcControlPort];
        this.dataPort = dataPort || node.settings.options[SettingsEnum.wrtcDataPort];

        this.wrtc = new WebRtcDirect(this.controlPort, this.dataPort, this.controlIp, this.dataIp);
        this.wrtc.on("connection", (channel: Channel) => {
            logger.info(
                `WebRTC client client-id=${channel.id} connected (wrtc): ip=${this.filterIp(
                    channel
                )}, connected-clients=${this.countChannels(this.wrtc.channels)}.`
            );
            this.emit("connections", this.countChannels(this.wrtc.channels));
            channel.on("data", data => {
                try {
                    const params: ClientRequestData = JSON.parse(data as string);
                    logger.info(
                        `WebRTC client client-id=${channel.id} request content-id=${params.contentId} index=${params.index} offset=${
                            params.offset
                        } length=${0}.`
                    );
                    this.handleMessage(channel, params);
                } catch (err) {
                    logger.info(`Client client-id=${channel.id} bad request:`, err);
                }
            });
            channel.on("error", error => {
                logger.info(
                    `WebRTC client client-id=${channel.id} disconnected (error): connected-clients=${this.countChannels(
                        this.wrtc.channels
                    )}.`
                );
                logger.error(`WebRTC client client-id${channel.id}  has encountered an error:`, error);
                this.emit("connections", this.countChannels(this.wrtc.channels));
                this.handleError(error);
            });
            channel.on("closed", () => {
                logger.info(
                    `WebRTC client client-id=${channel.id} disconnected: connected-clients=${this.countChannels(this.wrtc.channels)}.`
                );
                this.emit("connections", this.countChannels(this.wrtc.channels));
            });
        });
        this.wrtc.on("error", (err: Error) => {
            logger.error("Could not create WebRtc server:", err);
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
                        type: SocketType.WebRtc,
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
                logger.info(`WebRTC sent to ${client} ${resource} ${sizeMB}`);
                this.emit("resourceSent", groups[key]);
            });
        }, this.queueInterval);
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

    private async handleMessage(channel: Channel, params: Partial<ClientRequestData>): Promise<void> {
        if (params.index == null || params.offset == null || params.contentId == null) {
            const responseMsg = `WebRtc client client-id=${channel.id} bad request content-id=${params.contentId} index=${
                params.index
            } offset=${params.offset} length=${0}.`;
            logger.error(responseMsg);
            this.responseError(channel, 400, responseMsg);

            return;
        }

        const content = this.node.contentsClient.get(params.contentId) as Content;

        if (content == null) {
            const responseMsg = `WebRTC client client-id=${channel.id} 404 response content-id=${params.contentId}.`;
            logger.error(responseMsg);
            this.responseError(channel, 404, responseMsg);
            return;
        }

        try {
            const resBuff = await content.getResponseBuffer(params.index, params.offset, 0);
            // TODO: write test so this debug info would never be required.
            // logger.info(`[${channel.id}] response infoHash=${infoHash} index=${piece} offset=${offset} length=${resBuff.length}`);
            queueEvent(this, this.filterIp(channel), params.contentId, resBuff.length);
            if (channel.dc == null) {
                logger.warn("Data channel is invalid or does not exist.");
                return;
            }
            channel.dc.send(resBuff);
            content.emit("uploaded", resBuff.length);
        } catch (err) {
            // TODO: log property or just ignore.
            logger.warn("Error while sending content:", err);
        }

        // TODO: move to common.
        function queueEvent(self: ClientSocketWrtc, ip: string, infoHash: string, size: number): void {
            const info: ResourceSent = {
                type: SocketType.WebRtc,
                ip: ip,
                resource: {
                    infoHash,
                    size
                }
            };
            self.queue.push(info);
        }
    }

    public response(channel: Channel, buffer: Buffer): void {
        try {
            if (channel.dc != null) {
                channel.dc.send(buffer);
            }
        } catch (e) {
            // TODO: log property or just ignore.
            logger.warn("Send content", e);
        }
    }

    public responseError(channel: Channel, statusCode: number, errorMsg: string): void {
        const codeBuffer = Buffer.allocUnsafe(2);
        codeBuffer.writeUInt16BE(statusCode, 0);
        const msgBuffer = Buffer.from(errorMsg);
        this.response(channel, Buffer.concat([codeBuffer, msgBuffer]));
    }

    public responseSuccess(channel: Channel, buffer: Buffer): void {
        const codeBuffer = Buffer.allocUnsafe(2);
        codeBuffer.writeUInt16BE(200, 0);
        this.response(channel, Buffer.concat([codeBuffer, buffer]));
    }

    private handleError(err: Error): void {
        throw new Error(err.message);
    }

    public async close(): Promise<{ type: SocketType }> {
        const closeServer = async (resolve: (value: { type: SocketType }) => void) => {
            await this.wrtc.close();
            const info = {
                type: this.type
            };
            this.emit("closed", info);
            resolve(info);
        };

        return new Promise<{ type: SocketType }>(resolve => {
            if (this.wrtc.server.listening) {
                closeServer(resolve);
            } else {
                this.on("listening", () => {
                    closeServer(resolve);
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
