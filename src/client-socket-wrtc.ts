import * as protobuf from "protobufjs";
import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import { WebRtcDirect, Channel } from "@noia-network/webrtc-direct-server";
import { Wire } from "@noia-network/protocol";
// TODO: Export.
import { Content } from "@noia-network/node-contents-client/dist/content";

import { Node } from "./node";
import { ClientSocketEvents, ResourceSent, SocketType, ClientRequestData } from "./contracts";
import { logger } from "./logger";

type ClientSocketEmitter = StrictEventEmitter<EventEmitter, ClientSocketEvents>;

export class ClientSocketWrtc extends (EventEmitter as { new (): ClientSocketEmitter }) {
    public type: SocketType = SocketType.WebRtc;
    public wrtc: WebRtcDirect;
    public queue: ResourceSent[] = [];
    private queueInterval: number = 3000;
    private contentResponseType?: protobuf.Type;

    constructor(private readonly node: Node) {
        super();

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

        const wrtcSettings = this.node
            .getSettings()
            .getScope("sockets")
            .getScope("wrtc");
        this.wrtc = new WebRtcDirect(
            wrtcSettings.get("controlPort"),
            wrtcSettings.get("dataPort"),
            wrtcSettings.get("controlIp"),
            wrtcSettings.get("dataIp")
        );
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
        const wrtcSettings = this.node
            .getSettings()
            .getScope("sockets")
            .getScope("wrtc");
        logger.info(
            `Listening for type=${this.type} clients connections: control-port=${wrtcSettings.get(
                "controlPort"
            )} control-ip=${wrtcSettings.get("controlIp")} data-port=${wrtcSettings.get("dataPort")}.`
        );
    }

    private async handleMessage(channel: Channel, params: Partial<ClientRequestData>): Promise<void> {
        if (this.contentResponseType == null) {
            logger.error("Property 'contentResponseType' is invalid.");
            return;
        }

        if (params.index == null || params.offset == null || params.contentId == null) {
            const responseMsg = `WebRtc client client-id=${channel.id} bad request content-id=${params.contentId} index=${
                params.index
            } offset=${params.offset} length=${0}.`;
            logger.error(responseMsg);
            const msg = this.contentResponseType.create({
                status: 400,
                error: responseMsg
            });
            logger.error(responseMsg);
            this.response(channel, this.contentResponseType.encode(msg).finish());
            return;
        }

        const content = this.node.getContentsClient().get(params.contentId) as Content;

        if (content == null) {
            const responseMsg = `WebRTC client client-id=${channel.id} 404 response content-id=${params.contentId}.`;
            const msg = this.contentResponseType.create({
                status: 404,
                error: responseMsg
            });
            logger.error(responseMsg);
            this.response(channel, this.contentResponseType.encode(msg).finish());
            return;
        }

        try {
            const response = await content.getContentData(params.index, params.offset, 0);
            // TODO: write test so this debug info would never be required.
            // logger.info(`[${channel.id}] response infoHash=${infoHash} index=${piece} offset=${offset} length=${resBuff.length}`);
            queueEvent(this, this.filterIp(channel), params.contentId, response.buffer.length);
            if (channel.dc == null) {
                logger.warn("Data channel is invalid or does not exist.");
                return;
            }
            const msg = this.contentResponseType.create({
                data: {
                    contentId: params.contentId,
                    offset: params.offset,
                    index: params.index,
                    buffer: response.buffer
                },
                status: 200
            });
            this.response(channel, this.contentResponseType.encode(msg).finish());
            content.emit("uploaded", response.buffer.length);
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

    public response(channel: Channel, typedArray: Uint8Array): void {
        try {
            if (channel.dc != null) {
                channel.dc.send(typedArray);
            }
        } catch (e) {
            // TODO: log property or just ignore.
            logger.warn("Send content", e);
        }
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
